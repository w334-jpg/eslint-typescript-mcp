import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCacheDir, ensureCacheDirs } from '../src/cache-dir.js';
import { AllowedPathError } from '../src/paths.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcp-cache-'));
  process.env.ESLINT_MCP_ALLOW_DIRS = dir;
});

afterEach(async () => {
  delete process.env.ESLINT_MCP_ALLOW_DIRS;
  await rm(dir, { recursive: true, force: true });
});

describe('getCacheDir', () => {
  it('resolves cache paths under cwd/.mcp-cache', () => {
    const dirs = getCacheDir(dir);
    expect(dirs.root).toBe(join(dir, '.mcp-cache'));
    expect(dirs.locks).toBe(join(dir, '.mcp-cache', 'locks'));
    expect(dirs.snapshots).toBe(join(dir, '.mcp-cache', 'snapshots'));
    expect(dirs.audit).toBe(join(dir, '.mcp-cache', 'audit.jsonl'));
  });

  it('throws AllowedPathError when cwd escapes the allowed roots', () => {
    delete process.env.ESLINT_MCP_ALLOW_DIRS;
    expect(() => getCacheDir('/etc')).toThrow(AllowedPathError);
  });
});

describe('ensureCacheDirs', () => {
  it('creates the directory tree', async () => {
    const dirs = await ensureCacheDirs(dir);
    expect((await stat(dirs.root)).isDirectory()).toBe(true);
    expect((await stat(dirs.locks)).isDirectory()).toBe(true);
    expect((await stat(dirs.snapshots)).isDirectory()).toBe(true);
  });

  it('is idempotent on repeat calls', async () => {
    await ensureCacheDirs(dir);
    await expect(ensureCacheDirs(dir)).resolves.toBeDefined();
  });
});
