import { describe, expect, it } from 'vitest';
import { parseEslintJson, toFileDiagnostic } from '../src/parsers/eslint.js';

describe('parseEslintJson', () => {
  it('returns empty array for empty input', () => {
    expect(parseEslintJson('')).toEqual([]);
    expect(parseEslintJson('   ')).toEqual([]);
  });

  it('parses a single-file result array', () => {
    const stdout = JSON.stringify([
      {
        filePath: '/p/src/a.ts',
        messages: [
          {
            ruleId: 'no-unused-vars',
            severity: 2,
            message: "'x' is defined but never used.",
            line: 10,
            column: 5,
            messageId: 'unusedVar',
            fix: { range: [0, 10], text: '' },
          },
        ],
        errorCount: 1,
        warningCount: 0,
        fatalErrorCount: 0,
        fixableErrorCount: 1,
        fixableWarningCount: 0,
      },
    ]);
    const parsed = parseEslintJson(stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].filePath).toBe('/p/src/a.ts');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseEslintJson('not json')).toThrow(/not valid JSON/);
  });

  it('throws when output is not an array', () => {
    expect(() => parseEslintJson('{"foo":1}')).toThrow(/not a JSON array/);
  });
});

describe('toFileDiagnostic', () => {
  const baseResult = {
    filePath: '/p/src/a.ts',
    messages: [],
    errorCount: 0,
    warningCount: 0,
    fatalErrorCount: 0,
    fixableErrorCount: 0,
    fixableWarningCount: 0,
  };

  it('clean file with no fix → status clean', () => {
    const d = toFileDiagnostic(baseResult, { dryRun: false, wroteFix: false });
    expect(d.status).toBe('clean');
    expect(d.errorCount).toBe(0);
  });

  it('clean file after write fix → status fixed', () => {
    const d = toFileDiagnostic(baseResult, { dryRun: false, wroteFix: true });
    expect(d.status).toBe('fixed');
  });

  it('fatal error → status error', () => {
    const d = toFileDiagnostic(
      { ...baseResult, fatalErrorCount: 1, errorCount: 1 },
      { dryRun: false, wroteFix: false },
    );
    expect(d.status).toBe('error');
  });

  it('fixable errors, no fix → status fixable', () => {
    const d = toFileDiagnostic(
      {
        ...baseResult,
        errorCount: 2,
        fixableErrorCount: 2,
        messages: [
          {
            ruleId: 'semi',
            severity: 2,
            message: 'Missing semicolon.',
            line: 1,
            column: 1,
            fix: { range: [0, 0], text: ';' },
          },
        ],
      },
      { dryRun: false, wroteFix: false },
    );
    expect(d.status).toBe('fixable');
    expect(d.messages[0].fixable).toBe(true);
    expect(d.messages[0].severity).toBe('error');
  });

  it('fixable errors, dry run → status would-fix', () => {
    const d = toFileDiagnostic(
      { ...baseResult, errorCount: 1, fixableErrorCount: 1 },
      { dryRun: true, wroteFix: false },
    );
    expect(d.status).toBe('would-fix');
  });

  it('only unfixable errors → status unfixable', () => {
    const d = toFileDiagnostic(
      {
        ...baseResult,
        errorCount: 1,
        fixableErrorCount: 0,
        messages: [
          { ruleId: 'no-console', severity: 2, message: 'oops', line: 1, column: 1 },
        ],
      },
      { dryRun: false, wroteFix: false },
    );
    expect(d.status).toBe('unfixable');
    expect(d.messages[0].fixable).toBe(false);
  });

  it('severity 1 maps to warning', () => {
    const d = toFileDiagnostic(
      {
        ...baseResult,
        warningCount: 1,
        messages: [
          { ruleId: 'no-console', severity: 1, message: 'warn', line: 1, column: 1 },
        ],
      },
      { dryRun: false, wroteFix: false },
    );
    expect(d.messages[0].severity).toBe('warning');
  });

  it('severity unknown defaults to error', () => {
    const d = toFileDiagnostic(
      {
        ...baseResult,
        errorCount: 1,
        messages: [
          // Severity 99 is a valid number; the parser must coerce unknown
          // severities to 'error' rather than silently hiding them.
          { ruleId: 'x', severity: 99, message: 'm', line: 1, column: 1 },
        ],
      },
      { dryRun: false, wroteFix: false },
    );
    expect(d.messages[0].severity).toBe('error');
  });

  it('null ruleId is preserved', () => {
    const d = toFileDiagnostic(
      {
        ...baseResult,
        errorCount: 1,
        messages: [{ ruleId: null, severity: 2, message: 'm', line: 1, column: 1 }],
      },
      { dryRun: false, wroteFix: false },
    );
    expect(d.messages[0].ruleId).toBeNull();
  });

  it('falls back to message-derived counts when top-level counts are absent', () => {
    const d = toFileDiagnostic(
      {
        filePath: '/p/src/a.ts',
        messages: [
          { ruleId: 'x', severity: 2, message: 'e1', line: 1, column: 1 },
          { ruleId: 'y', severity: 1, message: 'w1', line: 2, column: 1 },
        ],
        errorCount: Number.NaN,
        warningCount: Number.NaN,
      },
      { dryRun: false, wroteFix: false },
    );
    expect(d.errorCount).toBe(1);
    expect(d.warningCount).toBe(1);
  });
});
