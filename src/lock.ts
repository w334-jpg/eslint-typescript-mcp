/**
 * Cross-process lock for the transaction layer.
 *
 * Locks are scoped **per-cwd** because ESLint `--fix` can transitively rewrite
 * files outside the client-declared `files` (import sorting, etc.). Per-file
 * locks would race on those rewrites; per-cwd is the only sound invariant.
 *
 * Backed by `proper-lockfile`, which is safe across processes and machines.
 * The lock targets a sentinel file under `.mcp-cache/locks/` so the source
 * tree is never polluted with lock artifacts.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { ensureCacheDirs } from './cache-dir.js';
import { LOCK_RETRIES, LOCK_STALE_MS, LOCK_UPDATE_MS } from './config.js';
import { logger } from './logger.js';

export type ReleaseFn = () => Promise<void>;

export interface LockOptions {
  cwd: string;
  staleMs?: number;
  updateMs?: number;
  /** Override the default retry strategy (used by tests to fail fast). */
  retries?: { retries: number; minTimeout: number; maxTimeout: number };
}

const SENTINEL_NAME = '.cwd-sentinel';

/**
 * Acquire the per-cwd transaction lock. Returns a release function that
 * must be called exactly once. Resolves after the lock is held; rejects
 * with code ELOCKED if another process holds it past the retry window.
 */
export async function acquireLock(opts: LockOptions): Promise<ReleaseFn> {
  const dirs = await ensureCacheDirs(opts.cwd);
  const sentinel = join(dirs.locks, SENTINEL_NAME);

  // proper-lockfile requires the target to exist; create it idempotently.
  // 'a' flag appends without overwriting, and creates if missing.
  await writeFile(sentinel, '', { flag: 'a' });

  const stale = opts.staleMs ?? LOCK_STALE_MS;
  const update = opts.updateMs ?? LOCK_UPDATE_MS;

  logger.debug(`acquiring cwd lock on ${opts.cwd}`);

  const release = await lockfile.lock(sentinel, {
    stale,
    update,
    retries: opts.retries ?? LOCK_RETRIES,
    realpath: false,
    lockfilePath: `${sentinel}.lock`,
    onCompromised: (err: Error) => {
      logger.warn(`cwd lock compromised on ${opts.cwd}: ${err.message}`);
    },
  });

  logger.debug(`cwd lock acquired on ${opts.cwd}`);

  return async () => {
    try {
      await release();
      logger.debug(`cwd lock released on ${opts.cwd}`);
    } catch (err) {
      // The lock may have been auto-released via stale; release failure is benign.
      logger.debug(`cwd lock release swallowed: ${(err as Error).message}`);
    }
  };
}

/**
 * Run `fn` while holding the per-cwd lock. Always releases on exit.
 */
export async function withLock<T>(opts: LockOptions, fn: () => Promise<T>): Promise<T> {
  const release = await acquireLock(opts);
  try {
    return await fn();
  } finally {
    await release();
  }
}
