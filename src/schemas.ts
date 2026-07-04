/**
 * Zod input and output schemas for MCP tools.
 *
 * These schemas drive both the protocol-level input validation and the
 * `outputSchema` advertised to clients, so the same Zod object is the single
 * source of truth for a tool's wire shape.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Reusable input field schemas
// ---------------------------------------------------------------------------

const cwdField = z
  .string()
  .optional()
  .describe(
    'Working directory for the operation. Absolute, or relative to the server process cwd. ' +
      'Must be inside the server allowed roots (extend with ESLINT_MCP_ALLOW_DIRS).',
  );

const filesField = z
  .array(z.string())
  .optional()
  .describe(
    'Files or globs to scope the operation to. When omitted, the tool runs against "src/" by default. ' +
      'For multi-agent workflows, partition files across agents so each owns a disjoint set.',
  );

const dryRunField = z
  .boolean()
  .optional()
  .describe(
    'Compute auto-fixes without writing them to disk. ESLint only. ' +
      'Files affected by a dry-run report status "would-fix".',
  );

const formatField = z
  .enum(['full', 'compact'])
  .optional()
  .describe(
    'Output verbosity. "compact" (default) returns only files with problems. ' +
      '"full" returns every file in scope, including clean ones.',
  );

const skipTypecheckField = z
  .boolean()
  .optional()
  .describe(
    'fix_all only. Skip the TypeScript typecheck step after running ESLint --fix.',
  );

const verifyField = z
  .boolean()
  .optional()
  .describe(
    'Run `tsc --noEmit` after the fix. lint_fix defaults to false; fix_all defaults to true ' +
      '(set skipTypecheck to opt out). When tsc fails and autoRollback is on, the fix is reverted.',
  );

const autoRollbackField = z
  .boolean()
  .optional()
  .describe(
    'Roll the transaction back when tsc verification fails (default true). ' +
      'On rollback, all files are restored to their pre-fix snapshot and the result is returned with isError semantics.',
  );

// ---------------------------------------------------------------------------
// Tool input schemas
// ---------------------------------------------------------------------------

export const LintInputSchema = z.object({
  cwd: cwdField,
  files: filesField,
  format: formatField,
});

export const LintFixInputSchema = z.object({
  cwd: cwdField,
  files: filesField,
  dryRun: dryRunField,
  verify: verifyField,
  autoRollback: autoRollbackField,
  format: formatField,
});

export const TypecheckInputSchema = z.object({
  cwd: cwdField,
  files: filesField,
  format: formatField,
});

export const FixAllInputSchema = z.object({
  cwd: cwdField,
  files: filesField,
  dryRun: dryRunField,
  verify: verifyField,
  autoRollback: autoRollbackField,
  format: formatField,
  skipTypecheck: skipTypecheckField,
});

export const RollbackInputSchema = z.object({
  cwd: cwdField,
  count: z
    .number()
    .int()
    .positive()
    .max(20)
    .optional()
    .describe('Roll back the last N committed transactions (default 1, max 20).'),
  since: z
    .string()
    .datetime()
    .optional()
    .describe('Alternative to count: roll back every commit since this ISO 8601 timestamp.'),
});

export const AuditLogInputSchema = z.object({
  cwd: cwdField,
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .describe('Maximum number of entries to return (default 50, max 500).'),
  tool: z
    .enum(['lint_fix', 'fix_all', 'rollback'])
    .optional()
    .describe('Filter to entries produced by a specific tool.'),
  since: z
    .string()
    .datetime()
    .optional()
    .describe('Filter to entries at or after this ISO 8601 timestamp.'),
  result: z
    .enum([
      'commit',
      'rollback',
      'error',
      'locked-out',
      'commit-partial-snapshot',
      'commit-no-snapshot',
    ])
    .optional()
    .describe('Filter to entries with a specific outcome.'),
});

// ---------------------------------------------------------------------------
// Output schema (advertised to clients via outputSchema)
// ---------------------------------------------------------------------------

const lintMessageSchema = z.object({
  ruleId: z.string().nullable(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative().optional(),
  endColumn: z.number().int().nonnegative().optional(),
  fixable: z.boolean(),
  messageId: z.string().optional(),
});

const fileDiagnosticSchema = z.object({
  file: z.string(),
  status: z.enum([
    'clean',
    'fixable',
    'would-fix',
    'fixed',
    'unfixable',
    'error',
  ]),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  messages: z.array(lintMessageSchema),
});

const toolSummarySchema = z.object({
  totalFiles: z.number().int().nonnegative(),
  totalErrors: z.number().int().nonnegative(),
  totalWarnings: z.number().int().nonnegative(),
  fixedFiles: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  scope: z.enum(['full', 'filtered']),
  dryRun: z.boolean(),
});

export const ToolResultSchema = z.object({
  tool: z.string(),
  success: z.boolean(),
  workingDirectory: z.string(),
  files: z.array(fileDiagnosticSchema),
  summary: toolSummarySchema,
  error: z.string().optional(),
  note: z.string().optional(),
});
