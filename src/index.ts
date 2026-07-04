#!/usr/bin/env node
/**
 * MCP server entry point.
 *
 * Registers six tools that expose ESLint, TypeScript, and a transaction
 * safety layer to LLM clients:
 *
 *   lint         — read-only ESLint
 *   lint_fix     — ESLint --fix under a per-cwd lock, with snapshot + rollback
 *   typecheck    — read-only tsc --noEmit
 *   fix_all      — lint_fix + tsc verify, atomic with auto-rollback
 *   rollback     — restore files from a prior fix transaction
 *   audit_log    — read the JSONL audit trail
 *
 * Every fix is an atomic, audited, reversible transaction (see
 * `src/transaction.ts`). Concurrent agents serialize cleanly on a
 * cross-process per-cwd lock (`src/lock.ts`).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VERSION } from './config.js';
import { readAudit, type AuditEntry } from './audit.js';
import { runEslint } from './engines/eslint.js';
import { runTsc } from './engines/tsc.js';
import { logger } from './logger.js';
import { normalizeFiles, validateCwd } from './paths.js';
import { runRollbackTransaction } from './rollback.js';
import { makeErrorResult, pickFiles, summarize, SECURITY_NOTE } from './result.js';
import {
  AuditLogInputSchema,
  FixAllInputSchema,
  LintFixInputSchema,
  LintInputSchema,
  RollbackInputSchema,
  ToolResultSchema,
  TypecheckInputSchema,
} from './schemas.js';
import { runFixTransaction } from './transaction.js';
import type { FileDiagnostic, FileStatus, ToolResult } from './types.js';

interface BaseToolInput {
  cwd?: string;
  files?: string[];
  format?: 'full' | 'compact';
}

interface LintFixInput extends BaseToolInput {
  dryRun?: boolean;
  verify?: boolean;
  autoRollback?: boolean;
}

interface FixAllInput extends LintFixInput {
  skipTypecheck?: boolean;
}

interface RollbackToolInput {
  cwd?: string;
  count?: number;
  since?: string;
}

interface AuditLogToolInput {
  cwd?: string;
  limit?: number;
  tool?: AuditEntry['tool'];
  since?: string;
  result?: AuditEntry['result'];
}

interface McpToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: ToolResult;
  isError?: boolean;
  [key: string]: unknown;
}

function serialize(result: ToolResult): string {
  return JSON.stringify(result, null, 2);
}

function resolveCwd(input: { cwd?: string }): string {
  return validateCwd(input.cwd ?? process.cwd());
}

function resolveScope(input: BaseToolInput): { cwd: string; files: string[] | undefined } {
  const cwd = resolveCwd(input);
  const files =
    input.files && input.files.length > 0 ? normalizeFiles(input.files, cwd) : undefined;
  return { cwd, files };
}

/**
 * Wrap an engine invocation with cwd/files validation and uniform error
 * handling. Any thrown Error becomes an `isError: true` MCP response while
 * still returning a structured payload.
 */
async function safeRun(params: {
  tool: string;
  input: BaseToolInput;
  run: (cwd: string, files: string[] | undefined) => Promise<ToolResult>;
}): Promise<McpToolResponse> {
  try {
    const { cwd, files } = resolveScope(params.input);
    const result = await params.run(cwd, files);
    return {
      content: [{ type: 'text', text: serialize(result) }],
      structuredContent: result,
    };
  } catch (error) {
    const fallbackCwd = typeof params.input.cwd === 'string' ? params.input.cwd : process.cwd();
    const result = makeErrorResult({ tool: params.tool, cwd: fallbackCwd, error });
    return {
      content: [{ type: 'text', text: serialize(result) }],
      structuredContent: result,
      isError: true,
    };
  }
}

const server = new McpServer({
  name: 'eslint-typescript-mcp',
  version: VERSION,
});

logger.info(`Initializing eslint-typescript-mcp v${VERSION}`);

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

// ---------------------------------------------------------------------------
// Tool: lint
// ---------------------------------------------------------------------------

server.registerTool(
  'lint',
  {
    title: 'Run ESLint',
    description: [
      'Run ESLint to find and report code quality issues across the requested scope.',
      '',
      'Use this to:',
      '- Check for linting errors before commits',
      '- Audit existing code for problems',
      '- Get a structured per-file view that survives parallel agent review',
      '',
      'Set `files` to scope to a specific file set (useful when multiple agents work in parallel).',
      'Set `format: "full"` to see clean files too; the default "compact" omits them.',
      '',
      SECURITY_NOTE,
    ].join('\n'),
    inputSchema: LintInputSchema,
    outputSchema: ToolResultSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async (input: BaseToolInput) =>
    safeRun({
      tool: 'lint',
      input,
      run: async (cwd, files) => {
        const ran = await runEslint({ cwd, files, fix: false });
        return {
          tool: 'lint',
          success: !ran.fatal,
          workingDirectory: cwd,
          files: pickFiles(ran.files, input.format),
          summary: summarize(ran.files, {
            dryRun: false,
            scope: files ? 'filtered' : 'full',
            durationMs: ran.durationMs,
            fixedFiles: 0,
          }),
          note: SECURITY_NOTE,
        };
      },
    }),
);

// ---------------------------------------------------------------------------
// Tool: lint_fix
// ---------------------------------------------------------------------------

server.registerTool(
  'lint_fix',
  {
    title: 'Fix ESLint Errors',
    description: [
      'Run ESLint with auto-fix under a per-cwd cross-process lock. The fix is a transaction:',
      'a snapshot is taken before the fix, and on tsc verification failure (when autoRollback',
      'is on, the default) the snapshot is restored so the on-disk source returns to its',
      'pre-fix state.',
      '',
      'With `dryRun: true`, fixes are computed but not written, no lock is taken, and no',
      'snapshot is captured.',
      '',
      'Per-file targeting via `files` lets multiple agents fix disjoint sets without',
      'clobbering each other. Concurrent transactions on the same cwd serialize on the lock.',
      '',
      SECURITY_NOTE,
    ].join('\n'),
    inputSchema: LintFixInputSchema,
    outputSchema: ToolResultSchema,
    annotations: WRITE_ANNOTATIONS,
  },
  async (input: LintFixInput) =>
    safeRun({
      tool: 'lint_fix',
      input,
      run: (cwd, files) =>
        runFixTransaction({
          tool: 'lint_fix',
          cwd,
          files,
          dryRun: input.dryRun,
          verify: input.verify,
          autoRollback: input.autoRollback,
          format: input.format,
        }),
    }),
);

// ---------------------------------------------------------------------------
// Tool: typecheck
// ---------------------------------------------------------------------------

server.registerTool(
  'typecheck',
  {
    title: 'Run TypeScript Type Check',
    description: [
      'Run `tsc --noEmit` to validate TypeScript types.',
      '',
      'When `files` is provided, the result is filtered to that file set. Note that tsc',
      'still compiles the whole project for type correctness; the filter only controls',
      'which diagnostics are surfaced. The `summary.scope` field reflects this.',
      '',
      SECURITY_NOTE,
    ].join('\n'),
    inputSchema: TypecheckInputSchema,
    outputSchema: ToolResultSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async (input: BaseToolInput) =>
    safeRun({
      tool: 'typecheck',
      input,
      run: async (cwd, files) => {
        const ran = await runTsc({ cwd, files });
        return {
          tool: 'typecheck',
          success: ran.exitCode === 0,
          workingDirectory: cwd,
          files: pickFiles(ran.files, input.format),
          summary: summarize(ran.files, {
            dryRun: false,
            scope: files ? 'filtered' : 'full',
            durationMs: ran.durationMs,
            fixedFiles: 0,
          }),
          note: SECURITY_NOTE,
        };
      },
    }),
);

// ---------------------------------------------------------------------------
// Tool: fix_all
// ---------------------------------------------------------------------------

server.registerTool(
  'fix_all',
  {
    title: 'Fix ESLint and TypeScript Errors',
    description: [
      'Atomic lint_fix + tsc verify in one transaction.',
      '',
      'The order is deliberate: lint fixes land before type checking so any type errors',
      'introduced or exposed by the fix are detected in the same call. When tsc fails and',
      '`autoRollback` is on (the default), every file written by ESLint is restored from the',
      'pre-fix snapshot before the lock is released, so the project is left unchanged.',
      '',
      'Set `dryRun: true` to preview lint fixes without writing them.',
      'Set `skipTypecheck: true` to skip the verification step (and its rollback trigger).',
      '',
      'For multi-agent workflows, partition `files` across agents; concurrent transactions',
      'on the same cwd serialize on the per-cwd lock.',
      '',
      SECURITY_NOTE,
    ].join('\n'),
    inputSchema: FixAllInputSchema,
    outputSchema: ToolResultSchema,
    annotations: WRITE_ANNOTATIONS,
  },
  async (input: FixAllInput) =>
    safeRun({
      tool: 'fix_all',
      input,
      run: (cwd, files) =>
        runFixTransaction({
          tool: 'fix_all',
          cwd,
          files,
          dryRun: input.dryRun,
          verify: input.verify,
          autoRollback: input.autoRollback,
          skipTypecheck: input.skipTypecheck,
          format: input.format,
        }),
    }),
);

// ---------------------------------------------------------------------------
// Tool: rollback
// ---------------------------------------------------------------------------

server.registerTool(
  'rollback',
  {
    title: 'Roll Back Fix Transactions',
    description: [
      'Restore files from one or more prior fix transactions, identified by their audit entries.',
      '',
      'By default rolls back the last committed transaction. Pass `count` to roll back the',
      'last N (max 20), or `since` (ISO 8601) to roll back every commit at or after a timestamp.',
      '',
      'Runs under the same per-cwd lock as fix transactions, so it never races with a fix.',
      'Each rolled-back commit appends a new `result: "rollback"` audit entry.',
      '',
      SECURITY_NOTE,
    ].join('\n'),
    inputSchema: RollbackInputSchema,
    outputSchema: ToolResultSchema,
    annotations: DESTRUCTIVE_ANNOTATIONS,
  },
  async (input: RollbackToolInput) => {
    let cwd: string;
    try {
      cwd = resolveCwd(input);
    } catch (error) {
      const result = makeErrorResult({
        tool: 'rollback',
        cwd: typeof input.cwd === 'string' ? input.cwd : process.cwd(),
        error,
      });
      return {
        content: [{ type: 'text', text: serialize(result) }],
        structuredContent: result,
        isError: true,
      };
    }
    const outcome = await runRollbackTransaction({
      cwd,
      count: input.count,
      since: input.since,
    });
    const result: ToolResult = {
      tool: 'rollback',
      success: outcome.success,
      workingDirectory: cwd,
      files: [],
      summary: {
        totalFiles: 0,
        totalErrors: outcome.success ? 0 : 1,
        totalWarnings: 0,
        fixedFiles: outcome.restoredCount,
        durationMs: 0,
        scope: 'full',
        dryRun: false,
      },
      error: outcome.error,
      note: outcome.runIds.length
        ? `Restored ${outcome.restoredCount} file(s) from ${outcome.runIds.length} transaction(s): ${outcome.runIds.join(', ')}${outcome.missingCount > 0 ? `. ${outcome.missingCount} snapshot blob(s) missing.` : ''}`
        : 'No committable transactions found to roll back.',
    };
    return {
      content: [{ type: 'text', text: serialize(result) }],
      structuredContent: result,
    };
  },
);

// ---------------------------------------------------------------------------
// Tool: audit_log
// ---------------------------------------------------------------------------

server.registerTool(
  'audit_log',
  {
    title: 'Read Audit Log',
    description: [
      'Read the JSONL audit trail of fix and rollback transactions.',
      '',
      'Each entry is returned as a FileDiagnostic-shaped record where `file` is the audit',
      'runId, `status` maps the outcome, and the first `message` carries a one-line summary.',
      'Filter by `tool`, `since`, or `result`. Default limit is 50 (max 500).',
      '',
      SECURITY_NOTE,
    ].join('\n'),
    inputSchema: AuditLogInputSchema,
    outputSchema: ToolResultSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async (input: AuditLogToolInput) => {
    let cwd: string;
    try {
      cwd = resolveCwd(input);
    } catch (error) {
      const result = makeErrorResult({ tool: 'audit_log', cwd: process.cwd(), error });
      return {
        content: [{ type: 'text', text: serialize(result) }],
        structuredContent: result,
        isError: true,
      };
    }
    const entries = await readAudit({
      cwd,
      limit: input.limit,
      tool: input.tool,
      since: input.since,
      result: input.result,
    });
    const files: FileDiagnostic[] = entries.map(entryToFileDiagnostic);
    const result: ToolResult = {
      tool: 'audit_log',
      success: true,
      workingDirectory: cwd,
      files,
      summary: summarize(files, {
        dryRun: false,
        scope: 'filtered',
        durationMs: 0,
        fixedFiles: entries.filter((e) => e.result === 'commit').length,
      }),
      note: `${entries.length} audit entr${entries.length === 1 ? 'y' : 'ies'} returned.`,
    };
    return {
      content: [{ type: 'text', text: serialize(result) }],
      structuredContent: result,
    };
  },
);

function entryToFileDiagnostic(entry: AuditEntry): FileDiagnostic {
  const status: FileStatus = mapAuditResultToStatus(entry.result);
  const severity = status === 'error' ? 'error' : 'warning';
  const summary =
    `${entry.tool} ${entry.result} at ${entry.timestamp}; ` +
    `filesWritten=${entry.filesWritten.length}; durationMs=${entry.durationMs}` +
    `${entry.rollbackReason ? `; reason=${entry.rollbackReason}` : ''}` +
    `${entry.error ? `; error=${entry.error}` : ''}`;
  return {
    file: entry.runId,
    status,
    errorCount: severity === 'error' ? 1 : 0,
    warningCount: severity === 'warning' ? 1 : 0,
    messages: [
      {
        ruleId: entry.result,
        severity,
        message: summary,
        line: 0,
        column: 0,
        fixable: false,
      },
    ],
  };
}

function mapAuditResultToStatus(result: AuditEntry['result']): FileStatus {
  switch (result) {
    case 'commit':
      return 'fixed';
    case 'rollback':
      return 'clean';
    case 'commit-partial-snapshot':
    case 'commit-no-snapshot':
      return 'fixable';
    case 'error':
    case 'locked-out':
      return 'error';
    default:
      return 'unfixable';
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.on('unhandledRejection', (reason) => {
    logger.error(
      `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  });

  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('MCP server connected via stdio');
  } catch (error) {
    logger.error(
      `Failed to start server: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

void main();
