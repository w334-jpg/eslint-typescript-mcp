import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandScope, snapshot, restore, loadSnapshot } from '../src/snapshot.js';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'mcp-snap-'));
  process.env.ESLINT_MCP_ALLOW_DIRS = cwd;
  await mkdir(join(cwd, 'src'), { recursive: true });
  await mkdir(join(cwd, 'src', 'nested'), { recursive: true });
  await writeFile(join(cwd, 'src', 'a.ts'), 'original a');
  await writeFile(join(cwd, 'src', 'b.ts'), 'original b');
  await writeFile(join(cwd, 'src', 'nested', 'c.tsx'), 'original c');
  await writeFile(join(cwd, 'src', 'skip.json'), 'should be skipped');
});

afterEach(async () => {
  delete process.env.ESLINT_MCP_ALLOW_DIRS;
  await rm(cwd, { recursive: true, force: true });
});

describe('expandScope', () => {
  it('walks the src tree with the configured extensions', async () => {
    const scope = await expandScope(cwd);
    expect(scope).toContain(join(cwd, 'src', 'a.ts'));
    expect(scope).toContain(join(cwd, 'src', 'b.ts'));
    expect(scope).toContain(join(cwd, 'src', 'nested', 'c.tsx'));
    expect(scope).not.toContain(join(cwd, 'src', 'skip.json'));
  });

  it('unions explicit files with the src tree', async () => {
    const explicit = [join(cwd, 'extra.ts')];
    const scope = await expandScope(cwd, explicit);
    expect(scope).toContain(join(cwd, 'src', 'a.ts'));
    expect(scope).toContain(join(cwd, 'extra.ts'));
  });
});

describe('snapshot + restore', () => {
  it('captures and restores original content after mutation', async () => {
    const scope = await expandScope(cwd);
    const ref = await snapshot(scope, cwd);
    expect(ref).not.toBeNull();
    expect(ref!.entries.length).toBe(3);

    await writeFile(join(cwd, 'src', 'a.ts'), 'mutated');
    const result = await restore(ref!);
    expect(result.restored).toContain(join(cwd, 'src', 'a.ts'));
    expect(result.missing).toEqual([]);

    const after = await readFile(join(cwd, 'src', 'a.ts'), 'utf8');
    expect(after).toBe('original a');
  });

  it('returns null when there is nothing to snapshot', async () => {
    const emptyCwd = await mkdtemp(join(tmpdir(), 'mcp-empty-'));
    try {
      process.env.ESLINT_MCP_ALLOW_DIRS = emptyCwd;
      const ref = await snapshot([], emptyCwd);
      expect(ref).toBeNull();
    } finally {
      delete process.env.ESLINT_MCP_ALLOW_DIRS;
      await rm(emptyCwd, { recursive: true, force: true });
    }
  });

  it('restore reports missing when the blob is gone', async () => {
    const scope = await expandScope(cwd);
    const ref = await snapshot(scope, cwd);
    // Tamper: remove a blob from the snapshot dir.
    const blob = ref!.entries[0]!.sha256;
    await rm(join(ref!.dir, blob), { force: true });
    const result = await restore(ref!);
    expect(result.missing.length).toBe(1);
  });
});

describe('loadSnapshot', () => {
  it('round-trips through manifest.json', async () => {
    const scope = await expandScope(cwd);
    const ref = await snapshot(scope, cwd);
    const reloaded = await loadSnapshot(ref!.runId, cwd);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.entries.length).toBe(ref!.entries.length);
  });

  it('returns null for an unknown runId', async () => {
    const reloaded = await loadSnapshot('does-not-exist', cwd);
    expect(reloaded).toBeNull();
  });
});
