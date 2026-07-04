import { describe, expect, it } from 'vitest';
import { sep } from 'node:path';
import { buildAllowedRoots } from '../src/config.js';
import {
  AllowedPathError,
  getAllowedRoots,
  isWithinAllowed,
  normalizeFiles,
  validateCwd,
} from '../src/paths.js';

describe('buildAllowedRoots', () => {
  it('returns empty array when env is absent', () => {
    expect(buildAllowedRoots({})).toEqual([]);
  });

  it('parses colon-separated ESLINT_MCP_ALLOW_DIRS', () => {
    expect(buildAllowedRoots({ ESLINT_MCP_ALLOW_DIRS: '/a:/b' })).toEqual(['/a', '/b']);
  });

  it('trims whitespace and skips empty entries', () => {
    expect(buildAllowedRoots({ ESLINT_MCP_ALLOW_DIRS: ' /a  :  :/b ' })).toEqual(['/a', '/b']);
  });
});

describe('getAllowedRoots', () => {
  it('always includes process cwd', () => {
    const roots = getAllowedRoots({});
    expect(roots).toContain(process.cwd());
  });

  it('merges cwd with env-provided roots', () => {
    const roots = getAllowedRoots({ ESLINT_MCP_ALLOW_DIRS: '/a:/b' });
    expect(roots).toContain(process.cwd());
    expect(roots).toContain('/a');
    expect(roots).toContain('/b');
  });
});

describe('isWithinAllowed', () => {
  const roots = ['/projects/main'];

  it('accepts path equal to a root', () => {
    expect(isWithinAllowed('/projects/main', roots)).toBe(true);
  });

  it('accepts path nested below a root', () => {
    expect(isWithinAllowed('/projects/main/src/index.ts', roots)).toBe(true);
  });

  it('rejects sibling directory with shared prefix', () => {
    // /projects/mainland must NOT be treated as inside /projects/main
    expect(isWithinAllowed('/projects/mainland/x', roots)).toBe(false);
  });

  it('rejects path outside all roots', () => {
    expect(isWithinAllowed('/etc/passwd', roots)).toBe(false);
  });
});

describe('validateCwd', () => {
  const roots = ['/projects/main'];

  it('returns resolved absolute path inside root', () => {
    expect(validateCwd('/projects/main/src', roots)).toBe(
      `${['', 'projects', 'main', 'src'].join(sep)}`,
    );
  });

  it('resolves relative segments before checking', () => {
    expect(validateCwd('/projects/main/./src/../src', roots)).toBe(
      ['', 'projects', 'main', 'src'].join(sep),
    );
  });

  it('throws AllowedPathError on traversal escape', () => {
    expect(() => validateCwd('/projects/main/../../../etc', roots)).toThrow(AllowedPathError);
  });

  it('throws on absolute path outside root', () => {
    expect(() => validateCwd('/etc', roots)).toThrow(AllowedPathError);
  });
});

describe('normalizeFiles', () => {
  const roots = ['/projects/main'];

  it('resolves relative paths against cwd', () => {
    const result = normalizeFiles(['src/a.ts', 'src/b.ts'], '/projects/main', roots);
    expect(result).toEqual([
      ['', 'projects', 'main', 'src', 'a.ts'].join(sep),
      ['', 'projects', 'main', 'src', 'b.ts'].join(sep),
    ]);
  });

  it('keeps already-absolute paths inside root', () => {
    const abs = ['', 'projects', 'main', 'src', 'x.ts'].join(sep);
    expect(normalizeFiles([abs], '/projects/main', roots)).toEqual([abs]);
  });

  it('rejects file path escaping the roots', () => {
    expect(() => normalizeFiles(['../../etc/passwd'], '/projects/main', roots)).toThrow(
      AllowedPathError,
    );
  });

  it('rejects empty entries', () => {
    expect(() => normalizeFiles([''], '/projects/main', roots)).toThrow(AllowedPathError);
  });

  it('rejects file outside root before cwd validation', () => {
    expect(() => normalizeFiles(['/etc/passwd'], '/projects/main', roots)).toThrow(
      AllowedPathError,
    );
  });
});
