/**
 * Snapshot and restore for transactional rollback.
 *
 * A snapshot is a content-addressed copy of the files that may be touched by
 * ESLint `--fix`. Files are stored under `.mcp-cache/snapshots/<runId>/` as
 * sha256-named blobs alongside a `manifest.json` recording the original path,
 * size, and mtime for each entry.
 *
 * Restore is best-effort and never throws — a partial restore records which
 * entries were missing so the caller (transaction layer) can surface the gap
 * in the audit log and the returned result.
 */

import { createHash } from 'node:crypto';
import { type Dirent } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { getCacheDir } from './cache-dir.js';
import { SNAPSHOT_EXTENSIONS, SNAPSHOT_MAX_BYTES, SNAPSHOT_SKIP_DIRS } from './config.js';
import { logger } from './logger.js';

export interface SnapshotEntry {
  absPath: string;
  sha256: string;
  size: number;
  mtimeMs: number;
}

export interface SnapshotRef {
  runId: string;
  dir: string;
  entries: SnapshotEntry[];
}

export interface RestoreResult {
  restored: string[];
  missing: string[];
}

/**
 * Compute the absolute file set to snapshot for a given cwd and caller-declared
 * `files`. When `files` is omitted or empty, the entire `src/` tree is
 * expanded. When `files` is provided, the union of the explicit files and the
 * src/ tree is returned — the user-approved "entire src tree" policy so
 * transitive ESLint rewrites are covered.
 */
export async function expandScope(cwd: string, files?: string[]): Promise<string[]> {
  const tree = await expandTree(resolve(cwd, 'src'));
  if (!files || files.length === 0) return tree;
  const set = new Set<string>([...files, ...tree]);
  return [...set];
}

async function expandTree(srcDir: string): Promise<string[]> {
  const out: string[] = [];
  await walk(srcDir, srcDir, out);
  return out;
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // directory missing — nothing to snapshot
  }
  for (const ent of entries) {
    if (SNAPSHOT_SKIP_DIRS.includes(ent.name)) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      await walk(root, full, out);
    } else if (ent.isFile() && SNAPSHOT_EXTENSIONS.includes(extname(ent.name))) {
      out.push(full);
    }
  }
}

/**
 * Capture a snapshot. Returns null when no files were captured (empty tree),
 * so the caller can skip restore on the rollback path. Stops appending once
 * `SNAPSHOT_MAX_BYTES` is reached; truncated snapshots are still valid (the
 * transaction layer flags the partial state in the audit log).
 */
export async function snapshot(files: string[], cwd: string): Promise<SnapshotRef | null> {
  const dirs = getCacheDir(cwd);
  const runId = makeRunId();
  const dir = join(dirs.snapshots, runId);
  await mkdir(dir, { recursive: true });

  const entries: SnapshotEntry[] = [];
  let totalBytes = 0;
  let truncated = false;

  for (const abs of files) {
    if (totalBytes >= SNAPSHOT_MAX_BYTES) {
      truncated = true;
      break;
    }
    let st;
    try {
      st = await stat(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;

    const content = await readFile(abs);
    const sha = createHash('sha256').update(content).digest('hex');
    await writeFile(join(dir, sha), content);
    entries.push({ absPath: abs, sha256: sha, size: st.size, mtimeMs: st.mtimeMs });
    totalBytes += st.size;
  }

  if (truncated) {
    logger.warn(
      `snapshot truncated at ${SNAPSHOT_MAX_BYTES} bytes; auto-rollback may be partial`,
    );
  }

  if (entries.length === 0) {
    return null;
  }

  const manifest = {
    runId,
    cwd,
    createdAt: new Date().toISOString(),
    truncated,
    entries: entries.map((e) => ({
      absPath: e.absPath,
      sha256: e.sha256,
      size: e.size,
      mtimeMs: e.mtimeMs,
    })),
  };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return { runId, dir, entries };
}

/**
 * Restore files from a snapshot. Best-effort: entries whose blob is missing
 * are returned in `missing`. Never throws.
 */
export async function restore(ref: SnapshotRef): Promise<RestoreResult> {
  const restored: string[] = [];
  const missing: string[] = [];
  for (const entry of ref.entries) {
    try {
      const blob = await readFile(join(ref.dir, entry.sha256));
      await writeFile(entry.absPath, blob);
      restored.push(entry.absPath);
    } catch (err) {
      logger.warn(
        `snapshot restore missing ${entry.absPath}: ${(err as Error).message}`,
      );
      missing.push(entry.absPath);
    }
  }
  return { restored, missing };
}

/**
 * Read a snapshot back from disk by runId. Used by the manual `rollback`
 * tool to recover a prior snapshot. Returns null if the manifest is gone.
 */
export async function loadSnapshot(
  runId: string,
  cwd: string,
): Promise<SnapshotRef | null> {
  const dirs = getCacheDir(cwd);
  const dir = join(dirs.snapshots, runId);
  try {
    const manifestRaw = await readFile(join(dir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw) as { entries: SnapshotEntry[] };
    return { runId, dir, entries: manifest.entries };
  } catch {
    return null;
  }
}

/** Resolve whether a path is inside the cwd's source tree (used in tests). */
export function isWithinCwd(absPath: string, cwd: string): boolean {
  const rel = relative(cwd, absPath);
  return rel !== '' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep);
}

function makeRunId(): string {
  return `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
}
