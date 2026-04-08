# ⚡ ESLint & TypeScript MCP Server

<p align="center">
  <img src="https://img.shields.io/npm/v/eslint-typescript-mcp" />
  <img src="https://img.shields.io/github/stars/w334-jpg/eslint-typescript-mcp?style=social" />
  <img src="https://img.shields.io/github/license/w334-jpg/eslint-typescript-mcp" />
  <img src="https://img.shields.io/badge/MCP-ready-blue" />
  <img src="https://img.shields.io/badge/AI-Claude%20Code-purple" />
</p>
> Let Claude automatically lint, fix, and type-check your entire codebase.

The missing bridge between AI coding assistants and real-world code quality tools.

---

🔥 Stop manually fixing lint errors
🔥 Stop running `tsc` yourself
🔥 Let Claude do it for you

---

## ✨ Features

* 🧹 **lint** — Run ESLint across your entire project
* 🔧 **lint_fix** — Automatically fix code issues
* 🧠 **typecheck** — Full TypeScript validation
* ⚡ **fix_all** — One command to fix + typecheck everything
* 🤖 Built for **Claude Code & MCP ecosystem**

---

## 🧠 Why this project?

AI coding tools can generate code — but they cannot reliably:

* Run ESLint
* Fix lint errors
* Type-check real-world projects
* Handle production-level workflows

This MCP server gives Claude those capabilities.

👉 Turn AI into a real engineering assistant, not just a code generator.

---

## 🤖 Example (with Claude Code)

Just tell Claude:

Fix all lint and TypeScript errors in this project

Claude will:

1. Run ESLint
2. Apply automatic fixes
3. Run TypeScript type-checking
4. Return structured results

No manual commands needed.

---

## 🚀 Quick Start (3 steps)

### 1. Install

```bash
npm install -g eslint-typescript-mcp
```

### 2. Configure Claude Code

```json
{
  "mcpServers": {
    "eslint-typescript": {
      "command": "node",
      "args": ["/usr/local/lib/node_modules/eslint-typescript-mcp/dist/index.js"]
    }
  }
}
```

### 3. Ask Claude

Fix all lint and TypeScript issues

Done ✅

---

## 🔧 MCP Tools

### lint

Run ESLint diagnostics

### lint_fix

Automatically fix lint issues

### typecheck

Run TypeScript validation

### fix_all

Run lint_fix + typecheck sequentially

---

## ⚡ Compared to traditional workflow

| Task       | Before       | With this MCP   |
| ---------- | ------------ | --------------- |
| Lint       | Manual CLI   | Claude runs it  |
| Fix errors | Manual edits | Auto fix        |
| Type check | Run `tsc`    | Claude handles  |
| Workflow   | Fragmented   | Fully automated |

---

## ⚙️ Configuration

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "eslint-typescript": {
      "command": "node",
      "args": [".../dist/index.js"]
    }
  }
}
```

---

## 🔐 Security Notes

This server executes shell commands.

⚠️ Do NOT pass untrusted user input into commands.

Recommended usage:

* Local development
* Trusted environments only

---

## 🧪 Development

```bash
npm install
npm run dev
npm run build
npm run lint
```

---

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md)

---

## ⭐ If this helps you

Give it a star ⭐ — it helps more developers discover AI-powered tooling.

---

## 📄 License

MIT © w334-jpg
