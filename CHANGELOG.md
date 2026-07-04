# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-07-04

### Added

- **Atomic fix transactions.** `lint_fix` and `fix_all` now run as
  serializable transactions: cross-process per-cwd lock, pre-fix snapshot of
  the `src/` tree, automatic rollback on verification failure, and a JSONL
  audit log. Driven by the new `src/transaction.ts` orchestrator.
- **Cross-process locking** via `proper-lockfile`, scoped per-cwd so
  concurrent transactions on the same working directory serialize cleanly
  even across separate MCP server processes.
- **Snapshot + restore** under `.mcp-cache/snapshots/<runId>/` with
  content-addressed blobs and a manifest, sized via
  `ESLINT_MCP_SNAPSHOT_MAX_BYTES` (default 50 MB; degrades gracefully to
  `commit-no-snapshot` when exceeded).
- **`rollback` tool** to restore files from prior committed transactions,
  identified by audit entries (`count` or `since` filter).
- **`audit_log` tool** to read the JSONL audit trail with `tool`, `since`,
  and `result` filters.
- **Audit rotation** at `ESLINT_MCP_AUDIT_MAX_BYTES` (default 10 MB) to
  sidecar files `audit.jsonl.<ts>.jsonl`.
- New `verify` and `autoRollback` parameters on `lint_fix` and `fix_all`.
  `autoRollback` defaults to **true** — tsc verification failure reverts
  every written file before the lock is released.
- New modules: `cache-dir.ts`, `lock.ts`, `snapshot.ts`, `audit.ts`,
  `transaction.ts`, `rollback.ts`.

### Changed

- `src/index.ts` registers six tools (was four) and delegates every fix to
  `runFixTransaction`. `mergeFiles` moved into `transaction.ts`.
- README gains a `## Concurrency and recovery` section; CONTRIBUTING
  architecture diagram and invariants updated; the load-bearing invariant
  is "fixing handlers never call `runEslint({fix:true})` directly".
- `.gitignore` excludes `.mcp-cache/`.

### Security

- README "Security" section documents that `.mcp-cache/` contains source
  copies (snapshots + audit), so it must be treated as a sensitive artifact
  in CI and cleaned after each run.
- Every result still carries the `note` reminding consumers that diagnostic
  text is untrusted data.
- Lock staleness (60s) and heartbeat (5s) bound the window in which a
  crashed transaction can block its cwd.

### Notes

- The transaction model is logical serializable isolation, not physical
  git worktrees — worktrees do not compose with MCP stdio (the agent reads
  from its cwd; a worktree fix would be invisible until merged back, and
  merge-back just relocates the race).
- `autoRollback: true` is the new default. Clients that preferred the 1.1.0
  "leave the fix on disk even when tsc fails" behavior can pass
  `autoRollback: false` explicitly.

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
