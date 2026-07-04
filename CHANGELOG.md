# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-07-04

### Added

- **Per-file targeting** (`files` parameter) on `lint`, `lint_fix`,
  `typecheck`, and `fix_all`. Pass globs or paths to scope an operation;
  omit to keep the default `src/` target.
- **Dry-run mode** (`dryRun` parameter) on `lint_fix` and `fix_all`. Uses
  ESLint's `--fix-dry-run` flag so fixes are computed but never written.
  Files report `would-fix` status.
- **Output verbosity control** (`format` parameter, `"compact"` default or
  `"full"`). `compact` omits files with no problems to keep multi-agent
  review tractable.
- **`skipTypecheck`** on `fix_all` to run `lint_fix` only.
- **`outputSchema`** advertised on every tool so MCP clients get a
  strongly-typed view of results.
- **Allowed-roots enforcement** for `cwd` and `files`. Defaults to the
  server's working directory; extend with the `ESLINT_MCP_ALLOW_DIRS`
  environment variable. Rejects path-traversal before any child process
  is spawned.
- **Leveled logger** writing to stderr, controlled by
  `ESLINT_MCP_LOG_LEVEL` (`debug` / `info` / `warn` / `error` / `silent`).
- **Vitest test suite**: 87 tests across 10 files, 98% line coverage.
- **CI** now runs `typecheck` and `test` in addition to `lint` and `build`.
- **Structured per-file output**: each result is a list of `FileDiagnostic`
  objects with status, counts, and normalized messages, plus an aggregate
  `ToolSummary`.
- **`CHANGELOG.md`**.

### Changed

- **Refactored** the single-file `src/index.ts` (500 lines) into focused
  modules: `config`, `types`, `logger`, `paths`, `schemas`, `run-command`,
  `result`, `parsers/{eslint,tsc}`, `engines/{eslint,tsc}`, `index`.
  Engines no longer spawn processes directly — they go through
  `run-command.ts`. Engines never construct domain types from raw strings
  — they delegate to pure, unit-tested parsers.
- **Corrected execa error handling** to match the `reject: false` semantics
  of execa 9 (timeout and signal are read from the resolved result, not
  from a thrown error).
- **Tightened `tsc` output parsing** with a strict regex
  (`/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s*(.*)$/`) instead
  of `line.includes('error')`, eliminating false positives from banners.
- **README and CONTRIBUTING** rewritten without emoji; documentation
  aligned with the actual tool parameters and the new security model.
- **Tool protocol**: errors now return MCP-level `isError: true` in
  addition to the structured `success: false` payload.
- **Version sync**: the MCP server handshake, `package.json`, and the
  `VERSION` constant in `src/config.ts` are all driven from one place.

### Security

- `cwd` and `files` arguments are validated against an allowlist before
  any child process is spawned.
- Every result carries a `note` reminding consumers that diagnostic text
  is untrusted data (defense against indirect prompt injection).
- README "Security" section now explicitly documents that ESLint config and
  plugins are executable code and that no OS-level sandbox is provided.

### Notes

- **Multi-agent workflows**: partition `files` across agents so each owns
  a disjoint set. This is the primary mechanism for parallel review
  without write races, and directly addresses the per-file targeting and
  dry-run feedback raised in project discussions.

## [1.0.2] - earlier

npm-only republish of the 1.0.1 codebase.

## [1.0.1] - earlier

Initial public release: `lint`, `lint_fix`, `typecheck`, `fix_all` tools
backed by `npx eslint` and `npx tsc`.
