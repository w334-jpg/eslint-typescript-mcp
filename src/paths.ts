/**
 * Path safety helpers.
 *
 * The server may be driven by an LLM, whose outputs are not fully trusted.
 * All working-directory and file arguments are therefore validated against
 * an allowlist of roots before being passed to child processes.
 */

import { isAbsolute, normalize, resolve as resolvePath, sep } from 'node:path';
import { buildAllowedRoots } from './config.js';

/** Resolve and de-duplicate the allowed root directories. */
export function getAllowedRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [process.cwd(), ...buildAllowedRoots(env)];
  const resolved = roots.map((r) => resolvePath(r));
  return Array.from(new Set(resolved));
}

/**
 * Return true when `target` is equal to or nested below one of the allowed
 * roots. Symlinks are not resolved here; callers that need defence against
 * symlink traversal should pre-resolve with `fs.realpath`.
 */
export function isWithinAllowed(target: string, roots: string[]): boolean {
  const resolved = resolvePath(target);
  return roots.some((root) => containsPath(root, resolved));
}

function containsPath(parent: string, child: string): boolean {
  if (parent === child) return true;
  const parentWithSep = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(parentWithSep);
}

/**
 * Validate a working-directory argument. Returns the resolved absolute path.
 * Throws when the path escapes the allowlist.
 */
export function validateCwd(cwd: string, roots: string[] = getAllowedRoots()): string {
  const resolved = resolvePath(cwd);
  if (!isWithinAllowed(resolved, roots)) {
    throw new AllowedPathError(
      `Working directory "${cwd}" is outside the allowed roots. ` +
        `Allowed roots: ${roots.join(', ')}. ` +
        `Extend via the ESLINT_MCP_ALLOW_DIRS environment variable.`,
    );
  }
  return resolved;
}

/**
 * Normalize caller-supplied file/glob arguments to absolute paths and reject
 * any that escape the allowlist. Globs are preserved verbatim (ESLint expands
 * them); only path-traversal safety is enforced here.
 */
export function normalizeFiles(
  files: string[],
  cwd: string,
  roots: string[] = getAllowedRoots(),
): string[] {
  const base = validateCwd(cwd, roots);
  return files.map((entry) => {
    const raw = entry.trim();
    if (!raw) {
      throw new AllowedPathError('Empty file argument is not allowed.');
    }
    const abs = isAbsolute(raw) ? normalize(raw) : resolvePath(base, raw);
    if (!isWithinAllowed(abs, roots)) {
      throw new AllowedPathError(
        `Path "${entry}" escapes the allowed roots.`,
      );
    }
    return abs;
  });
}

/** Error subclass so callers can distinguish policy failures from bugs. */
export class AllowedPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllowedPathError';
  }
}
