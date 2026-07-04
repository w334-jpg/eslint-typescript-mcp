import { describe, expect, it } from 'vitest';
import { sep } from 'node:path';
import { filterByFiles, groupByFile, parseTscOutput } from '../src/parsers/tsc.js';

const join = (...parts: string[]) => ['', ...parts].join(sep);

describe('parseTscOutput', () => {
  it('parses a canonical error line', () => {
    const diags = parseTscOutput(
      `${join('p', 'src', 'a.ts')}(12,34): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`,
      '',
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]).toEqual({
      file: join('p', 'src', 'a.ts'),
      line: 12,
      column: 34,
      severity: 'error',
      code: 'TS2345',
      message: "Argument of type 'string' is not assignable to parameter of type 'number'.",
    });
  });

  it('parses warnings', () => {
    const diags = parseTscOutput(
      `${join('p', 'src', 'b.ts')}(1,2): warning TS6133: 'x' is declared but never read.`,
      '',
    );
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].code).toBe('TS6133');
  });

  it('ignores non-diagnostic banner and summary lines', () => {
    const stdout = [
      '',
      `Found 3 errors. Watching for file changes.`,
      `${join('p', 'src', 'a.ts')}(1,2): error TS1234: x`,
    ].join('\n');
    const diags = parseTscOutput(stdout, '');
    expect(diags).toHaveLength(1);
  });

  it('reads both stdout and stderr', () => {
    const diags = parseTscOutput(
      `${join('p', 'a.ts')}(1,1): error TS1: x`,
      `${join('p', 'b.ts')}(2,2): error TS2: y`,
    );
    expect(diags).toHaveLength(2);
  });
});

describe('filterByFiles', () => {
  const a = join('p', 'src', 'a.ts');
  const b = join('p', 'src', 'b.ts');

  it('returns all when files list is empty', () => {
    const diags = [
      { file: a, line: 1, column: 1, severity: 'error' as const, code: 'TS1', message: 'x' },
    ];
    expect(filterByFiles(diags, [])).toHaveLength(1);
  });

  it('keeps only diagnostics whose file is requested', () => {
    const diags = [
      { file: a, line: 1, column: 1, severity: 'error' as const, code: 'TS1', message: 'a' },
      { file: b, line: 2, column: 2, severity: 'error' as const, code: 'TS2', message: 'b' },
    ];
    expect(filterByFiles(diags, [a])).toEqual([diags[0]]);
  });
});

describe('groupByFile', () => {
  it('groups diagnostics and counts severities', () => {
    const a = join('p', 'a.ts');
    const diags = [
      { file: a, line: 1, column: 1, severity: 'error' as const, code: 'TS1', message: 'e1' },
      { file: a, line: 2, column: 2, severity: 'warning' as const, code: 'TS2', message: 'w1' },
      { file: a, line: 3, column: 3, severity: 'error' as const, code: 'TS3', message: 'e2' },
    ];
    const grouped = groupByFile(diags);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].errorCount).toBe(2);
    expect(grouped[0].warningCount).toBe(1);
    expect(grouped[0].status).toBe('unfixable');
    expect(grouped[0].messages.every((m) => m.fixable === false)).toBe(true);
  });

  it('keeps separate files apart', () => {
    const a = join('p', 'a.ts');
    const b = join('p', 'b.ts');
    const grouped = groupByFile([
      { file: a, line: 1, column: 1, severity: 'error' as const, code: 'TS1', message: 'a' },
      { file: b, line: 1, column: 1, severity: 'error' as const, code: 'TS2', message: 'b' },
    ]);
    expect(grouped.map((g) => g.file).sort()).toEqual([a, b].sort());
  });
});
