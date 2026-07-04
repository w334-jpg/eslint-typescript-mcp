import { describe, expect, it } from 'vitest';
import { makeErrorResult, SECURITY_NOTE } from '../src/result.js';

describe('makeErrorResult', () => {
  it('wraps Error instances and keeps the message', () => {
    const r = makeErrorResult({ tool: 'lint', cwd: '/p', error: new Error('boom') });
    expect(r.success).toBe(false);
    expect(r.error).toBe('boom');
    expect(r.tool).toBe('lint');
    expect(r.workingDirectory).toBe('/p');
    expect(r.files).toEqual([]);
    expect(r.summary.totalFiles).toBe(0);
  });

  it('stringifies non-Error thrown values', () => {
    const r = makeErrorResult({ tool: 'lint', cwd: '/p', error: 'string oops' });
    expect(r.error).toBe('string oops');
  });

  it('stringifies objects', () => {
    const r = makeErrorResult({ tool: 'lint', cwd: '/p', error: { weird: 1 } });
    expect(r.error).toContain('weird');
  });

  it('attaches the security note', () => {
    const r = makeErrorResult({ tool: 'lint', cwd: '/p', error: new Error('x') });
    expect(r.note).toBe(SECURITY_NOTE);
  });
});
