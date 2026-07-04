/**
 * Manual rollback transaction.
 *
 * Reads the audit log, finds recent committed transactions, loads their
 * snapshots, and restores file contents. Each restored commit appends a new
 * `result: 'rollback'` audit entry so the audit trail stays complete and
 * reversible in its own right.
 *
 * Runs under the same per-cwd lock as fix transactions, so a rollback cannot
 * race with a concurrent fix.
 */

import { appendAudit, readAudit, type AuditEntry } from './audit.js';
import { acquireLock, type ReleaseFn } from './lock.js';
import { logger } from './logger.js';
import { loadSnapshot, restore, type RestoreResult } from './snapshot.js';

export interface RollbackOptions {
  cwd: string;
  /** Roll back the last N commits (default 1, max 20). */
  count?: number;
  /** Alternative: roll back every commit at or after this ISO timestamp. */
  since?: string;
}

export interface RollbackOutcome {
  success: boolean;
  restoredCount: number;
  missingCount: number;
  /** Audit runIds that were rolled back. */
  runIds: string[];
  /** Set when lock acquisition failed. */
  error?: string;
}

const COMMITTABLE_RESULTS = new Set<AuditEntry['result']>([
  'commit',
  'commit-partial-snapshot',
  'commit-no-snapshot',
]);

export async function runRollbackTransaction(opts: RollbackOptions): Promise<RollbackOutcome> {
  let release: ReleaseFn;
  try {
    release = await acquireLock({ cwd: opts.cwd });
  } catch (err) {
    return {
      success: false,
      restoredCount: 0,
      missingCount: 0,
      runIds: [],
      error: `Lock acquisition failed: ${(err as Error).message}`,
    };
  }

  try {
    const allEntries = await readAudit({ cwd: opts.cwd, limit: 1_000 });
    let candidates = allEntries.filter((e) => COMMITTABLE_RESULTS.has(e.result));

    if (opts.since) {
      candidates = candidates.filter((e) => e.timestamp >= opts.since!);
    } else {
      const count = Math.min(Math.max(opts.count ?? 1, 1), 20);
      candidates = candidates.slice(-count);
    }

    if (candidates.length === 0) {
      return { success: true, restoredCount: 0, missingCount: 0, runIds: [] };
    }

    let totalRestored = 0;
    let totalMissing = 0;
    const rolledBackRunIds: string[] = [];

    for (const entry of candidates) {
      if (!entry.snapshotRef) {
        logger.warn(`rollback: commit ${entry.runId} has no snapshotRef; skipping`);
        continue;
      }
      const ref = await loadSnapshot(entry.runId, opts.cwd);
      if (!ref) {
        logger.warn(`rollback: snapshot ${entry.runId} no longer on disk; skipping`);
        continue;
      }
      const result: RestoreResult = await restore(ref);
      totalRestored += result.restored.length;
      totalMissing += result.missing.length;
      rolledBackRunIds.push(entry.runId);

      await appendAudit(
        {
          runId: `${entry.runId}-rb-${Date.now()}`,
          timestamp: new Date().toISOString(),
          tool: 'rollback',
          cwd: opts.cwd,
          filesRequested: [],
          operation: 'rollback',
          lockAcquiredAt: new Date().toISOString(),
          lockReleasedAt: null,
          result: 'rollback',
          filesWritten: [],
          snapshotRef: entry.snapshotRef,
          durationMs: 0,
          rollbackReason: 'manual',
        },
        opts.cwd,
      );
    }

    return {
      success: true,
      restoredCount: totalRestored,
      missingCount: totalMissing,
      runIds: rolledBackRunIds,
    };
  } finally {
    await release();
  }
}
