import { describe, expect, it, vi, beforeEach } from 'vitest';
import { execa } from 'execa';
import { runCommand } from '../src/run-command.js';

vi.mock('execa');

// execa's real return type is large; tests only shape the fields runCommand reads.
function mockResult(over: Partial<Record<string, unknown>>): unknown {
  return {
    command: '',
    escapedCommand: '',
    exitCode: 0,
    stdout: '',
    stderr: '',
    failed: false,
    timedOut: false,
    signal: undefined,
    options: {},
    ...over,
  };
}

describe('runCommand', () => {
  beforeEach(() => {
    vi.mocked(execa).mockReset();
  });

  it('reports success when exit code is 0', async () => {
    vi.mocked(execa).mockResolvedValue(mockResult({ exitCode: 0, stdout: 'ok' }) as never);
    const r = await runCommand('echo', ['hi'], { cwd: '/tmp' });
    expect(r.success).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.signal).toBeNull();
  });

  it('reports failure when exit code is non-zero', async () => {
    vi.mocked(execa).mockResolvedValue(mockResult({ exitCode: 1, stderr: 'err' }) as never);
    const r = await runCommand('eslint', ['x'], { cwd: '/tmp' });
    expect(r.success).toBe(false);
    expect(r.exitCode).toBe(1);
  });

  it('reports timeout when execa sets timedOut', async () => {
    vi.mocked(execa).mockResolvedValue(
      mockResult({ exitCode: undefined, timedOut: true }) as never,
    );
    const r = await runCommand('tsc', [], { cwd: '/tmp' });
    expect(r.timedOut).toBe(true);
    expect(r.success).toBe(false);
  });

  it('captures termination signal', async () => {
    vi.mocked(execa).mockResolvedValue(
      mockResult({ exitCode: undefined, signal: 'SIGTERM' }) as never,
    );
    const r = await runCommand('tsc', [], { cwd: '/tmp' });
    expect(r.signal).toBe('SIGTERM');
    expect(r.success).toBe(false);
  });

  it('falls back to -1 exit code and stderr message when execa rejects', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('spawn ENOENT'));
    const r = await runCommand('bogus', [], { cwd: '/tmp' });
    expect(r.success).toBe(false);
    expect(r.exitCode).toBe(-1);
    expect(r.stderr).toContain('spawn ENOENT');
  });

  it('passes cwd through to execa', async () => {
    vi.mocked(execa).mockResolvedValue(mockResult({}) as never);
    await runCommand('echo', [], { cwd: '/custom' });
    // execa's overloaded signature collapses the call tuple; cast to read it.
    const calls = vi.mocked(execa).mock.calls as unknown as Array<
      [string, string[], Record<string, unknown>]
    >;
    const callOpts = calls[0]?.[2];
    expect(callOpts).toMatchObject({ cwd: '/custom', shell: false, reject: false });
  });
});
