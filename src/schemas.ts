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
  format: formatField,
  skipTypecheck: skipTypecheckField,
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
