/**
 * ESLint engine.
 *
 * Owns the translation between MCP tool parameters and the spawned `npx eslint`
 * process. Keeps the CLI invocation in one place so policy decisions — exit
 * codes, dry-run, per-file targeting, fatal-error detection — are centralized.
 *
 * Design note: this server intentionally calls ESLint through `npx` rather
 * than importing the `eslint` package directly. That way the server uses the
 * same ESLint version the host project ships, preserving config compatibility
 * (flat config vs. legacy `.eslintrc`) across projects.
 */

import { DEFAULT_LINT_TARGETS, MAX_STDERR_BYTES, MAX_STDOUT_BYTES } from '../config.js';
import { logger } from '../logger.js';
import { parseEslintJson, toFileDiagnostic } from '../parsers/eslint.js';
import { runCommand } from '../run-command.js';
import type { FileDiagnostic } from '../types.js';

export interface RunEslintOptions {
  cwd: string;
  files?: string[];
  fix?: boolean;
  dryRun?: boolean;
}

export interface EslintResult {
  files: FileDiagnostic[];
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  /** True when ESLint reported a fatal/config error or output could not be parsed. */
  fatal: boolean;
  rawStdout: string;
  rawStderr: string;
}

export async function runEslint(opts: RunEslintOptions): Promise<EslintResult> {
  const wantFix = opts.fix === true;
  const dryRun = opts.dryRun === true;

  const args = buildEslintArgs({
    files: opts.files,
    fix: wantFix,
    dryRun,
  });

  const start = Date.now();
  const cmd = await runCommand('npx', args, { cwd: opts.cwd });
  const durationMs = Date.now() - start;

  // ESLint exit codes: 0 = clean, 1 = lint errors found, 2 = config/fatal.
  // Both 0 and 1 are "the engine ran successfully" and produce parseable JSON.
  const fatalFromExit = cmd.timedOut || cmd.exitCode === 2 || cmd.exitCode < 0;

  let files: FileDiagnostic[] = [];
  let fatal = fatalFromExit;

  if (!fatalFromExit) {
    try {
      const results = parseEslintJson(cmd.stdout);
      files = results.map((r) =>
        toFileDiagnostic(r, { dryRun, wroteFix: wantFix && !dryRun }),
      );
    } catch (error) {
      logger.warn(
        `ESLint output parsing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      fatal = true;
    }
  }

  return {
    files,
    exitCode: cmd.exitCode,
    durationMs,
    timedOut: cmd.timedOut,
    fatal,
    rawStdout: truncate(cmd.stdout, MAX_STDOUT_BYTES),
    rawStderr: truncate(cmd.stderr, MAX_STDERR_BYTES),
  };
}

interface BuildArgsInput {
  files?: string[];
  fix: boolean;
  dryRun: boolean;
}

function buildEslintArgs(input: BuildArgsInput): string[] {
  const args = ['eslint'];

  const targets = input.files && input.files.length > 0 ? input.files : [...DEFAULT_LINT_TARGETS];
  args.push(...targets);

  // --fix-dry-run computes fixes and reports them in the `output` field of
  // each result without writing to disk. `--fix` writes to disk.
  if (input.fix && input.dryRun) {
    args.push('--fix-dry-run');
  } else if (input.fix) {
    args.push('--fix');
  }

  args.push('--format', 'json');
  return args;
}

function truncate(value: string, maxBytes: number): string {
  if (value.length <= maxBytes) return value;
  return `${value.slice(0, maxBytes)}...<truncated>`;
}
