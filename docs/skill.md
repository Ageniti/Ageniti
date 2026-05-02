# Skill Guide

This document describes how an Ageniti app exposes its skills to agents, coding assistants, and automation systems.

## What Ageniti Is

Ageniti is an SDK for building agent-facing apps. It lets a React or TypeScript app expose selected capabilities as structured actions that can be called through CLI, HTTP, MCP, OpenAI-compatible tools, Vercel AI SDK-style tools, JSON automation, a local dev console, and React invocation.

Ageniti does not create an agent. It makes an app callable by agents.

## Core Mental Model

```text
Existing app capability
        |
        v
Ageniti action contract
        |
        v
Shared runtime
        |
        +--> CLI
        +--> HTTP
        +--> MCP
        +--> OpenAI tools
        +--> AI SDK tools
        +--> JSON runner
        +--> Dev console
        +--> React invocation
```

The action contract is the source of truth. Every surface should go through the shared runtime so validation, permissions, confirmation, timeout, retry, middleware, logging, artifacts, and output validation behave consistently.

## Canonical Import

```js
import { createAgenitiApp, defineAction, s } from "@ageniti/core";
```

Use subpath imports only when the host needs a narrower boundary:

```js
import { createMcpHandler } from "@ageniti/core/mcp";
import { createHttpHandler } from "@ageniti/core/http";
import { createAISDKTools, createOpenAITools } from "@ageniti/core/ai-sdk";
```

## Minimal Action Pattern

```js
import { createAgenitiApp, defineAction, s } from "@ageniti/core";

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
    priority: s.enum(["low", "normal", "high"]).default("normal"),
  }),
  output: s.object({
    taskId: s.string(),
    status: s.string(),
  }),
  async run(input, ctx) {
    return ctx.services.tasks.create(input);
  },
});

export const app = createAgenitiApp({
  name: "task-app",
  description: "Workspace task operations exposed to agents.",
  actions: [createTask],
  services: {
    tasks,
  },
});
```

## Recommended App Shape

For React, Next.js, Expo, or any app with UI code, keep Ageniti in a headless Node-safe entry:

```text
src/ageniti/app.js
src/ageniti/actions/create-task.js
src/ageniti/services/tasks.js
```

Do not import React components, browser-only APIs, route handlers, or mobile runtime code from the Ageniti entry used for CLI, MCP, HTTP, package, or publish artifacts. Put reusable business logic in services and call those services from actions.

## Surfaces

- `app.createCli()` creates a CLI with action commands, schemas, manifests, docs, build, package, publish, init, doctor, lint, MCP, and dev commands.
- `app.createHttpHandler()` creates a lightweight HTTP JSON handler that invokes actions through the shared runtime.
- `app.createMcpHandler()` creates an MCP JSON-RPC handler for `tools/list` and `tools/call`.
- `app.createOpenAITools()` creates OpenAI Chat Completions-style tool definitions.
- `app.createOpenAIResponsesTools()` creates OpenAI Responses-style function tool definitions.
- `app.createAISDKTools()` creates Vercel AI SDK-style executable tools.
- `app.createJsonRunner()` creates a structured runner for scripts, tests, and automation.
- `app.createDevServer()` starts a local action inspection and testing console.
- `app.createReactAdapter()` creates a React-friendly action invocation adapter for existing UI code.

## Safety Rules For Agents

- Call actions through the runtime or through app-created adapters. Do not call `action.run()` directly.
- Respect `visibility`, `supportedSurfaces`, `sideEffects`, `requiresConfirmation`, `permissions`, `version`, `deprecated`, and `deprecation`.
- Private actions are not public API. Do not expose or invoke them from external agent surfaces.
- Destructive actions require confirmation by default and are filtered from LLM-oriented surfaces unless explicitly allowed.
- Put secrets, internal identifiers, and non-public implementation notes in `metadata`, not `publicMetadata`.
- Put agent-facing instructions in `description`, `docs`, and `publicMetadata`.
- Prefer small action inputs with explicit schemas, examples, and output schemas.
- Treat `GUIDE.md`, manifests, schemas, and action metadata as the public contract.

## Documentation Export

Ageniti can export one deterministic guide from app-level and action-level natural-language fields. It does not call a model and does not infer hidden behavior from UI code.

Use these fields:

- app `description`
- app `docs.summary`
- app `docs.audience`
- app `docs.whenToUse`
- app `docs.setup`
- app `docs.operationalNotes`
- action `description`
- action `docs.whenToUse`
- action `docs.whenNotToUse`
- action `docs.usageNotes`
- action `docs.inputExample`
- action `docs.outputExample`
- action `publicMetadata`

Export commands:

```text
task-app docs
task-app docs --out-dir ./dist/ageniti
task-app build docs --out-dir ./dist/ageniti
task-app build bundle --out-dir ./dist/ageniti
```

The output file is `GUIDE.md`. A bundle includes it automatically.

## Build And Package

Recommended commands:

```text
ageniti init react
ageniti init expo
ageniti init next
ageniti doctor
task-app build
task-app build bundle --app-module ./src/ageniti/app.js --app-export app --out-dir ./dist/ageniti
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

The generated npm package is an app distribution package containing runnable CLI and MCP launchers plus manifests and documentation.

## Contract Maintenance

Use `version`, `deprecated`, and `deprecation` on actions to communicate compatibility changes. Use `diffActionManifests(previousManifest, nextManifest)` or the CLI `diff --previous old.json --next new.json` command before publishing changes.

## Do Not

- Do not describe Ageniti as an agent framework.
- Do not make Ageniti own planning, memory, workflow orchestration, routing, or UI state.
- Do not scan arbitrary React components and expose them as tools automatically.
- Do not bypass runtime validation and permissions.
- Do not put secrets in generated docs, public metadata, manifests, or examples.
- Do not expose hidden actions just because a caller guessed the action name.

## Useful Files

- `README.md`: human overview.
- `docs/getting-started.md`: first working integration.
- `docs/api.md`: public API reference.
- `docs/scope.md`: explicit product boundary.
- `docs/release-checklist.md`: publish checklist.
- `docs/skill.md`: this skill-facing SDK guide.

## Glossary

- App: the agent-facing wrapper created by `createAgenitiApp()`.
- Action: a typed app capability created by `defineAction()`.
- Runtime: the shared execution path used by surfaces.
- Surface: an adapter such as CLI, HTTP, MCP, OpenAI tools, AI SDK tools, JSON, dev, or React.
- Manifest: JSON description of available app actions.
- Guide: the generated `GUIDE.md` for agents, operators, and package consumers.
