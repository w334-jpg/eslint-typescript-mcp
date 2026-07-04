/**
 * Central configuration constants.
 *
 * Keeping magic numbers and version strings in one place avoids drift between
 * package.json, the MCP server handshake, and runtime behavior.
 */

/** Server version. Must stay in sync with package.json. */
export const VERSION = '1.1.0';

/** Default ESLint target when the caller does not pass `files`. */
export const DEFAULT_LINT_TARGETS: readonly string[] = ['src/'];

/** Hard timeout for any spawned child process. */
export const COMMAND_TIMEOUT_MS = 60_000;

/** Maximum bytes of child stdout retained for debugging. */
export const MAX_STDOUT_BYTES = 100_000;

/** Maximum bytes of child stderr retained for debugging. */
export const MAX_STDERR_BYTES = 10_000;

/** execa maxBuffer (10 MB) — guards against pathological output. */
export const CHILD_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

/**
 * Root directories the server is allowed to operate in.
 *
 * Defaults to the directory the server was started in. Extra roots may be
 * added via the ESLINT_MCP_ALLOW_DIRS environment variable (colon-separated),
 * which lets a trusted workspace span multiple project roots while still
 * blocking traversal outside them.
 */
export function buildAllowedRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  // Defer path resolution so the helper stays pure-ish and testable.
  // The realpath call is done in paths.ts.
  const roots: string[] = [];
  if (env.ESLINT_MCP_ALLOW_DIRS) {
    for (const entry of env.ESLINT_MCP_ALLOW_DIRS.split(':')) {
      const trimmed = entry.trim();
      if (trimmed) roots.push(trimmed);
    }
  }
  return roots;
}
