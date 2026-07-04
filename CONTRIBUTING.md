# Contributing to eslint-typescript-mcp

Thank you for your interest in contributing.

---

## Why contribute

This project sits at the intersection of AI assistants and developer
tooling. Contributions shape how agents like Claude interact with
real-world codebases.

We especially welcome:

- New MCP tools
- Performance improvements
- Security hardening
- Better multi-agent workflows

---

## Getting started

```bash
git clone https://github.com/w334-jpg/eslint-typescript-mcp.git
cd eslint-typescript-mcp

npm install
npm run typecheck
npm run lint
npm run build
npm test
```

All four must pass before opening a pull request.

---

## Architecture

The server is organized into focused layers so each can be tested in
isolation.

```
src/
  config.ts          constants, version, allow-root env reader
  types.ts           shared domain types (no runtime)
  logger.ts          leveled stderr logger
  paths.ts           cwd/files allowlist enforcement
  schemas.ts         Zod input + output schemas (single source of truth)
  run-command.ts     execa wrapper, normalized CommandResult
  result.ts          ToolResult builders, summary, security note
  parsers/
    eslint.ts        ESLint JSON -> domain types
    tsc.ts           tsc text output -> domain types
  engines/
    eslint.ts        runEslint(): builds args, calls run-command, parses
    tsc.ts           runTsc(): runs tsc, filters by files
  index.ts           MCP server entry; registers the four tools
```

Key invariants:

- **Engines never spawn processes directly.** They go through
  `run-command.ts`, which is the only module that touches `execa`.
- **Engines never construct domain types from raw strings.** They delegate
  parsing to `parsers/`, which is pure and unit-tested.
- **Tool handlers never validate `cwd` themselves.** They go through
  `safeRun`, which calls `paths.ts` and produces an `isError: true` MCP
  response on policy violations.
- **ESLint is invoked via `npx`, not imported.** This preserves
  compatibility with the host project's ESLint version and config format.

---

## Adding a new tool

1. Define input and (if needed) output fields in `src/schemas.ts`.
2. Add an engine function in `src/engines/` (or reuse an existing one).
3. Register the tool in `src/index.ts` with `server.registerTool(...)`,
   passing both `inputSchema` and `outputSchema`.
4. Add tests under `tests/` for any new parser or helper logic.
5. Update the README tool table.

```ts
import { z } from 'zod';

const MyToolInputSchema = z.object({
  cwd: z.string().optional(),
  files: z.array(z.string()).optional(),
});

server.registerTool(
  'my_tool',
  {
    title: 'My Tool',
    description: 'What it does, written for an LLM consumer.',
    inputSchema: MyToolInputSchema,
    outputSchema: ToolResultSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (input) => safeRun({ tool: 'my_tool', input, run: async (cwd, files) => {
    // ...engine call...
    return { /* ToolResult */ };
  } }),
);
```

---

## Code style

- 2 spaces, single quotes, no semicolons
- Strict TypeScript
- ESM with explicit `.js` import specifiers (NodeNext)
- No emoji in code, comments, docs, or commit messages

Run before commit:

```bash
npm run lint
npm run typecheck
npm test
```

---

## Commit convention

```
<type>: <description>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

---

## Pull requests

1. Fork the repository
2. Create a branch
3. Implement changes; keep diffs minimal
4. Ensure `typecheck`, `lint`, `build`, and `test` all pass
5. Open the PR with a description that covers motivation and trade-offs

---

## Reporting issues

Include:

- Node.js version
- Host project's ESLint and TypeScript versions
- The exact tool invocation and the returned `ToolResult`
- Reproduction steps
