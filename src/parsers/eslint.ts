/**
 * ESLint JSON output parser.
 *
 * ESLint's `--format json` emits an array of per-file result objects. This
 * module parses them defensively (the JSON shape can vary slightly across
 * ESLint versions) and normalizes them into our domain types.
 */

import type { FileDiagnostic, FileStatus, LintMessage } from '../types.js';

/** Raw ESLint message shape (subset we care about). */
interface EslintMessage {
  ruleId: string | null;
  severity: number; // 1 = warning, 2 = error
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  messageId?: string;
  fix?: unknown;
}

/** Raw ESLint per-file result shape (subset). */
export interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
  errorCount: number;
  warningCount: number;
  fatalErrorCount?: number;
  fixableErrorCount?: number;
  fixableWarningCount?: number;
  suppressedMessages?: unknown[];
}

/**
 * Parse ESLint `--format json` stdout into raw result objects.
 *
 * Throws a SyntaxError-bearing Error when the output is not valid JSON or
 * not an array, so callers can surface engine-level failures cleanly.
 */
export function parseEslintJson(stdout: string): EslintFileResult[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      `ESLint output is not valid JSON (first 200 chars: ${trimmed.slice(0, 200)})`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error('ESLint output is not a JSON array.');
  }
  return parsed as EslintFileResult[];
}

function toSeverity(code: number): LintMessage['severity'] {
  // ESLint uses 1 for warning, 2 for error. Anything else is treated as
  // error to avoid silently hiding problems.
  return code === 1 ? 'warning' : 'error';
}

/**
 * Convert one raw ESLint file result into our domain FileDiagnostic.
 *
 * `wroteFix` is true only when fixes were actually written to disk. `dryRun`
 * is true when fixes were computed but not written.
 */
export function toFileDiagnostic(
  result: EslintFileResult,
  ctx: { dryRun: boolean; wroteFix: boolean },
): FileDiagnostic {
  const messages: LintMessage[] = (result.messages ?? []).map((m) => ({
    ruleId: m.ruleId ?? null,
    severity: toSeverity(m.severity),
    message: m.message,
    line: m.line,
    column: m.column,
    endLine: m.endLine,
    endColumn: m.endColumn,
    fixable: Boolean(m.fix),
    messageId: m.messageId,
  }));

  const errorCount = Number.isFinite(result.errorCount)
    ? result.errorCount
    : messages.filter((m) => m.severity === 'error').length;
  const warningCount = Number.isFinite(result.warningCount)
    ? result.warningCount
    : messages.filter((m) => m.severity === 'warning').length;

  return {
    file: result.filePath,
    status: deriveStatus(result, ctx),
    errorCount,
    warningCount,
    messages,
  };
}

function deriveStatus(
  result: EslintFileResult,
  ctx: { dryRun: boolean; wroteFix: boolean },
): FileStatus {
  if ((result.fatalErrorCount ?? 0) > 0) return 'error';

  const hasProblems = result.errorCount > 0 || result.warningCount > 0;
  if (!hasProblems) {
    return ctx.wroteFix ? 'fixed' : 'clean';
  }

  const fixable =
    (result.fixableErrorCount ?? 0) > 0 || (result.fixableWarningCount ?? 0) > 0;
  if (!fixable) return 'unfixable';
  return ctx.dryRun ? 'would-fix' : 'fixable';
}
