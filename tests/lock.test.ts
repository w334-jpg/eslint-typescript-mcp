import { describe, expect, it, vi, beforeEach } from 'vitest';
import lockfile from 'proper-lockfile';
import { acquireLock, withLock } from '../src/lock.js';

vi.mock('proper-lockfile', () => ({
  default: { lock: vi.fn() },
}));

vi.mock('../src/cache-dir.js', () => ({
  ensureCacheDirs: vi.fn().mockResolvedValue({
    root: '/tmp/.mcp-cache',
    locks: '/tmp/.mcp-cache/locks',
    snapshots: '/tmp/.mcp-cache/snapshots',
    audit: '/tmp/.mcp-cache/audit.jsonl',
  }),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const cwd = '/allowed/cwd';

beforeEach(() => {
  process.env.ESLINT_MCP_ALLOW_DIRS = '/allowed';
  vi.mocked(lockfile.lock).mockReset();
});

describe('acquireLock', () => {
  it('returns a release function and calls lockfile.lock once', async () => {
    const releaseMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(lockfile.lock).mockResolvedValue(releaseMock);

    const release = await acquireLock({ cwd });
    expect(lockfile.lock).toHaveBeenCalledTimes(1);

    await release();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('passes stale/update/retries options through', async () => {
    vi.mocked(lockfile.lock).mockResolvedValue(vi.fn().mockResolvedValue(undefined));
    await acquireLock({ cwd, staleMs: 5_000, updateMs: 1_000 });
    const opts = vi.mocked(lockfile.lock).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(opts).toMatchObject({
      stale: 5_000,
      update: 1_000,
      realpath: false,
    });
    expect(opts).toHaveProperty('retries');
    expect(opts).toHaveProperty('lockfilePath');
  });

  it('release swallows errors from a stale-released lock', async () => {
    const releaseMock = vi.fn().mockRejectedValue(new Error('already released'));
    vi.mocked(lockfile.lock).mockResolvedValue(releaseMock);
    const release = await acquireLock({ cwd });
    await expect(release()).resolves.toBeUndefined();
  });
});

describe('withLock', () => {
  it('releases on success and returns the inner value', async () => {
    const releaseMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(lockfile.lock).mockResolvedValue(releaseMock);
    const result = await withLock({ cwd }, async () => 42);
    expect(result).toBe(42);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('releases even when the inner function throws', async () => {
    const releaseMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(lockfile.lock).mockResolvedValue(releaseMock);
    await expect(
      withLock({ cwd }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});
