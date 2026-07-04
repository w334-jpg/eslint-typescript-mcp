#!/usr/bin/env node
/**
 * MCP server entry point.
 *
 * Registers four tools (lint, lint_fix, typecheck, fix_all) that expose
 * ESLint and TypeScript diagnostics to LLM clients. Each tool shares the
 * same request lifecycle: validate cwd, normalize files, run the engine,
 * and project the result into the MCP ToolResult contract.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VERSION } from './config.js';
import { runEslint } from './engines/eslint.js';
import { runTsc } from './engines/tsc.js';
import { logger } from './logger.js';
import { normalizeFiles, validateCwd } from './paths.js';
import {
  countFixedFiles,
  makeErrorResult,
  pickFiles,
  SECURITY_NOTE,
  summarize,
} from './result.js';
import {
  FixAllInputSchema,
  LintFixInputSchema,
  LintInputSchema,
  ToolResultSchema,
  TypecheckInputSchema,
} from './schemas.js';
import type { FileDiagnostic, ToolResult } from './types.js';

interface BaseToolInput {
  cwd?: string;
  files?: string[];
  format?: 'full' | 'compact';
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

function resolveScope(input: BaseToolInput): { cwd: string; files: string[] | undefined } {
  const cwd = validateCwd(input.cwd ?? process.cwd());
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
      'Run ESLint with auto-fix. With `dryRun: true`, fixes are computed but not written.',
      '',
      'Status meanings:',
      '- "fixed": file was modified and is now clean',
      '- "would-fix": dry-run detected fixes that would be applied',
      '- "fixable": file still has problems after fix; some remain manual',
      '- "unfixable": no auto-fixable problems',
      '',
      'Per-file targeting via `files` lets multiple agents fix disjoint sets without clobbering each other.',
      '',
      SECURITY_NOTE,
    ].join('\n'),
    inputSchema: LintFixInputSchema,
    outputSchema: ToolResultSchema,
    annotations: WRITE_ANNOTATIONS,
  },
  async (input: BaseToolInput & { dryRun?: boolean }) =>
    safeRun({
      tool: 'lint_fix',
      input,
      run: async (cwd, files) => {
        const dryRun = input.dryRun === true;
        const ran = await runEslint({ cwd, files, fix: true, dryRun });
        const fixedFiles = dryRun ? 0 : countFixedFiles(ran.files);
        return {
          tool: 'lint_fix',
          success: !ran.fatal,
          workingDirectory: cwd,
          files: pickFiles(ran.files, input.format),
          summary: summarize(ran.files, {
            dryRun,
            scope: files ? 'filtered' : 'full',
            durationMs: ran.durationMs,
            fixedFiles,
          }),
          note: SECURITY_NOTE,
        };
      },
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
      'Run ESLint --fix followed by TypeScript type-checking, in one call.',
      '',
      'The sequential order means lint fixes land before type checking, so type',
      'errors introduced or exposed by the fix are reported in the same result.',
      '',
      'Set `dryRun: true` to preview lint fixes without writing them; the typecheck',
      'still runs against the on-disk source.',
      '',
      'Set `skipTypecheck: true` to run lint_fix only.',
      '',
      'For multi-agent workflows, partition files via `files` so each agent owns a',
      'disjoint set — this is the primary mechanism for parallel review without races.',
      '',
      SECURITY_NOTE,
    ].join('\n'),
    inputSchema: FixAllInputSchema,
    outputSchema: ToolResultSchema,
    annotations: WRITE_ANNOTATIONS,
  },
  async (input: BaseToolInput & { dryRun?: boolean; skipTypecheck?: boolean }) =>
    safeRun({
      tool: 'fix_all',
      input,
      run: async (cwd, files) => {
        const start = Date.now();
        const dryRun = input.dryRun === true;

        const eslintResult = await runEslint({ cwd, files, fix: true, dryRun });
        const fixedFiles = dryRun ? 0 : countFixedFiles(eslintResult.files);

        let tscFiles: FileDiagnostic[] = [];
        let tscOk = true;
        let tscDurationMs = 0;
        if (input.skipTypecheck !== true) {
          const tscResult = await runTsc({ cwd, files });
          tscFiles = tscResult.files;
          tscOk = tscResult.exitCode === 0;
          tscDurationMs = tscResult.durationMs;
        }

        const totalDurationMs = Date.now() - start;
        const mergedFiles = mergeFiles(eslintResult.files, tscFiles);

        return {
          tool: 'fix_all',
          success: !eslintResult.fatal && tscOk,
          workingDirectory: cwd,
          files: pickFiles(mergedFiles, input.format),
          summary: summarize(mergedFiles, {
            dryRun,
            scope: files ? 'filtered' : 'full',
            durationMs: totalDurationMs,
            fixedFiles,
          }),
          note: [
            SECURITY_NOTE,
            `Lint duration: ${eslintResult.durationMs}ms; typecheck duration: ${tscDurationMs}ms.`,
          ].join(' '),
        };
      },
    }),
);

/**
 * Merge ESLint and tsc diagnostics per file. When both engines report on the
 * same file, ESLint messages are listed first and tsc messages appended.
 */
function mergeFiles(eslintFiles: FileDiagnostic[], tscFiles: FileDiagnostic[]): FileDiagnostic[] {
  const byFile = new Map<string, FileDiagnostic>();
  for (const f of eslintFiles) byFile.set(f.file, { ...f, messages: [...f.messages] });
  for (const tsc of tscFiles) {
    const existing = byFile.get(tsc.file);
    if (existing) {
      existing.messages.push(...tsc.messages);
      existing.errorCount += tsc.errorCount;
      existing.warningCount += tsc.warningCount;
      if (tsc.errorCount > 0 && existing.status === 'clean') {
        existing.status = 'unfixable';
      }
    } else {
      byFile.set(tsc.file, { ...tsc, messages: [...tsc.messages] });
    }
  }
  return [...byFile.values()];
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
