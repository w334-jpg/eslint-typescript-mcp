import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock } from '../src/lock.js';

let cwd: string;

const FAST_RETRIES = { retries: 1, minTimeout: 10, maxTimeout: 30 };

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'mcp-lock-'));
  process.env.ESLINT_MCP_ALLOW_DIRS = cwd;
  await mkdir(join(cwd, 'src'), { recursive: true });
  await writeFile(join(cwd, 'src', 'a.ts'), 'x');
});

afterEach(async () => {
  delete process.env.ESLINT_MCP_ALLOW_DIRS;
  await rm(cwd, { recursive: true, force: true });
});

describe('cross-attempt lock contention', () => {
  it('rejects a second concurrent acquire on the same cwd', async () => {
    const release = await acquireLock({ cwd, staleMs: 60_000, updateMs: 5_000, retries: FAST_RETRIES });
    try {
      await expect(
        acquireLock({ cwd, staleMs: 60_000, updateMs: 5_000, retries: FAST_RETRIES }),
      ).rejects.toThrow(/lock|ELOCKED/i);
    } finally {
      await release();
    }
  });

  it('allows sequential acquire → release → acquire', async () => {
    const r1 = await acquireLock({ cwd });
    await r1();
    const r2 = await acquireLock({ cwd });
    await r2();
    // No throw means pass.
    expect(true).toBe(true);
  });
});
