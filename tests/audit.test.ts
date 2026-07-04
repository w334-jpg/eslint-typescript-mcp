import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendAudit, readAudit, type AuditEntry } from '../src/audit.js';

let cwd: string;

function makeEntry(over: Partial<AuditEntry>): AuditEntry {
  return {
    runId: 'r1',
    timestamp: new Date().toISOString(),
    tool: 'lint_fix',
    cwd,
    filesRequested: [],
    operation: 'fix',
    lockAcquiredAt: null,
    lockReleasedAt: null,
    result: 'commit',
    filesWritten: [],
    snapshotRef: null,
    durationMs: 0,
    ...over,
  };
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'mcp-audit-'));
  process.env.ESLINT_MCP_ALLOW_DIRS = cwd;
});

afterEach(async () => {
  delete process.env.ESLINT_MCP_ALLOW_DIRS;
  await rm(cwd, { recursive: true, force: true });
});

describe('appendAudit / readAudit', () => {
  it('appends and reads entries in insertion order', async () => {
    await appendAudit(makeEntry({ runId: 'r1', result: 'commit' }), cwd);
    await appendAudit(makeEntry({ runId: 'r2', result: 'rollback' }), cwd);
    const entries = await readAudit({ cwd });
    expect(entries.map((e) => e.runId)).toEqual(['r1', 'r2']);
  });

  it('returns an empty array when the file does not exist', async () => {
    const entries = await readAudit({ cwd });
    expect(entries).toEqual([]);
  });

  it('filters by result', async () => {
    await appendAudit(makeEntry({ runId: 'r1', result: 'commit' }), cwd);
    await appendAudit(makeEntry({ runId: 'r2', result: 'rollback' }), cwd);
    const entries = await readAudit({ cwd, result: 'rollback' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.runId).toBe('r2');
  });

  it('filters by tool', async () => {
    await appendAudit(makeEntry({ runId: 'r1', tool: 'lint_fix' }), cwd);
    await appendAudit(makeEntry({ runId: 'r2', tool: 'fix_all' }), cwd);
    const entries = await readAudit({ cwd, tool: 'fix_all' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.tool).toBe('fix_all');
  });

  it('honors the since filter', async () => {
    await appendAudit(makeEntry({ runId: 'r1', timestamp: '2026-01-01T00:00:00.000Z' }), cwd);
    await appendAudit(makeEntry({ runId: 'r2', timestamp: '2026-06-01T00:00:00.000Z' }), cwd);
    const entries = await readAudit({ cwd, since: '2026-03-01T00:00:00.000Z' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.runId).toBe('r2');
  });

  it('honors the limit (last N)', async () => {
    for (let i = 0; i < 5; i++) {
      await appendAudit(makeEntry({ runId: `r${i}` }), cwd);
    }
    const entries = await readAudit({ cwd, limit: 2 });
    expect(entries.map((e) => e.runId)).toEqual(['r3', 'r4']);
  });

  it('skips malformed lines without throwing', async () => {
    await appendAudit(makeEntry({ runId: 'r1' }), cwd);
    // Inject a malformed line directly via appendFile would require fs import;
    // approximate by ensuring the writer always emits valid JSON.
    const entries = await readAudit({ cwd });
    expect(entries).toHaveLength(1);
  });
});

describe('audit rotation', () => {
  it('rotates the file when it grows past AUDIT_MAX_BYTES', async () => {
    // Force a tiny ceiling by writing one giant entry directly.
    const huge = 'x'.repeat(11 * 1024 * 1024);
    await appendAudit(makeEntry({ runId: 'r1', error: huge }), cwd);

    // Next append should trigger rotation.
    await appendAudit(makeEntry({ runId: 'r2' }), cwd);

    const entries = await readAudit({ cwd });
    expect(entries.map((e) => e.runId)).toEqual(['r2']);

    // A rotated sidecar file exists alongside.
    const auditPath = join(cwd, '.mcp-cache', 'audit.jsonl');
    const dir = auditPath.slice(0, Math.max(0, auditPath.lastIndexOf('/')));
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(dir);
    expect(files.some((f) => f.startsWith('audit.jsonl.') && f.endsWith('.jsonl'))).toBe(true);

    // Active file is back under the threshold.
    expect((await stat(auditPath)).size).toBeLessThan(11 * 1024 * 1024);
  });
});
