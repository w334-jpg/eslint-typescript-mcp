#!/usr/bin/env node
/**
 * MCP Server for ESLint and TypeScript Diagnostics.
 *
 * Provides tools to run ESLint and TypeScript type checking,
 * enabling LLMs to diagnose code issues and fix them automatically.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execa } from "execa";

// Constants
const WORKING_DIR = process.cwd();
const TIMEOUT_MS = 60_000; // 60 second timeout for commands

// ============================================================================
// Types
// ============================================================================

interface DiagnosticResult {
  success: boolean;
  errors: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

interface EslintJsonOutput {
  filePath: string;
  messages: Array<{
    ruleId: string | null;
    severity: number;
    message: string;
    line: number;
    column: number;
    nodeType: string;
    messageId: string;
  }>;
  errorCount: number;
  warningCount: number;
  suppressedMessages: unknown[];
  usedDeprecatedRules: unknown[];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Log a message to stderr (MCP protocol uses stderr for server logs)
 */
function log(message: string): void {
  console.error(`[eslint-typescript-mcp] ${message}`);
}

/**
 * Parse ESLint JSON output and extract structured errors
 */
function parseEslintJson(stdout: string): { errors: string[]; errorCount: number; warningCount: number } {
  const errors: string[] = [];
  let totalErrorCount = 0;
  let totalWarningCount = 0;

  try {
    const results: EslintJsonOutput[] = JSON.parse(stdout);

    for (const fileResult of results) {
      totalErrorCount += fileResult.errorCount;
      totalWarningCount += fileResult.warningCount;

      for (const msg of fileResult.messages) {
        const location = `${fileResult.filePath}:${msg.line}:${msg.column}`;
        const errorMsg = `[${msg.ruleId || 'unknown'}] ${msg.message} (${location})`;
        errors.push(errorMsg);
      }
    }
  } catch {
    // If JSON parsing fails, fall back to raw output
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.includes('error') || /\d+\s+problem/.test(line)) {
        errors.push(line.trim());
      }
    }
  }

  return { errors, errorCount: totalErrorCount, warningCount: totalWarningCount };
}

/**
 * Execute a shell command with timeout and return structured result.
 * Uses execa for safer child process management (no shell injection).
 */
async function runCommand(
  command: string,
  args: string[],
  cwd: string = WORKING_DIR
): Promise<DiagnosticResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  try {
    log(`Executing: ${command} ${args.join(' ')} in ${cwd}`);

    const result = await execa(command, args, {
      cwd,
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      reject: false,
      shell: false,
    });

    const duration = Date.now() - startTime;
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const exitCode = result.exitCode ?? 0;

    log(`Command finished with exitCode: ${exitCode}, stdout length: ${stdout.length}, stderr length: ${stderr.length}`);

    // Parse ESLint errors from JSON output
    if (command === 'npx' && args[0] === 'eslint') {
      const parsed = parseEslintJson(stdout);
      errors.push(...parsed.errors);

      // ESLint exitCode: 0 = no errors, 1 = has errors, 2 = fatal error
      const success = exitCode === 0;

      return {
        success,
        errors,
        stdout: stdout.slice(0, 100_000), // Limit output size
        stderr: stderr.slice(0, 10_000),
        exitCode,
        duration,
      };
    }

    // For other commands (tsc, etc.)
    const success = exitCode === 0;

    // Parse errors from stderr/stdout for type checking
    if (!success && (stderr || stdout)) {
      const output = stderr || stdout;
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.trim() && (line.includes('error') || line.includes('Error'))) {
          errors.push(line.trim());
        }
      }
    }

    return {
      success,
      errors,
      stdout: stdout.slice(0, 100_000),
      stderr: stderr.slice(0, 10_000),
      exitCode,
      duration,
    };
  } catch (error: unknown) {
    const duration = Date.now() - startTime;

    // execa throws ExecylaError on timeout / SIGTERM
    if (error instanceof Error && 'timedOut' in error) {
      return {
        success: false,
        errors: [`Command timed out after ${TIMEOUT_MS / 1000} seconds`],
        stdout: '',
        stderr: String(error),
        exitCode: 124, // Standard timeout exit code
        duration,
      };
    }

    if (error instanceof Error && 'signal' in error) {
      return {
        success: false,
        errors: ['Command was terminated by signal'],
        stdout: '',
        stderr: String(error),
        exitCode: 143, // Standard SIGTERM exit code
        duration,
      };
    }

    // Handle other errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      errors: [errorMessage.slice(0, 500)],
      stdout: '',
      stderr: errorMessage,
      exitCode: 1,
      duration,
    };
  }
}

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new McpServer({
  name: "eslint-typescript-mcp",
  version: "1.0.0",
});

log("Initializing ESLint/TypeScript MCP server...");

// ============================================================================
// Tool Schemas
// ============================================================================

const LintInputSchema = z.object({
  cwd: z
    .string()
    .optional()
    .default(WORKING_DIR)
    .describe("Working directory for ESLint (defaults to current directory)"),
});

const FixInputSchema = z.object({
  cwd: z
    .string()
    .optional()
    .default(WORKING_DIR)
    .describe("Working directory for ESLint (defaults to current directory)"),
});

const TypecheckInputSchema = z.object({
  cwd: z
    .string()
    .optional()
    .default(WORKING_DIR)
    .describe("Working directory for TypeScript (defaults to current directory)"),
});

const FixAllInputSchema = z.object({
  cwd: z
    .string()
    .optional()
    .default(WORKING_DIR)
    .describe("Working directory for all operations (defaults to current directory)"),
});

// ============================================================================
// Tool: lint — Run ESLint
// ============================================================================

server.registerTool(
  "lint",
  {
    title: "Run ESLint",
    description: `Run ESLint to find and report code quality issues.

Runs "npx eslint src/ --format json" in the specified directory to analyze JavaScript/TypeScript files.

Returns structured JSON with:
- success: boolean indicating if linting completed without errors
- errors: array of error/warning messages found
- stdout: full ESLint JSON output
- stderr: any error output from ESLint
- exitCode: the process exit code (0=no errors, 1=has errors)
- duration: time taken in milliseconds

Use this to:
- Check for linting errors before commits
- Identify code quality issues
- Audit existing code for problems`,
    inputSchema: LintInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: z.infer<typeof LintInputSchema>) => {
    log(`Running ESLint in ${params.cwd}`);

    const result = await runCommand('npx', ['eslint', 'src/', '--format', 'json'], params.cwd);

    const output = {
      tool: "lint",
      command: "npx eslint src/ --format json",
      workingDirectory: params.cwd,
      ...result,
    };

    log(`Lint result: success=${result.success}, exitCode=${result.exitCode}, errorCount=${result.errors.length}`);

    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  }
);

// ============================================================================
// Tool: lint_fix — Run ESLint with --fix
// ============================================================================

server.registerTool(
  "lint_fix",
  {
    title: "Fix ESLint Errors",
    description: `Run ESLint with automatic fixes to resolve code quality issues.

Runs "npx eslint src/ --fix --format json" to automatically fix fixable issues like:
- Formatting problems
- Missing semicolons
- Unused variables (with underscore prefix)
- Import sorting
- And other auto-fixable issues

Note: Some errors require manual intervention.

Returns structured JSON with:
- success: boolean indicating if fixing completed (exitCode 0)
- errors: any remaining errors that could not be auto-fixed
- stdout: ESLint JSON output showing what was fixed
- stderr: any error output
- exitCode: the process exit code
- duration: time taken in milliseconds`,
    inputSchema: FixInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: z.infer<typeof FixInputSchema>) => {
    log(`Running ESLint with --fix in ${params.cwd}`);

    const result = await runCommand('npx', ['eslint', 'src/', '--fix', '--format', 'json'], params.cwd);

    const output = {
      tool: "lint_fix",
      command: "npx eslint src/ --fix",
      workingDirectory: params.cwd,
      lintFixed: result.exitCode === 0,
      ...result,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  }
);

// ============================================================================
// Tool: typecheck — Run TypeScript type checking
// ============================================================================

server.registerTool(
  "typecheck",
  {
    title: "Run TypeScript Type Check",
    description: `Run TypeScript compiler to check for type errors.

Runs "npx tsc --noEmit" to type-check TypeScript files without generating output.

Returns structured JSON with:
- success: boolean indicating no type errors were found
- errors: array of type error messages
- stdout: TypeScript compiler output
- stderr: any error output from tsc
- exitCode: the process exit code
- duration: time taken in milliseconds

Use this to:
- Verify type correctness before commits
- Find type errors in TypeScript code
- Validate type definitions`,
    inputSchema: TypecheckInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: z.infer<typeof TypecheckInputSchema>) => {
    log(`Running TypeScript type check in ${params.cwd}`);

    const result = await runCommand('npx', ['tsc', '--noEmit'], params.cwd);

    const output = {
      tool: "typecheck",
      command: "npx tsc --noEmit",
      workingDirectory: params.cwd,
      ...result,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  }
);

// ============================================================================
// Tool: fix_all — Run lint_fix then typecheck sequentially
// ============================================================================

server.registerTool(
  "fix_all",
  {
    title: "Fix ESLint and TypeScript Errors",
    description: `Run ESLint fix and TypeScript type check sequentially.

First runs "npx eslint src/ --fix" to auto-fix linting issues, then runs "npx tsc --noEmit" to check types.

This is a convenience tool that combines lint_fix and typecheck in one call.
The sequential execution ensures:
1. All auto-fixable linting issues are resolved
2. TypeScript type errors are then identified

Returns structured JSON with:
- lintResult: result from ESLint fix
- typecheckResult: result from TypeScript check
- totalDuration: combined time for both operations`,
    inputSchema: FixAllInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: z.infer<typeof FixAllInputSchema>) => {
    log(`Running fix_all in ${params.cwd}`);

    // Step 1: Run ESLint fix
    const startTime = Date.now();
    const lintResult = await runCommand('npx', ['eslint', 'src/', '--fix', '--format', 'json'], params.cwd);

    // Step 2: Run TypeScript type check
    const typecheckResult = await runCommand('npx', ['tsc', '--noEmit'], params.cwd);

    const totalDuration = Date.now() - startTime;

    const output = {
      tool: "fix_all",
      commands: ["npx eslint src/ --fix", "npx tsc --noEmit"],
      workingDirectory: params.cwd,
      lintResult: {
        success: lintResult.exitCode === 0,
        errors: lintResult.errors,
        stdout: lintResult.stdout,
        stderr: lintResult.stderr,
        exitCode: lintResult.exitCode,
        duration: lintResult.duration,
        lintFixed: lintResult.exitCode === 0,
      },
      typecheckResult: {
        success: typecheckResult.exitCode === 0,
        errors: typecheckResult.errors,
        stdout: typecheckResult.stdout,
        stderr: typecheckResult.stderr,
        exitCode: typecheckResult.exitCode,
        duration: typecheckResult.duration,
      },
      totalDuration,
      summary: {
        lintFixed: lintResult.exitCode === 0,
        typecheckPassed: typecheckResult.exitCode === 0,
        hasErrors: lintResult.exitCode !== 0 || typecheckResult.exitCode !== 0,
      },
    };

    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  }
);

// ============================================================================
// Main — Connect and Run
// ============================================================================

async function main(): Promise<void> {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log("MCP server connected via stdio");
  } catch (error) {
    log(`Failed to start server: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

void main();
