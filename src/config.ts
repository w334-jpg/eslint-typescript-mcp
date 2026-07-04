/**
 * Central configuration constants.
 *
 * Keeping magic numbers and version strings in one place avoids drift between
 * package.json, the MCP server handshake, and runtime behavior.
 */

/** Server version. Must stay in sync with package.json. */
export const VERSION = '1.2.0';

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

// ---------------------------------------------------------------------------
// Transaction layer (1.2.0+) — lock, snapshot, audit
// ---------------------------------------------------------------------------

/** Directory name (under cwd) holding snapshots, locks, and the audit log. */
export const CACHE_DIR_NAME = '.mcp-cache';

/** Lock staleness threshold (ms). A lock older than this is treated as abandoned. */
export const LOCK_STALE_MS = 60_000;

/** Lock holder heartbeat interval (ms). 12x under the macOS 1s utimes precision risk. */
export const LOCK_UPDATE_MS = 5_000;

/** Retry strategy for a contested lock (exponential backoff, ~5 attempts). */
export const LOCK_RETRIES = { retries: 5, minTimeout: 100, maxTimeout: 2_000 };

/** File extensions snapshotted when no explicit `files` are passed. */
export const SNAPSHOT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as readonly string[];

/** Directories skipped during snapshot expansion. */
export const SNAPSHOT_SKIP_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  CACHE_DIR_NAME,
  '.git',
] as readonly string[];

function readBytesEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Max total bytes captured per snapshot before degradation kicks in. */
export const SNAPSHOT_MAX_BYTES = readBytesEnv('ESLINT_MCP_SNAPSHOT_MAX_BYTES', 50 * 1024 * 1024);

/** Max audit log size (bytes) before rotation to a sidecar file. */
export const AUDIT_MAX_BYTES = readBytesEnv('ESLINT_MCP_AUDIT_MAX_BYTES', 10 * 1024 * 1024);

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
