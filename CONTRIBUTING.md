# Contributing to eslint-typescript-mcp

Thank you for your interest in contributing!

## Getting Started

```bash
# Clone the repository
git clone https://github.com/w334-jpg/eslint-typescript-mcp.git
cd eslint-typescript-mcp

# Install dependencies
npm install

# Build
npm run build

# Lint
npm run lint
```

## Development

```bash
# Watch mode (auto-rebuild on changes)
npm run dev
```

## Adding New Tools

The MCP server exposes tools via `server.registerTool()`. Each tool needs:

1. **Input schema** — Zod schema defining parameters
2. **Tool definition** — title, description, annotations
3. **Handler function** — async function that executes the tool

Example:

```typescript
const MyToolInputSchema = z.object({
  cwd: z.string().optional().default(WORKING_DIR),
});

server.registerTool(
  "my_tool",
  {
    title: "My Tool",
    description: "Description of what it does...",
    inputSchema: MyToolInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: z.infer<typeof MyToolInputSchema>) => {
    const result = await runCommand("my command", params.cwd);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  }
);
```

## Code Style

- 2-space indentation
- Single quotes for strings
- No semicolons
- Strict TypeScript
- Run `npm run lint` before committing

## Commit Messages

Format: `<type>: <description>`

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

## Pull Requests

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Ensure `npm run lint` and `npm run build` pass
5. Open a PR with a clear description

## Reporting Issues

Bug reports and feature requests welcome! Please include:
- Node.js version
- ESLint/TypeScript versions
- Minimal reproduction steps
