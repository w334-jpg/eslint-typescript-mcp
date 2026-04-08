# Contributing to eslint-typescript-mcp

Thank you for your interest in contributing 🚀

---

## 🤝 Why contribute?

This project sits at the intersection of AI and developer tooling.

By contributing, you are helping shape how AI assistants like Claude interact with real-world codebases.

We especially welcome:

* New MCP tools
* Performance improvements
* Security enhancements
* Better AI workflows

---

## 🛠 Getting Started

```bash
git clone https://github.com/w334-jpg/eslint-typescript-mcp.git
cd eslint-typescript-mcp

npm install
npm run build
npm run lint
```

---

## 🧪 Development

```bash
npm run dev
```

---

## ➕ Adding New Tools

Each MCP tool requires:

1. Input schema (Zod)
2. Tool definition
3. Handler function

Example:

```ts
const MyToolInputSchema = z.object({
  cwd: z.string().optional().default(WORKING_DIR),
});
```

Register tool:

```ts
server.registerTool(
  "my_tool",
  {
    title: "My Tool",
    description: "Description...",
    inputSchema: MyToolInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    const result = await runCommand("command", params.cwd);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  }
);
```

---

## 🧹 Code Style

* 2 spaces
* Single quotes
* No semicolons
* Strict TypeScript

Run before commit:

```bash
npm run lint
```

---

## 🧾 Commit Convention

```
<type>: <description>
```

Types:

* feat
* fix
* refactor
* docs
* test
* chore
* perf
* ci

---

## 🔀 Pull Requests

1. Fork repository
2. Create branch
3. Implement changes
4. Ensure lint + build pass
5. Submit PR

---

## 🐞 Reporting Issues

Include:

* Node.js version
* ESLint / TypeScript versions
* Reproduction steps
