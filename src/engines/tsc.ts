/**
 * TypeScript compiler engine.
 *
 * Runs `npx tsc --noEmit` and parses diagnostics. tsc has no robust
 * single-file flag (passing files makes it ignore tsconfig `files`/`include`),
 * so per-file semantics are implemented as a post-parse filter. The filter is
 * strict: results include a `scope: 'filtered'` flag so consumers never
 * mistake a filtered view for the full project state.
 */

import { MAX_STDERR_BYTES, MAX_STDOUT_BYTES } from '../config.js';
import { filterByFiles, groupByFile, parseTscOutput } from '../parsers/tsc.js';
import { runCommand } from '../run-command.js';
import type { FileDiagnostic } from '../types.js';

export interface RunTscOptions {
  cwd: string;
  files?: string[];
}

export interface TscResult {
  files: FileDiagnostic[];
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  rawStdout: string;
  rawStderr: string;
}

export async function runTsc(opts: RunTscOptions): Promise<TscResult> {
  const start = Date.now();
  const cmd = await runCommand('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
    cwd: opts.cwd,
  });
  const durationMs = Date.now() - start;

  const all = parseTscOutput(cmd.stdout, cmd.stderr);
  const filtered = opts.files && opts.files.length > 0 ? filterByFiles(all, opts.files) : all;
  const files = groupByFile(filtered);

  return {
    files,
    exitCode: cmd.exitCode,
    durationMs,
    timedOut: cmd.timedOut,
    rawStdout: truncate(cmd.stdout, MAX_STDOUT_BYTES),
    rawStderr: truncate(cmd.stderr, MAX_STDERR_BYTES),
  };
}

function truncate(value: string, maxBytes: number): string {
  if (value.length <= maxBytes) return value;
  return `${value.slice(0, maxBytes)}...<truncated>`;
}
