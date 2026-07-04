/**
 * Leveled logger that writes to stderr.
 *
 * MCP transports use stdout for protocol traffic, so all server-side logging
 * must go to stderr to avoid corrupting the message stream. Levels are
 * controlled by the ESLINT_MCP_LOG_LEVEL environment variable.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const PREFIX = '[eslint-typescript-mcp]';

function parseLevel(value: string | undefined): LogLevel {
  if (!value) return 'info';
  const candidate = value.toLowerCase() as LogLevel;
  return LEVEL_WEIGHT[candidate] !== undefined ? candidate : 'info';
}

const CURRENT_LEVEL: LogLevel = parseLevel(process.env.ESLINT_MCP_LOG_LEVEL);

function write(level: LogLevel, message: string): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[CURRENT_LEVEL]) return;
  const tag = level.toUpperCase().padStart(5, ' ');
  process.stderr.write(`${PREFIX} ${tag} ${message}\n`);
}

export const logger = {
  debug: (message: string): void => write('debug', message),
  info: (message: string): void => write('info', message),
  warn: (message: string): void => write('warn', message),
  error: (message: string): void => write('error', message),
};

/** Exposed for tests that need to assert level parsing. */
export const __internals = { parseLevel, LEVEL_WEIGHT };
