import { describe, expect, it } from 'vitest';
import { compactFiles, countFixedFiles, pickFiles, summarize, SECURITY_NOTE } from '../src/result.js';
import type { FileDiagnostic } from '../src/types.js';

const clean: FileDiagnostic = {
  file: '/p/clean.ts',
  status: 'clean',
  errorCount: 0,
  warningCount: 0,
  messages: [],
};

const errored: FileDiagnostic = {
  file: '/p/bad.ts',
  status: 'unfixable',
  errorCount: 2,
  warningCount: 1,
  messages: [
    { ruleId: 'x', severity: 'error', message: 'e1', line: 1, column: 1, fixable: false },
    { ruleId: 'y', severity: 'error', message: 'e2', line: 2, column: 1, fixable: false },
    { ruleId: 'z', severity: 'warning', message: 'w1', line: 3, column: 1, fixable: false },
  ],
};

const fixed: FileDiagnostic = {
  file: '/p/fixed.ts',
  status: 'fixed',
  errorCount: 0,
  warningCount: 0,
  messages: [],
};

describe('compactFiles', () => {
  it('drops clean files', () => {
    expect(compactFiles([clean, errored])).toEqual([errored]);
  });

  it('keeps files with warnings even when status is clean-ish', () => {
    const warnOnly: FileDiagnostic = { ...clean, warningCount: 1 };
    expect(compactFiles([warnOnly])).toEqual([warnOnly]);
  });
});

describe('pickFiles', () => {
  it('returns full set when format is full', () => {
    expect(pickFiles([clean, errored], 'full')).toEqual([clean, errored]);
  });

  it('compacts when format is compact', () => {
    expect(pickFiles([clean, errored], 'compact')).toEqual([errored]);
  });

  it('compacts by default', () => {
    expect(pickFiles([clean, errored], undefined)).toEqual([errored]);
  });
});

describe('countFixedFiles', () => {
  it('counts only fixed-status files', () => {
    expect(countFixedFiles([clean, errored, fixed])).toBe(1);
  });
});

describe('summarize', () => {
  it('aggregates errors and warnings across files', () => {
    const s = summarize([clean, errored], {
      dryRun: false,
      scope: 'full',
      durationMs: 100,
      fixedFiles: 0,
    });
    expect(s.totalFiles).toBe(2);
    expect(s.totalErrors).toBe(2);
    expect(s.totalWarnings).toBe(1);
    expect(s.fixedFiles).toBe(0);
    expect(s.scope).toBe('full');
    expect(s.dryRun).toBe(false);
  });

  it('reflects dryRun and fixedFiles', () => {
    const s = summarize([fixed], {
      dryRun: true,
      scope: 'filtered',
      durationMs: 5,
      fixedFiles: 0,
    });
    expect(s.dryRun).toBe(true);
    expect(s.scope).toBe('filtered');
  });
});

describe('SECURITY_NOTE', () => {
  it('warns to treat diagnostics as untrusted data', () => {
    expect(SECURITY_NOTE.toLowerCase()).toContain('untrusted');
  });
});
