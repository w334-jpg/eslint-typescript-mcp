import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAudit } from '../src/audit.js';
import { runEslint, type EslintResult } from '../src/engines/eslint.js';
import { runTsc, type TscResult } from '../src/engines/tsc.js';
import { runFixTransaction } from '../src/transaction.js';
import type { FileDiagnostic } from '../src/types.js';

vi.mock('../src/engines/eslint.js', () => ({ runEslint: vi.fn() }));
vi.mock('../src/engines/tsc.js', () => ({ runTsc: vi.fn() }));

let cwd: string;
const A = () => join(cwd, 'src', 'a.ts');

function eslintOk(files: FileDiagnostic[] = [], mutate = false): EslintResult {
  return {
    files,
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    fatal: false,
    rawStdout: '',
    rawStderr: '',
    _mutate: mutate,
  } as EslintResult & { _mutate: boolean };
}

function tscFail(): TscResult {
  return {
    files: [
      {
        file: A(),
        status: 'unfixable',
        errorCount: 1,
        warningCount: 0,
        messages: [
          { ruleId: 'TS1234', severity: 'error', message: 'bad', line: 1, column: 1, fixable: false },
        ],
      },
    ],
    exitCode: 1,
    durationMs: 1,
    timedOut: false,
    rawStdout: '',
    rawStderr: '',
  };
}

function fixedFile(): FileDiagnostic {
  return { file: A(), status: 'fixed', errorCount: 0, warningCount: 0, messages: [] };
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'mcp-tx-'));
  process.env.ESLINT_MCP_ALLOW_DIRS = cwd;
  await mkdir(join(cwd, 'src'), { recursive: true });
  await writeFile(A(), 'ORIGINAL');
  vi.mocked(runEslint).mockReset();
  vi.mocked(runTsc).mockReset();
});

afterEach(async () => {
  delete process.env.ESLINT_MCP_ALLOW_DIRS;
  await rm(cwd, { recursive: true, force: true });
});

describe('runFixTransaction — dry run', () => {
  it('skips lock, snapshot, and audit on dryRun', async () => {
    vi.mocked(runEslint).mockResolvedValue(eslintOk());
    const result = await runFixTransaction({ tool: 'lint_fix', cwd, dryRun: true });
    expect(result.success).toBe(true);
    expect(result.summary.dryRun).toBe(true);
    expect(vi.mocked(runTsc)).not.toHaveBeenCalled();
    const audit = await readAudit({ cwd });
    expect(audit).toHaveLength(0);
  });
});

describe('runFixTransaction — commit', () => {
  it('snapshots, fixes, and audit-logs a commit', async () => {
    vi.mocked(runEslint).mockImplementation(async (opts) => {
      if (opts.fix) await writeFile(A(), 'FIXED');
      return eslintOk([fixedFile()]);
    });
    const result = await runFixTransaction({ tool: 'lint_fix', cwd });
    expect(result.success).toBe(true);
    expect(await readFile(A(), 'utf8')).toBe('FIXED');
    const audit = await readAudit({ cwd });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.result).toBe('commit');
  });

  it('flags commit-partial-snapshot when ESLint writes outside the snapshot', async () => {
    vi.mocked(runEslint).mockImplementation(async (opts) => {
      if (opts.fix) {
        await writeFile(A(), 'FIXED');
        // Simulate ESLint writing a file that was NOT snapshotted.
        await mkdir(join(cwd, 'src', 'extra'), { recursive: true });
        await writeFile(join(cwd, 'src', 'extra', 'unsnapshotted.ts'), 'NEW');
      }
      return eslintOk([
        fixedFile(),
        {
          file: join(cwd, 'src', 'extra', 'unsnapshotted.ts'),
          status: 'fixed',
          errorCount: 0,
          warningCount: 0,
          messages: [],
        },
      ]);
    });
    const result = await runFixTransaction({ tool: 'lint_fix', cwd });
    expect(result.success).toBe(true);
    const audit = await readAudit({ cwd });
    expect(audit[0]!.result).toBe('commit-partial-snapshot');
    expect(result.note).toContain('outside the snapshotted set');
  });
});

describe('runFixTransaction — rollback', () => {
  it('restores files when tsc verify fails and autoRollback is on', async () => {
    vi.mocked(runEslint).mockImplementation(async (opts) => {
      if (opts.fix) await writeFile(A(), 'FIXED');
      return eslintOk([fixedFile()]);
    });
    vi.mocked(runTsc).mockResolvedValue(tscFail());
    const result = await runFixTransaction({ tool: 'fix_all', cwd });
    expect(result.success).toBe(false);
    expect(await readFile(A(), 'utf8')).toBe('ORIGINAL');
    const audit = await readAudit({ cwd });
    expect(audit[0]!.result).toBe('rollback');
    expect(audit[0]!.rollbackReason).toBe('tsc-verify-failed');
  });

  it('commits when tsc fails but autoRollback is false', async () => {
    vi.mocked(runEslint).mockImplementation(async (opts) => {
      if (opts.fix) await writeFile(A(), 'FIXED');
      return eslintOk([fixedFile()]);
    });
    vi.mocked(runTsc).mockResolvedValue(tscFail());
    const result = await runFixTransaction({ tool: 'fix_all', cwd, autoRollback: false });
    expect(result.success).toBe(false);
    expect(await readFile(A(), 'utf8')).toBe('FIXED');
    const audit = await readAudit({ cwd });
    expect(audit[0]!.result).toBe('commit');
  });

  it('rolls back on tsc crash even when only tscFatal is the trigger', async () => {
    vi.mocked(runEslint).mockImplementation(async (opts) => {
      if (opts.fix) await writeFile(A(), 'FIXED');
      return eslintOk([fixedFile()]);
    });
    vi.mocked(runTsc).mockResolvedValue({
      files: [],
      exitCode: -1,
      durationMs: 1,
      timedOut: true,
      rawStdout: '',
      rawStderr: '',
    });
    const result = await runFixTransaction({ tool: 'fix_all', cwd });
    expect(result.success).toBe(false);
    expect(await readFile(A(), 'utf8')).toBe('ORIGINAL');
    const audit = await readAudit({ cwd });
    expect(audit[0]!.rollbackReason).toBe('tsc-crash');
  });
});

describe('runFixTransaction — no snapshot available', () => {
  it('commits with commit-no-snapshot when the source tree is empty', async () => {
    // Remove src so expandScope yields nothing and snapshot returns null.
    await rm(join(cwd, 'src'), { recursive: true, force: true });
    vi.mocked(runEslint).mockResolvedValue(eslintOk([]));
    const result = await runFixTransaction({ tool: 'lint_fix', cwd });
    expect(result.success).toBe(true);
    const audit = await readAudit({ cwd });
    expect(audit[0]!.result).toBe('commit-no-snapshot');
    expect(result.note).toContain('snapshot was skipped');
  });
});
