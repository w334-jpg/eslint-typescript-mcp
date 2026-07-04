/**
 * Shared domain types.
 *
 * These shapes are the contract between the engines (which run tools and
 * parse output) and the MCP tool layer (which serializes them to clients).
 * They intentionally have no runtime footprint so they can be imported
 * freely without pulling in heavy dependencies.
 */

/** Severity reported by both ESLint and tsc, normalized to a string. */
export type Severity = 'error' | 'warning';

/** Lifecycle status for a single file's diagnostics. */
export type FileStatus =
  | 'clean'        // no problems
  | 'fixable'      // has problems, all auto-fixable (post-fix may still have remnants)
  | 'would-fix'    // dry-run: would be auto-fixed
  | 'fixed'        // fix was written and the file is now clean
  | 'unfixable'    // has problems that require manual edits
  | 'error';       // engine-level failure (fatal ESLint error, parse error, etc.)

/** A single diagnostic message, normalized across engines. */
export interface LintMessage {
  ruleId: string | null;
  severity: Severity;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  fixable: boolean;
  messageId?: string;
}

/** Diagnostics for a single file. */
export interface FileDiagnostic {
  file: string;
  status: FileStatus;
  errorCount: number;
  warningCount: number;
  messages: LintMessage[];
}

/** Aggregate metrics for a tool invocation. */
export interface ToolSummary {
  totalFiles: number;
  totalErrors: number;
  totalWarnings: number;
  fixedFiles: number;
  durationMs: number;
  /** Whether `files` filtering was applied. */
  scope: 'full' | 'filtered';
  /** Whether dry-run semantics were in effect. */
  dryRun: boolean;
}

/**
 * Top-level result returned by every tool.
 *
 * The `[key: string]: unknown` index signature lets this object satisfy the
 * MCP SDK's structuredContent contract (`{ [x: string]: unknown }`) without
 * forcing callers to cast. Specific fields above still take precedence for
 * type-narrowed access.
 */
export interface ToolResult {
  tool: string;
  success: boolean;
  workingDirectory: string;
  files: FileDiagnostic[];
  summary: ToolSummary;
  error?: string;
  /** Advisory note for the consumer (e.g. security warning). */
  note?: string;
  [key: string]: unknown;
}

/** Normalized result of a spawned child process. */
export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  signal: string | null;
}
