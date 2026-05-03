<p align="center">
  <a href="https://ageniti.dev">
    <img src="assets/logo.svg" alt="Ageniti logo" width="96" height="96">
  </a>
</p>

<h1 align="center">Ageniti</h1>

<p align="center">
  <strong>Build apps that agents can use from the capabilities your product already has.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@ageniti/core"><img alt="npm version" src="https://img.shields.io/npm/v/@ageniti/core?style=flat-square"></a>
  <a href="https://www.npmjs.com/package/@ageniti/core"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@ageniti/core?style=flat-square"></a>
  <a href="https://github.com/Ageniti/ageniti/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@ageniti/core?style=flat-square"></a>
  <a href="https://www.npmjs.com/package/@ageniti/core"><img alt="node" src="https://img.shields.io/node/v/@ageniti/core?style=flat-square"></a>
  <a href="https://github.com/Ageniti/ageniti"><img alt="module format" src="https://img.shields.io/badge/module-ESM-black?style=flat-square"></a>
  <a href="https://discord.gg/cmkxR7GcYu"><img alt="discord" src="https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white"></a>
</p>

<p align="center">
  <a href="https://ageniti.dev">Website</a>
  ·
  <a href="https://github.com/Ageniti/ageniti">GitHub</a>
  ·
  <a href="https://www.npmjs.com/package/@ageniti/core">npm</a>
  ·
  <a href="https://discord.gg/cmkxR7GcYu">Discord</a>
  ·
  <a href="docs/getting-started.md">Getting Started</a>
  ·
  <a href="docs/api.md">API</a>
</p>

Ageniti helps React and TypeScript apps expose selected product actions as CLI, HTTP, MCP, OpenAI, and AI SDK tools without restructuring the app.

It is for building **apps that agents can use**, not agents.

## Contents

- [Core Idea](#core-idea)
- [What Ageniti Does](#what-ageniti-does)
- [What Ageniti Is Not](#what-ageniti-is-not)
- [Install](#install)
- [Define An App Action](#define-an-app-action)
- [Create An App Agents Can Use](#create-an-app-agents-can-use)
- [Use From Existing React UI](#use-from-existing-react-ui)
- [Generate CLI](#generate-cli)
- [Expose MCP](#expose-mcp)
- [Expose OpenAI And AI SDK Tools](#expose-openai-and-ai-sdk-tools)
- [Expose HTTP](#expose-http)
- [Build Official Ageniti Artifacts](#build-official-ageniti-artifacts)
- [Runtime Result](#runtime-result)
- [Current Scope](#current-scope)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Core Idea

```text
Existing React / TypeScript app
        |
        v
Selected app actions
        |
        v
Ageniti action contract
        |
        +--> CLI
        +--> HTTP
        +--> MCP
        +--> OpenAI tools
        +--> AI SDK tools
        +--> Dev console
        +--> React app invocation
```

Ageniti does not inspect your React component tree, replace your router, own your state management, or orchestrate agents. You explicitly declare the app capabilities you want to expose.

## What Ageniti Does

- Keeps existing React app structure intact.
- Lets non-React TypeScript apps use the same action model.
- Defines selected app capabilities as typed actions.
- Generates CLI commands from action schemas.
- Exposes actions through a lightweight HTTP JSON handler.
- Exposes actions as MCP tools.
- Exposes actions as OpenAI Chat/Responses tools.
- Exposes actions as Vercel AI SDK-style tools.
- Provides a JSON runner for scripts and tests.
- Provides a local dev console for action testing.
- Provides a React-friendly invocation adapter.
- Adds safety metadata for visibility, permissions, side effects, and destructive actions.

Action visibility defaults to `public` for declared actions. Use `visibility: "local"` for local-only capabilities and `visibility: "private"` for implementation-only capabilities.

## What Ageniti Is Not

- Not an agent framework.
- Not a workflow orchestration engine.
- Not a planner, memory system, or tool router.
- Not a hosted runtime.
- Not a marketplace.
- Not a replacement for your app auth system.
- Not a system that magically converts arbitrary React components into tools.

See [docs/scope.md](docs/scope.md) for the full scope boundary.

If an agent host, coding assistant, or automation system is reading the SDK package directly, start with [docs/skill.md](docs/skill.md). It is a compact skill-facing guide to the core model, safe usage rules, surfaces, and generated artifacts.

## Install

```text
npm install @ageniti/core
```

This package is ESM-only and requires Node.js 20 or newer.

For project scaffolding from a terminal, run the bundled CLI through your package manager:

```text
npx @ageniti/core init react
npx @ageniti/core init expo
npx @ageniti/core init next
npx @ageniti/core init host-openai
npx @ageniti/core init host-ai-sdk
npx @ageniti/core init host-mcp
npx @ageniti/core init host-http
npx @ageniti/core doctor
```

## Define An App Action

```js
import { defineAction, s } from "@ageniti/core";

export const createTask = defineAction({
  name: "create_task",
  version: "1.0.0",
  description: "Create a workspace task.",
  visibility: "public",
  sideEffects: "write",
  idempotency: "conditional",
  permissions: ["task:create"],
  input: s.object({
    title: s.string().min(1).describe("Task title"),
    assignee: s.string().optional().describe("Optional assignee id"),
    priority: s.enum(["low", "normal", "high"]).default("normal"),
  }),
  output: s.object({
    taskId: s.string(),
    status: s.string(),
    priority: s.string(),
  }),
  async run(input, ctx) {
    ctx.logger.info("Creating task.", { title: input.title });
    return ctx.services.tasks.create(input);
  },
});
```

## Create An App Agents Can Use

```js
import { createAgenitiApp } from "@ageniti/core";
import { createTask } from "./actions/create-task.js";

export const app = createAgenitiApp({
  name: "task-app",
  description: "Workspace task operations packaged for agent hosts and automation tools.",
  docs: {
    summary: "Use this app to create tasks and inspect task state.",
    audience: "Agent hosts and internal automation.",
    whenToUse: [
      "Use it when an agent needs to create or inspect tasks.",
      "Prefer the regular product UI for multi-step human approval flows.",
    ],
  },
  actions: [createTask],
  services: {
    tasks,
  },
  permissionChecker({ action, context }) {
    return action.permissions.every((permission) =>
      context.auth?.permissions?.includes(permission)
    ) || "Missing required permission.";
  },
});
```

You can keep natural-language guidance next to the app contract:

- app-level `description`
- app-level `docs`
- action-level `docs`

Ageniti can then export one unified `GUIDE.md`.

## Use From Existing React UI

Ageniti does not require a new app structure. Use the action from your existing UI handler.

```js
const { useAction } = app.createReactAdapter();

const runCreateTask = useAction(createTask);

await runCreateTask({
  title: "Follow up with design review",
  priority: "high",
});
```

## Generate CLI

```js
await app.createCli().main();
```

Generated commands:

```text
task-app create-task --title "Follow up with design review" --priority high
task-app create-task --json '{"title":"Follow up with design review","priority":"high"}'
task-app create-task --schema
task-app actions
task-app manifest
task-app build
task-app build manifest --out-dir ./dist/ageniti
task-app build docs --out-dir ./dist/ageniti
task-app build bundle --app-module ./src/ageniti/app.js --app-export app --out-dir ./dist/ageniti
task-app docs
task-app docs --out-dir ./dist/ageniti
task-app package --app-module ./src/ageniti/app.js --app-export app --out-dir ./dist/ageniti
task-app publish --app-module ./src/ageniti/app.js --app-export app --out-dir ./dist/ageniti
task-app lint
```

## Expose MCP

```js
const handle = app.createMcpHandler();
```

MCP-like JSON-RPC calls:

```js
await handle({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
});

await handle({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "create_task",
    arguments: {
      title: "Follow up with design review",
      priority: "high",
    },
  },
});
```

CLI MCP helpers:

```text
task-app mcp
task-app mcp --stdio
```

## Expose OpenAI And AI SDK Tools

OpenAI Chat Completions-style tools:

```js
const tools = app.createOpenAITools();
```

OpenAI Responses-style tools:

```js
const tools = app.createOpenAIResponsesTools();
```

Vercel AI SDK-style tools object:

```js
const tools = app.createAISDKTools();

const result = await tools.create_task.execute({
  title: "Follow up with design review",
  priority: "high",
});
```

Private and destructive actions are filtered out of LLM tool adapters by default.

## Expose HTTP

```js
const handle = app.createHttpHandler();

const result = await handle({
  method: "POST",
  path: "/ageniti/actions/create_task/invoke",
  body: {
    input: {
      title: "Follow up with design review",
      priority: "high",
    },
  },
});
```

HTTP uses the same runtime and returns the same structured envelope as CLI, MCP, and JSON invocation.

## Check Contract Changes

```js
import { diffActionManifests } from "@ageniti/core";

const diff = diffActionManifests(previousManifest, nextManifest);
```

Use action `version`, `deprecated`, and `deprecation` fields to make compatibility changes explicit before publishing.

## Local Dev Console

```text
task-app dev --port 4321
```

Use the dev console to inspect action schemas, test JSON input, and view structured results.

## Build Official Ageniti Artifacts

When you want to ship your app as Ageniti surfaces, build distributable launchers and manifests from the same app object.

Zero-config build:

```text
task-app build
```

This looks for a default Node-safe app entry in:

- `./src/ageniti/app.js`
- `./src/ageniti/app.mjs`
- `./src/ageniti/app.cjs`
- `./ageniti/app.js`
- `./ageniti/app.mjs`
- `./ageniti/app.cjs`

If you only have a React/Next/Expo UI entry, Ageniti will stop and explain how to create a headless app module.

Unified guide export:

```text
task-app docs
task-app docs --out-dir ./dist/ageniti
task-app build docs --out-dir ./dist/ageniti
```

These commands generate one guide file: `GUIDE.md`.

You can also configure defaults in `ageniti.config.json`:

```json
{
  "build": {
    "appModule": "./src/ageniti/app.js",
    "appExport": "app",
    "outDir": "./dist/ageniti",
    "includePackageJson": true
  },
  "mcp": {
    "transport": "stdio"
  },
  "package": {
    "name": "task-app-bundle",
    "version": "0.1.0",
    "description": "CLI and MCP bundle for task-app",
    "private": false,
    "binName": "task-app"
  }
}
```

Code-first build:

```js
await app.build({
  targets: ["bundle"],
  appModule: "./src/ageniti/app.js",
  appExport: "app",
  outDir: "./dist/ageniti",
});
```

CLI-first build:

```text
task-app build manifest --out-dir ./dist/ageniti
task-app build docs --out-dir ./dist/ageniti
task-app build cli --app-module ./src/ageniti/app.js --app-export app --out-dir ./dist/ageniti
task-app build mcp --app-module ./src/ageniti/app.js --app-export app --out-dir ./dist/ageniti
task-app build bundle --app-module ./src/ageniti/app.js --app-export app --out-dir ./dist/ageniti
task-app docs --out-dir ./dist/ageniti
task-app package --app-module ./src/ageniti/app.js --app-export app --out-dir ./dist/ageniti
task-app publish --app-module ./src/ageniti/app.js --app-export app --out-dir ./dist/ageniti
```

`bundle` produces:

- `ageniti.manifest.json`
- `ageniti.actions.json`
- `ageniti.mcp.json`
- `cli.mjs`
- `mcp-stdio.mjs`
- `GUIDE.md`
- `package.json`
- `README.md`
- `ageniti.bundle.json`

You can then run the generated surfaces locally:

```text
node ./dist/ageniti/cli.mjs
node ./dist/ageniti/mcp-stdio.mjs
```

To produce a distributable npm tarball from the same bundle:

```text
task-app package --app-module ./src/ageniti/app.js --app-export app --out-dir ./dist/ageniti
```

That command runs `npm pack` inside the generated bundle directory and leaves a `.tgz` artifact next to the launchers.

The generated `dist/ageniti/README.md` is part of the output and explains how downstream users deploy the app surfaces:

- run the CLI directly with `node ./cli.mjs`
- package and test with `npm pack`
- install the tarball globally and run `<bin-name>` / `<bin-name>-mcp`
- publish to npm with `npm publish --access public`
- connect MCP clients with either `node ./mcp-stdio.mjs` or the published MCP bin
- mount HTTP from your own backend with `app.createHttpHandler()`

For a final publish rehearsal or a real release:

```text
task-app publish --app-module ./src/ageniti/app.js --app-export app --out-dir ./dist/ageniti
task-app publish --live --access public --tag latest --app-module ./src/ageniti/app.js --app-export app --out-dir ./dist/ageniti
```

`publish` defaults to `npm publish --dry-run`. Pass `--live` only when you want the real publish.

## React And Expo Onboarding

Bootstrap a headless Ageniti entry for React or Expo:

```text
npx @ageniti/core init react
npx @ageniti/core init expo
npx @ageniti/core init next
```

This creates:

- `src/ageniti/app.js`
- `src/ageniti/actions/ping.js`
- `src/ageniti/services/ping-service.js`
- `src/ageniti/README.md`

Use `npx @ageniti/core doctor` to inspect the current project and verify that your build entry is Node-safe.

## TypeScript Projects

If your headless entry is TypeScript-only, for example `src/ageniti/app.ts`, configure or install `tsx` so Ageniti can generate runnable launchers:

```json
{
  "build": {
    "appModule": "./src/ageniti/app.ts",
    "typescriptRuntime": "tsx"
  }
}
```

Without `tsx`, Ageniti will ask you to point at compiled JavaScript or create a small Node-safe wrapper such as `src/ageniti/app.js`.

## Runtime Result

Success:

```json
{
  "ok": true,
  "data": {},
  "artifacts": [],
  "logs": [],
  "meta": {
    "action": "create_task",
    "invocationId": "invocation-id",
    "surface": "cli",
    "durationMs": 12
  }
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid action input.",
    "issues": [],
    "retryable": false
  },
  "artifacts": [],
  "logs": [],
  "meta": {
    "action": "create_task",
    "invocationId": "invocation-id",
    "surface": "mcp",
    "durationMs": 3
  }
}
```

## Local Demo

```text
npm test
npm run example:responses
npm run example:ai-sdk
npm run example:http
npm run example:mcp-host
node examples/demo.cli.js search-tasks --status open
node examples/demo.cli.js manifest
node examples/demo.cli.js lint
node examples/demo.cli.js mcp
node examples/demo.cli.js dev --port 4321
```

## Current Scope

Ageniti is intentionally scoped to app action exposure.

Included:

- React-friendly app action invocation
- TypeScript/headless action runtime
- CLI generation
- HTTP JSON handler
- MCP exposure
- OpenAI and AI SDK tool adapters
- JSON runner
- Dev console
- Safety metadata and permission hook
- Guide document export
- Build, package, and publish helpers
- Action versioning and manifest diff

Not included:

- agent orchestration
- workflow engine
- hosted runtime
- durable job queue
- marketplace
- automatic React component parsing

## Planned Next Steps

- Zod schema adapter.
- Stronger official MCP SDK transport integration.
- Better React examples for existing apps.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Security

Please report vulnerabilities through the process in [SECURITY.md](SECURITY.md). Do not open public issues for sensitive security reports.

## License

MIT
