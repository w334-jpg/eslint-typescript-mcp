import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runCommand } from '../src/run-command.js';
import { runEslint } from '../src/engines/eslint.js';

vi.mock('../src/run-command.js');

const okResult = {
  success: true,
  stdout: '[]',
  stderr: '',
  exitCode: 0,
  durationMs: 5,
  timedOut: false,
  signal: null,
};

describe('runEslint argument construction', () => {
  beforeEach(() => {
    vi.mocked(runCommand).mockReset();
    vi.mocked(runCommand).mockResolvedValue(okResult);
  });

  it('uses --fix and --format json when fix=true', async () => {
    await runEslint({ cwd: '/p', fix: true });
    const args = vi.mocked(runCommand).mock.calls[0]?.[1];
    expect(args).toContain('--fix');
    expect(args).toContain('--format');
    expect(args).toContain('json');
  });

  it('uses --fix-dry-run (not --fix) when dryRun=true', async () => {
    await runEslint({ cwd: '/p', fix: true, dryRun: true });
    const args = vi.mocked(runCommand).mock.calls[0]?.[1];
    expect(args).toContain('--fix-dry-run');
    expect(args).not.toContain('--fix');
  });

  it('omits fix flags entirely when fix is false', async () => {
    await runEslint({ cwd: '/p', fix: false });
    const args = vi.mocked(runCommand).mock.calls[0]?.[1];
    expect(args).not.toContain('--fix');
    expect(args).not.toContain('--fix-dry-run');
  });

  it('passes files when provided', async () => {
    await runEslint({ cwd: '/p', files: ['a.ts', 'b.ts'] });
    const args = vi.mocked(runCommand).mock.calls[0]?.[1];
    expect(args).toContain('a.ts');
    expect(args).toContain('b.ts');
  });

  it('falls back to src/ when no files given', async () => {
    await runEslint({ cwd: '/p' });
    const args = vi.mocked(runCommand).mock.calls[0]?.[1];
    expect(args).toContain('src/');
  });
});

describe('runEslint result handling', () => {
  beforeEach(() => vi.mocked(runCommand).mockReset());

  it('parses JSON output into FileDiagnostics', async () => {
    const eslintOut = [
      {
        filePath: '/p/a.ts',
        messages: [],
        errorCount: 0,
        warningCount: 0,
        fatalErrorCount: 0,
        fixableErrorCount: 0,
        fixableWarningCount: 0,
      },
    ];
    vi.mocked(runCommand).mockResolvedValue({
      ...okResult,
      stdout: JSON.stringify(eslintOut),
    });
    const r = await runEslint({ cwd: '/p' });
    expect(r.files).toHaveLength(1);
    expect(r.files[0].file).toBe('/p/a.ts');
    expect(r.files[0].status).toBe('clean');
    expect(r.fatal).toBe(false);
  });

  it('marks fatal on ESLint exit code 2', async () => {
    vi.mocked(runCommand).mockResolvedValue({
      ...okResult,
      success: false,
      exitCode: 2,
      stderr: 'config error',
      stdout: '',
    });
    const r = await runEslint({ cwd: '/p' });
    expect(r.fatal).toBe(true);
  });

  it('marks fatal on timeout', async () => {
    vi.mocked(runCommand).mockResolvedValue({
      ...okResult,
      success: false,
      exitCode: -1,
      timedOut: true,
    });
    const r = await runEslint({ cwd: '/p' });
    expect(r.fatal).toBe(true);
    expect(r.timedOut).toBe(true);
  });

  it('marks fatal when stdout is not valid JSON', async () => {
    vi.mocked(runCommand).mockResolvedValue({ ...okResult, stdout: 'not json' });
    const r = await runEslint({ cwd: '/p' });
    expect(r.fatal).toBe(true);
  });

  it('does not mark fatal on the normal lint-errors exit code 1', async () => {
    vi.mocked(runCommand).mockResolvedValue({
      ...okResult,
      success: false,
      exitCode: 1,
      stdout: '[]',
    });
    const r = await runEslint({ cwd: '/p' });
    expect(r.fatal).toBe(false);
  });
});
