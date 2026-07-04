/**
 * JSONL audit log for the transaction layer.
 *
 * Every fix transaction (commit, rollback, error) appends one record to
 * `.mcp-cache/audit.jsonl`. Appends happen under the per-cwd lock, so
 * concurrent writes to the same file are serialized at the application
 * layer — no platform-specific `O_APPEND` atomicity required.
 *
 * Files are rotated when they exceed `AUDIT_MAX_BYTES` to bound disk growth.
 */

import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { getCacheDir } from './cache-dir.js';
import { AUDIT_MAX_BYTES } from './config.js';
import { logger } from './logger.js';

export type AuditTool = 'lint_fix' | 'fix_all' | 'rollback';
export type AuditOperation = 'fix' | 'rollback';
export type AuditResult =
  | 'commit'
  | 'rollback'
  | 'error'
  | 'locked-out'
  | 'commit-partial-snapshot'
  | 'commit-no-snapshot';
export type AuditRollbackReason =
  | 'tsc-verify-failed'
  | 'tsc-crash'
  | 'exception'
  | 'manual';

export interface AuditEntry {
  runId: string;
  timestamp: string;
  tool: AuditTool;
  cwd: string;
  filesRequested: string[];
  operation: AuditOperation;
  lockAcquiredAt: string | null;
  lockReleasedAt: string | null;
  result: AuditResult;
  filesWritten: string[];
  snapshotRef: string | null;
  durationMs: number;
  error?: string;
  rollbackReason?: AuditRollbackReason;
}

export interface AuditReadFilter {
  cwd: string;
  limit?: number;
  tool?: AuditTool;
  since?: string;
  result?: AuditResult;
}

/**
 * Append one audit record. Rotates the active file if it has grown past
 * `AUDIT_MAX_BYTES` (rotation name: `audit.jsonl.<ts>.jsonl`).
 */
export async function appendAudit(entry: AuditEntry, cwd: string): Promise<void> {
  const dirs = getCacheDir(cwd);
  await mkdir(dirs.root, { recursive: true });
  await maybeRotate(dirs.audit);
  await appendFile(dirs.audit, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function maybeRotate(auditPath: string): Promise<void> {
  let size = 0;
  try {
    const st = await stat(auditPath);
    size = st.size;
  } catch {
    return; // file does not exist yet
  }
  if (size > AUDIT_MAX_BYTES) {
    const rotated = `${auditPath}.${Date.now()}.jsonl`;
    try {
      await rename(auditPath, rotated);
      logger.info(`audit log rotated to ${rotated}`);
    } catch (err) {
      logger.warn(`audit rotation failed: ${(err as Error).message}`);
    }
  }
}

/**
 * Read audit entries, newest last, after applying the filter. Returns an
 * empty array when the audit file does not exist yet.
 */
export async function readAudit(filter: AuditReadFilter): Promise<AuditEntry[]> {
  const dirs = getCacheDir(filter.cwd);
  let raw = '';
  try {
    raw = await readFile(dirs.audit, 'utf8');
  } catch {
    return [];
  }

  const lines = raw.split('\n').filter((line) => line.length > 0);
  const entries: AuditEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch (err) {
      logger.warn(`audit skip malformed line: ${(err as Error).message}`);
    }
  }

  const filtered = entries.filter((e) => {
    if (filter.tool && e.tool !== filter.tool) return false;
    if (filter.result && e.result !== filter.result) return false;
    if (filter.since && e.timestamp < filter.since) return false;
    return true;
  });

  const limit = filter.limit ?? 100;
  return filtered.slice(-limit);
}
