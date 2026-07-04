import { describe, expect, it } from 'vitest';
import {
  FixAllInputSchema,
  LintFixInputSchema,
  LintInputSchema,
  ToolResultSchema,
  TypecheckInputSchema,
} from '../src/schemas.js';

describe('LintInputSchema', () => {
  it('accepts empty input', () => {
    expect(LintInputSchema.parse({})).toEqual({});
  });

  it('accepts cwd, files, format', () => {
    const out = LintInputSchema.parse({ cwd: '/p', files: ['a.ts'], format: 'full' });
    expect(out).toEqual({ cwd: '/p', files: ['a.ts'], format: 'full' });
  });

  it('rejects invalid format', () => {
    expect(() => LintInputSchema.parse({ format: 'bogus' })).toThrow();
  });
});

describe('LintFixInputSchema', () => {
  it('accepts dryRun', () => {
    const out = LintFixInputSchema.parse({ dryRun: true });
    expect(out.dryRun).toBe(true);
  });
});

describe('FixAllInputSchema', () => {
  it('accepts skipTypecheck', () => {
    const out = FixAllInputSchema.parse({ skipTypecheck: true });
    expect(out.skipTypecheck).toBe(true);
  });

  it('accepts the full set of fields', () => {
    const out = FixAllInputSchema.parse({
      cwd: '/p',
      files: ['a.ts'],
      dryRun: false,
      format: 'compact',
      skipTypecheck: false,
    });
    expect(out.cwd).toBe('/p');
    expect(out.files).toEqual(['a.ts']);
  });
});

describe('TypecheckInputSchema', () => {
  it('parses minimal input', () => {
    expect(TypecheckInputSchema.parse({})).toEqual({});
  });
});

describe('ToolResultSchema', () => {
  const validResult = {
    tool: 'lint',
    success: true,
    workingDirectory: '/p',
    files: [
      {
        file: '/p/a.ts',
        status: 'fixable',
        errorCount: 1,
        warningCount: 0,
        messages: [
          {
            ruleId: 'semi',
            severity: 'error',
            message: 'Missing semicolon.',
            line: 1,
            column: 1,
            fixable: true,
          },
        ],
      },
    ],
    summary: {
      totalFiles: 1,
      totalErrors: 1,
      totalWarnings: 0,
      fixedFiles: 0,
      durationMs: 10,
      scope: 'full',
      dryRun: false,
    },
  };

  it('validates a well-formed result', () => {
    expect(() => ToolResultSchema.parse(validResult)).not.toThrow();
  });

  it('rejects an unknown status', () => {
    const bad = {
      ...validResult,
      files: [{ ...validResult.files[0], status: 'bogus' }],
    };
    expect(() => ToolResultSchema.parse(bad)).toThrow();
  });

  it('rejects a non-integer count', () => {
    const bad = {
      ...validResult,
      summary: { ...validResult.summary, totalErrors: 1.5 },
    };
    expect(() => ToolResultSchema.parse(bad)).toThrow();
  });
});
