/**
 * Transaction orchestrator for fix operations.
 *
 * Wraps `runEslint({fix:true})` and the optional `runTsc` verify step in a
 * strict lifecycle: acquire per-cwd cross-process lock → snapshot the source
 * tree → mutate via ESLint → optionally verify via tsc → commit or rollback
 * → release lock → append audit record.
 *
 * Invariants enforced here, nowhere else:
 * - No `runEslint({fix:true})` ever runs without the lock held.
 * - No mutation is observable to a concurrent transaction on the same cwd.
 * - On verify failure with `autoRollback` (default true), files are restored
 *   byte-for-byte from the snapshot before the lock is released.
 * - Every outcome (commit / rollback / error / locked-out) is audit-logged.
 */

import { runEslint } from './engines/eslint.js';
import { runTsc } from './engines/tsc.js';
import { logger } from './logger.js';
import { acquireLock, type ReleaseFn } from './lock.js';
import { appendAudit, type AuditEntry, type AuditResult, type AuditRollbackReason } from './audit.js';
import { makeErrorResult, pickFiles, summarize, SECURITY_NOTE } from './result.js';
import { expandScope, restore, snapshot, type SnapshotRef } from './snapshot.js';
import type { FileDiagnostic, ToolResult } from './types.js';

class RollbackSignal extends Error {
  readonly reason: AuditRollbackReason;
  constructor(reason: AuditRollbackReason, message: string) {
    super(message);
    this.name = 'RollbackSignal';
    this.reason = reason;
  }
}

export interface FixTransactionOptions {
  cwd: string;
  files?: string[];
  dryRun?: boolean;
  /** Run tsc after fix. lint_fix default false; fix_all default true unless skipTypecheck. */
  verify?: boolean;
  /** Roll back on tsc failure. Default true. */
  autoRollback?: boolean;
  format?: 'full' | 'compact';
  tool: 'lint_fix' | 'fix_all';
  /** fix_all only: skip the typecheck step entirely (forces verify=false). */
  skipTypecheck?: boolean;
}

export async function runFixTransaction(opts: FixTransactionOptions): Promise<ToolResult> {
  const start = Date.now();
  const dryRun = opts.dryRun === true;
  const wantsVerify =
    opts.verify === true || (opts.tool === 'fix_all' && opts.skipTypecheck !== true);
  const autoRollback = opts.autoRollback !== false;

  if (dryRun) {
    return runDryPath(opts);
  }

  const runId = makeRunId();
  let scopeFiles: string[] = [];
  try {
    scopeFiles = await expandScope(opts.cwd, opts.files);
  } catch (err) {
    return makeErrorResult({ tool: opts.tool, cwd: opts.cwd, error: err });
  }

  let release: ReleaseFn;
  try {
    release = await acquireLock({ cwd: opts.cwd });
  } catch (err) {
    return await lockedOutResult(opts, runId, scopeFiles, start, err);
  }
  const lockAcquiredAt = new Date().toISOString();

  let snapshotRef: SnapshotRef | null = null;
  let mutated = false;

  try {
    snapshotRef = await snapshot(scopeFiles, opts.cwd);

    const eslintResult = await runEslint({ cwd: opts.cwd, files: opts.files, fix: true });
    mutated = true;
    const filesWritten = eslintResult.files
      .filter((f) => f.status === 'fixed')
      .map((f) => f.file);

    let tscFiles: FileDiagnostic[] = [];
    let tscOk = true;
    let tscFatal = false;
    if (wantsVerify) {
      const tscResult = await runTsc({ cwd: opts.cwd, files: opts.files });
      tscFiles = tscResult.files;
      tscOk = tscResult.exitCode === 0;
      tscFatal = tscResult.timedOut || tscResult.exitCode < 0;

      if ((tscFatal || !tscOk) && autoRollback && snapshotRef) {
        throw new RollbackSignal(
          tscFatal ? 'tsc-crash' : 'tsc-verify-failed',
          tscFatal
            ? 'TypeScript compiler crashed during verification'
            : 'TypeScript reported errors after the fix',
        );
      }
    }

    const merged = mergeFiles(eslintResult.files, tscFiles);
    const totalDurationMs = Date.now() - start;
    const auditResult: AuditResult = snapshotRef
      ? coversAll(snapshotRef, filesWritten)
        ? 'commit'
        : 'commit-partial-snapshot'
      : 'commit-no-snapshot';

    await appendAudit(
      auditEntry({
        runId,
        cwd: opts.cwd,
        tool: opts.tool,
        filesRequested: opts.files ?? scopeFiles,
        lockAcquiredAt,
        lockReleasedAt: new Date().toISOString(),
        result: auditResult,
        filesWritten,
        snapshotRef: snapshotRef?.dir ?? null,
        durationMs: totalDurationMs,
      }),
      opts.cwd,
    );

    const partialWarning =
      auditResult === 'commit-partial-snapshot'
        ? ' Warning: ESLint wrote files outside the snapshotted set; verify those changes manually.'
        : auditResult === 'commit-no-snapshot'
          ? ' Warning: snapshot was skipped (size limit); changes are not reversible.'
          : '';

    return {
      tool: opts.tool,
      success: !eslintResult.fatal && tscOk,
      workingDirectory: opts.cwd,
      files: pickFiles(merged, opts.format),
      summary: summarize(merged, {
        dryRun: false,
        scope: opts.files ? 'filtered' : 'full',
        durationMs: totalDurationMs,
        fixedFiles: filesWritten.length,
      }),
      note: [
        SECURITY_NOTE,
        `Lint duration: ${eslintResult.durationMs}ms${wantsVerify ? '; typecheck verified' : ''}.${partialWarning}`,
      ].join(' '),
    };
  } catch (err) {
    if (err instanceof RollbackSignal) {
      return await rollbackResult(opts, runId, scopeFiles, snapshotRef, lockAcquiredAt, start, err);
    }
    // Unhandled exception — restore if we may have mutated, then re-audit and rethrow.
    if (mutated && snapshotRef) {
      try {
        await restore(snapshotRef);
      } catch (restoreErr) {
        logger.error(`restore after exception failed: ${(restoreErr as Error).message}`);
      }
    }
    await appendAudit(
      auditEntry({
        runId,
        cwd: opts.cwd,
        tool: opts.tool,
        filesRequested: opts.files ?? scopeFiles,
        lockAcquiredAt,
        lockReleasedAt: new Date().toISOString(),
        result: 'error',
        filesWritten: [],
        snapshotRef: snapshotRef?.dir ?? null,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      }),
      opts.cwd,
    );
    throw err;
  } finally {
    await release();
  }
}

async function runDryPath(opts: FixTransactionOptions): Promise<ToolResult> {
  const start = Date.now();
  const eslintResult = await runEslint({
    cwd: opts.cwd,
    files: opts.files,
    fix: true,
    dryRun: true,
  });
  const totalDurationMs = Date.now() - start;
  return {
    tool: opts.tool,
    success: !eslintResult.fatal,
    workingDirectory: opts.cwd,
    files: pickFiles(eslintResult.files, opts.format),
    summary: summarize(eslintResult.files, {
      dryRun: true,
      scope: opts.files ? 'filtered' : 'full',
      durationMs: totalDurationMs,
      fixedFiles: 0,
    }),
    note: [SECURITY_NOTE, 'Dry-run: no files locked, snapshotted, or written.'].join(' '),
  };
}

async function lockedOutResult(
  opts: FixTransactionOptions,
  runId: string,
  scopeFiles: string[],
  start: number,
  err: unknown,
): Promise<ToolResult> {
  const message = err instanceof Error ? err.message : String(err);
  await appendAudit(
    auditEntry({
      runId,
      cwd: opts.cwd,
      tool: opts.tool,
      filesRequested: opts.files ?? scopeFiles,
      lockAcquiredAt: null,
      lockReleasedAt: null,
      result: 'locked-out',
      filesWritten: [],
      snapshotRef: null,
      durationMs: Date.now() - start,
      error: message,
    }),
    opts.cwd,
  );
  return makeErrorResult({
    tool: opts.tool,
    cwd: opts.cwd,
    error: `Another transaction holds the lock on ${opts.cwd}; retry shortly. (${message})`,
  });
}

async function rollbackResult(
  opts: FixTransactionOptions,
  runId: string,
  scopeFiles: string[],
  snapshotRef: SnapshotRef | null,
  lockAcquiredAt: string,
  start: number,
  err: RollbackSignal,
): Promise<ToolResult> {
  if (snapshotRef) {
    try {
      await restore(snapshotRef);
    } catch (restoreErr) {
      logger.error(`rollback restore failed: ${(restoreErr as Error).message}`);
    }
  }
  await appendAudit(
    auditEntry({
      runId,
      cwd: opts.cwd,
      tool: opts.tool,
      filesRequested: opts.files ?? scopeFiles,
      lockAcquiredAt,
      lockReleasedAt: new Date().toISOString(),
      result: 'rollback',
      filesWritten: [],
      snapshotRef: snapshotRef?.dir ?? null,
      durationMs: Date.now() - start,
      rollbackReason: err.reason,
    }),
    opts.cwd,
  );
  return makeErrorResult({
    tool: opts.tool,
    cwd: opts.cwd,
    error: `Transaction rolled back: ${err.message}. Files restored to pre-fix state.`,
  });
}

/** True when every written file is in the snapshot's covered set. */
function coversAll(ref: SnapshotRef, written: string[]): boolean {
  if (written.length === 0) return true;
  const covered = new Set(ref.entries.map((e) => e.absPath));
  return written.every((f) => covered.has(f));
}

function auditEntry(over: Omit<AuditEntry, 'timestamp' | 'operation'>): AuditEntry {
  const operation: AuditEntry['operation'] = over.tool === 'rollback' ? 'rollback' : 'fix';
  return {
    timestamp: new Date().toISOString(),
    operation,
    ...over,
  };
}

function makeRunId(): string {
  return `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Merge ESLint and tsc diagnostics per file. ESLint messages are listed first;
 * tsc messages are appended. Status is upgraded to 'unfixable' when tsc
 * reports errors on a clean-per-ESLint file.
 */
export function mergeFiles(
  eslintFiles: FileDiagnostic[],
  tscFiles: FileDiagnostic[],
): FileDiagnostic[] {
  const byFile = new Map<string, FileDiagnostic>();
  for (const f of eslintFiles) byFile.set(f.file, { ...f, messages: [...f.messages] });
  for (const tsc of tscFiles) {
    const existing = byFile.get(tsc.file);
    if (existing) {
      existing.messages.push(...tsc.messages);
      existing.errorCount += tsc.errorCount;
      existing.warningCount += tsc.warningCount;
      if (tsc.errorCount > 0 && existing.status === 'clean') {
        existing.status = 'unfixable';
      }
    } else {
      byFile.set(tsc.file, { ...tsc, messages: [...tsc.messages] });
    }
  }
  return [...byFile.values()];
}
