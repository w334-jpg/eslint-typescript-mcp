import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sep } from 'node:path';
import { runCommand } from '../src/run-command.js';
import { runTsc } from '../src/engines/tsc.js';

vi.mock('../src/run-command.js');

const okResult = {
  success: true,
  stdout: '',
  stderr: '',
  exitCode: 0,
  durationMs: 5,
  timedOut: false,
  signal: null,
};

const a = ['', 'p', 'a.ts'].join(sep);
const b = ['', 'p', 'b.ts'].join(sep);

describe('runTsc', () => {
  beforeEach(() => vi.mocked(runCommand).mockReset());

  it('invokes tsc --noEmit --pretty false', async () => {
    vi.mocked(runCommand).mockResolvedValue(okResult);
    await runTsc({ cwd: '/p' });
    expect(runCommand).toHaveBeenCalledWith(
      'npx',
      ['tsc', '--noEmit', '--pretty', 'false'],
      expect.anything(),
    );
  });

  it('parses and groups diagnostics', async () => {
    vi.mocked(runCommand).mockResolvedValue({
      ...okResult,
      success: false,
      exitCode: 1,
      stdout: `${a}(1,2): error TS1234: x`,
    });
    const r = await runTsc({ cwd: '/p' });
    expect(r.files).toHaveLength(1);
    expect(r.files[0].file).toBe(a);
    expect(r.files[0].errorCount).toBe(1);
  });

  it('filters diagnostics by files when provided', async () => {
    vi.mocked(runCommand).mockResolvedValue({
      ...okResult,
      success: false,
      exitCode: 1,
      stdout: `${a}(1,2): error TS1: x\n${b}(2,2): error TS2: y`,
    });
    const r = await runTsc({ cwd: '/p', files: [a] });
    expect(r.files).toHaveLength(1);
    expect(r.files[0].file).toBe(a);
  });

  it('returns empty files when tsc is clean', async () => {
    vi.mocked(runCommand).mockResolvedValue(okResult);
    const r = await runTsc({ cwd: '/p' });
    expect(r.files).toEqual([]);
    expect(r.exitCode).toBe(0);
  });
});
