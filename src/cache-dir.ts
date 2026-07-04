/**
 * Cache directory layout for the transaction layer.
 *
 * All runtime artifacts (lock sentinel, snapshot blobs, audit log) live under
 * `<cwd>/.mcp-cache/`. Centralizing here keeps path logic in one place and
 * lets every other module speak in terms of typed CacheDirs rather than
 * ad-hoc string concatenation.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR_NAME } from './config.js';
import { validateCwd } from './paths.js';

export interface CacheDirs {
  root: string;
  locks: string;
  snapshots: string;
  /** Path to the audit JSONL file (not a directory). */
  audit: string;
}

/**
 * Resolve cache directory paths for a cwd. Does not touch the filesystem.
 * Throws if `cwd` escapes the allowed roots (re-uses `validateCwd`).
 */
export function getCacheDir(cwd: string): CacheDirs {
  const root = validateCwd(cwd);
  const base = join(root, CACHE_DIR_NAME);
  return {
    root: base,
    locks: join(base, 'locks'),
    snapshots: join(base, 'snapshots'),
    audit: join(base, 'audit.jsonl'),
  };
}

/**
 * Resolve and create the cache directory tree for a cwd. Idempotent: safe to
 * call on every transaction. Returns the same shape as `getCacheDir`.
 */
export async function ensureCacheDirs(cwd: string): Promise<CacheDirs> {
  const dirs = getCacheDir(cwd);
  await mkdir(dirs.root, { recursive: true });
  await mkdir(dirs.locks, { recursive: true });
  await mkdir(dirs.snapshots, { recursive: true });
  return dirs;
}
