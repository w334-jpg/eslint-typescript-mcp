import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendAudit, readAudit } from '../src/audit.js';
import { expandScope, snapshot } from '../src/snapshot.js';
import { runRollbackTransaction } from '../src/rollback.js';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'mcp-rb-'));
  process.env.ESLINT_MCP_ALLOW_DIRS = cwd;
  await mkdir(join(cwd, 'src'), { recursive: true });
  await writeFile(join(cwd, 'src', 'a.ts'), 'ORIGINAL');
});

afterEach(async () => {
  delete process.env.ESLINT_MCP_ALLOW_DIRS;
  await rm(cwd, { recursive: true, force: true });
});

async function seedCommit(): Promise<string> {
  const scope = await expandScope(cwd);
  const ref = await snapshot(scope, cwd);
  if (!ref) throw new Error('snapshot failed');
  await appendAudit(
    {
      runId: ref.runId,
      timestamp: new Date().toISOString(),
      tool: 'lint_fix',
      cwd,
      filesRequested: scope,
      operation: 'fix',
      lockAcquiredAt: new Date().toISOString(),
      lockReleasedAt: new Date().toISOString(),
      result: 'commit',
      filesWritten: [join(cwd, 'src', 'a.ts')],
      snapshotRef: ref.dir,
      durationMs: 5,
    },
    cwd,
  );
  return ref.runId;
}

describe('runRollbackTransaction', () => {
  it('returns empty when the audit log has no committable entries', async () => {
    const outcome = await runRollbackTransaction({ cwd });
    expect(outcome.success).toBe(true);
    expect(outcome.restoredCount).toBe(0);
    expect(outcome.runIds).toEqual([]);
  });

  it('restores the most recent commit by default', async () => {
    const runId = await seedCommit();
    await writeFile(join(cwd, 'src', 'a.ts'), 'MUTATED');

    const outcome = await runRollbackTransaction({ cwd });
    expect(outcome.success).toBe(true);
    expect(outcome.restoredCount).toBeGreaterThanOrEqual(1);
    expect(outcome.runIds).toContain(runId);
    expect(await readFile(join(cwd, 'src', 'a.ts'), 'utf8')).toBe('ORIGINAL');

    const audit = await readAudit({ cwd });
    expect(audit.some((e) => e.result === 'rollback')).toBe(true);
  });

  it('honors an explicit count', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 3; i++) {
      ids.add(await seedCommit());
    }
    const outcome = await runRollbackTransaction({ cwd, count: 2 });
    expect(outcome.runIds).toHaveLength(2);
    for (const id of outcome.runIds) expect(ids.has(id)).toBe(true);
  });

  it('honors a since filter', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    await seedCommit();
    const outcome = await runRollbackTransaction({ cwd, since: past });
    expect(outcome.runIds).toHaveLength(1);
  });
});
