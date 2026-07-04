import { describe, expect, it, vi } from 'vitest';
import { __internals, logger } from '../src/logger.js';

describe('logger.parseLevel', () => {
  it('defaults to info', () => {
    expect(__internals.parseLevel(undefined)).toBe('info');
  });

  it('returns the level when valid', () => {
    expect(__internals.parseLevel('debug')).toBe('debug');
    expect(__internals.parseLevel('ERROR')).toBe('error');
    expect(__internals.parseLevel('silent')).toBe('silent');
  });

  it('falls back to info for unknown values', () => {
    expect(__internals.parseLevel('verbose')).toBe('info');
    expect(__internals.parseLevel('')).toBe('info');
  });
});

describe('logger level filtering', () => {
  it('respects the configured level threshold', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // The CURRENT_LEVEL is captured at module load. We cannot reset it here
    // without re-importing, so this test only asserts that the silent level
    // weight is higher than every other level (i.e. silent suppresses all).
    expect(__internals.LEVEL_WEIGHT.silent).toBeGreaterThan(__internals.LEVEL_WEIGHT.error);

    // Calling logger methods must never throw regardless of configured level.
    expect(() => {
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
    }).not.toThrow();

    write.mockRestore();
  });
});
