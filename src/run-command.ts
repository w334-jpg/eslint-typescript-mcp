/**
 * Spawned child-process wrapper around execa.
 *
 * Centralizes timeout/buffer handling and normalizes both exit-case results
 * and spawn-level errors into a single CommandResult shape, so engine code
 * never has to branch on execa's error taxonomy.
 */

import { execa, type ExecaError } from 'execa';
import { CHILD_MAX_BUFFER_BYTES, COMMAND_TIMEOUT_MS } from './config.js';
import { logger } from './logger.js';
import type { CommandResult } from './types.js';

export interface RunCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Override the default timeout (ms). */
  timeoutMs?: number;
}

/**
 * Run a command without a shell (`shell: false`) so arguments are never
 * interpreted by a shell. With `reject: false`, execa resolves for any
 * exit code; only spawn-level failures (ENOENT, permission denied) reject.
 */
export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  const start = Date.now();
  const timeout = options.timeoutMs ?? COMMAND_TIMEOUT_MS;

  logger.debug(`exec ${command} ${args.join(' ')} (cwd=${options.cwd})`);

  try {
    const result = await execa(command, args, {
      cwd: options.cwd,
      timeout,
      maxBuffer: CHILD_MAX_BUFFER_BYTES,
      reject: false,
      shell: false,
      env: options.env,
      preferLocal: true,
    });

    const durationMs = Date.now() - start;
    const exitCode = typeof result.exitCode === 'number' ? result.exitCode : -1;
    const timedOut = result.timedOut === true;
    const signal = typeof result.signal === 'string' && result.signal ? result.signal : null;

    logger.debug(
      `exec done exitCode=${exitCode} timedOut=${timedOut} ` +
        `stdout=${result.stdout?.length ?? 0}B stderr=${result.stderr?.length ?? 0}B`,
    );

    return {
      success: exitCode === 0 && !timedOut,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode,
      durationMs,
      timedOut,
      signal,
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - start;
    const message = extractErrorMessage(error);
    logger.debug(`exec failed: ${message}`);

    return {
      success: false,
      stdout: '',
      stderr: message,
      exitCode: -1,
      durationMs,
      timedOut: false,
      signal: null,
    };
  }
}

function extractErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const e = error as Partial<ExecaError> & { message?: unknown };
    if (typeof e.message === 'string') return e.message;
  }
  return String(error);
}
