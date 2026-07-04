/**
 * TypeScript compiler output parser.
 *
 * `tsc --noEmit` prints diagnostics in a stable format:
 *
 *   path/to/file.ts(12,34): error TS2345: Argument of type ...
 *
 * This module parses that format, optionally filters by file, and groups
 * diagnostics per file into our domain shape. tsc cannot auto-fix, so every
 * file is reported with status "unfixable" (or absent from the output when
 * clean).
 */

import { resolve } from 'node:path';
import type { FileDiagnostic, LintMessage } from '../types.js';

/** A raw parsed tsc diagnostic before grouping. */
export interface TscDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  code: string; // e.g. "TS2345"
  message: string;
}

const TSC_LINE_RE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s*(.*)$/;

/**
 * Parse tsc stdout/stderr into diagnostics.
 *
 * Lines that do not match the canonical diagnostic format are ignored — tsc
 * emits non-diagnostic banner/summary lines (e.g. the "Found N errors" footer)
 * which must not be treated as problems.
 */
export function parseTscOutput(stdout: string, stderr: string): TscDiagnostic[] {
  const out = `${stdout}\n${stderr}`;
  const diagnostics: TscDiagnostic[] = [];

  for (const line of out.split('\n')) {
    const match = TSC_LINE_RE.exec(line);
    if (!match) continue;
    diagnostics.push({
      file: match[1],
      line: Number.parseInt(match[2], 10),
      column: Number.parseInt(match[3], 10),
      severity: match[4] as 'error' | 'warning',
      code: match[5],
      message: match[6],
    });
  }

  return diagnostics;
}

/**
 * Filter diagnostics to those whose file appears in `files`.
 *
 * File arguments are resolved to absolute paths so that "src/foo.ts" passed
 * by the caller matches a tsc-reported path that may be relative or absolute.
 */
export function filterByFiles(
  diagnostics: TscDiagnostic[],
  files: string[],
): TscDiagnostic[] {
  if (!files.length) return diagnostics;
  const allowed = new Set(files.map((f) => resolve(f)));
  return diagnostics.filter((d) => allowed.has(resolve(d.file)));
}

/** Group flat diagnostics into per-file FileDiagnostic objects. */
export function groupByFile(diagnostics: TscDiagnostic[]): FileDiagnostic[] {
  const grouped = new Map<string, TscDiagnostic[]>();
  for (const d of diagnostics) {
    const list = grouped.get(d.file) ?? [];
    list.push(d);
    grouped.set(d.file, list);
  }

  return [...grouped.entries()].map(([file, ds]) => {
    const messages: LintMessage[] = ds.map((d) => ({
      ruleId: d.code,
      severity: d.severity,
      message: d.message,
      line: d.line,
      column: d.column,
      fixable: false,
    }));
    return {
      file,
      status: 'unfixable' as const,
      errorCount: ds.filter((d) => d.severity === 'error').length,
      warningCount: ds.filter((d) => d.severity === 'warning').length,
      messages,
    };
  });
}
