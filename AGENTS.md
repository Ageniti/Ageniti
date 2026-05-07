# Ageniti

Read this file if you are an agent that needs to **learn how to use the Ageniti SDK**.

This is the main agent-facing guide for the `ageniti/` package.

## What Ageniti Is

Ageniti is the action primitive layer for agentic applications. Define an
action once and the runtime makes it callable from CLI, HTTP, MCP, OpenAI
tools, AI SDK tools, JSON automation, a typed client, the React `useAction`
hook, and a local dev console — all from the same contract.

## Core Model

```text
existing app capability
  -> action contract
  -> shared runtime (validation, retry, idempotency, redaction, streaming events)
  -> multiple external surfaces
```

The action contract is the source of truth.

Every surface goes through the shared runtime so validation, permissions,
confirmation, timeout, retry, idempotency, concurrency, logging, artifacts,
and output validation behave consistently.

## Canonical Import

```js
import { createAgenitiApp, defineAction, s } from "@ageniti/core";
```

Use subpath imports when the host needs a narrower boundary:

```js
import { defineActions, actionsFromHandlers, actionFromHandler } from "@ageniti/core/handlers";
import { wrapSchema } from "@ageniti/core/schema-adapter";
import { createClient } from "@ageniti/core/client";
import { generateClientTypes } from "@ageniti/core/client-gen";
import { useAction } from "@ageniti/core/react-hooks";
import { createTestRuntime, expectOk, expectError } from "@ageniti/core/test-utils";
import { createMcpHandler } from "@ageniti/core/mcp";
import { createHttpHandler } from "@ageniti/core/http";
import { createAISDKTools, createOpenAITools } from "@ageniti/core/ai-sdk";
```

## Minimal Pattern

```js
import { createAgenitiApp, defineAction, s } from "@ageniti/core";

export const createTask = defineAction({
  name: "create_task",
  description: "Create a workspace task.",
  visibility: "public",
  sideEffects: "write",
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
  description: "Workspace task operations exposed to external hosts and agent callers.",
  attribution: {
    text: "Powered by Ageniti",
    vendor: "Ageniti",
    product: "Ageniti Core",
    url: "https://ageniti.dev",
    docsUrl: "https://ageniti.dev/docs",
  },
  actions: [createTask],
  services: {
    tasks,
  },
});
```

## Key Primitives

### Foreign schema interop

`defineAction({ input })` accepts Zod-style schemas (`.safeParse` / `.parse`) and
Standard Schema v1 directly — no rewrite needed:

```js
import { z } from "zod";
defineAction({
  name: "search",
  description: "Search tasks.",
  input: z.object({ query: z.string(), limit: z.number().optional() }),
  run: ({ query, limit }) => tasks.search(query, limit),
});
```

### Bulk registration

```js
import { defineActions, actionsFromHandlers, s } from "@ageniti/core";
import * as handlers from "./app/actions/tasks"; // existing functions

// Wrap a record of plain handlers with metadata.
const a = actionsFromHandlers(handlers, {
  createTask: { description: "Create.", input: s.object({ title: s.string() }), sideEffects: "write" },
  searchTasks: { description: "Search.", input: s.object({ query: s.string() }) },
});

// Or full inline configs.
const b = defineActions({
  ping: () => ({ ok: true }),
  echo: { description: "Echo.", input: s.object({ x: s.string() }), run: ({ x }) => ({ x }) },
});
```

CamelCase keys normalize to snake_case action names automatically.

### Streaming events

Every invocation emits live events any consumer can subscribe to:

```js
for await (const event of runtime.stream("create_task", input)) {
  if (event.type === "log") /* ... */;
  if (event.type === "progress") /* ... */;
  if (event.type === "artifact") /* ... */;
  if (event.type === "result") return event.envelope;
}
```

Events come from `ctx.logger.*`, `ctx.progress.report()`, and
`ctx.artifacts.add()` inside the action. The stream always ends with one
`result` event.

### Typed client

```js
import { createClient } from "@ageniti/core/client";

// In-process
const client = createClient({ runtime });
const task = await client.create_task({ title: "Hello" });
//      ^? typed by action manifest

// Or remote @ageniti HTTP server
const remote = createClient({ url: "https://api.example.com" });

// Raw envelope (no throw on failure)
const envelope = await client.create_task({ title: "Hello" }, { raw: true });
```

`createClient` returns a Proxy: `client.<action_name>(input, options?)` resolves
to `data` on success or throws `AgenitiClientError` on failure.

### React hook (state machine)

```tsx
import { useAction } from "@ageniti/core/react-hooks";

function CreateButton() {
  const { invoke, status, data, error, logs, progress, cancel, reset } =
    useAction(createTask, { runtime });
  // status: idle | loading | success | error | cancelled
}
```

Subscribes to `runtime.stream`, so `logs` / `artifacts` / `progress` update
live during the invocation. Component unmount auto-aborts.

### Test utilities

```js
import { createTestRuntime, expectOk, expectError, collectStream } from "@ageniti/core/test-utils";

const t = createTestRuntime([createTask], { services: { tasks: stubTasks } });
const env = await t.invoke("create_task", { title: "Hello" });
expectOk(env);

// drain a stream
const events = await collectStream(t.stream("create_task", { title: "Hello" }));
```

Framework-agnostic — works with `node:test`, vitest, jest. Defaults to
`surface: "json"` and bypasses the confirmation gate so destructive actions
can be tested without ceremony.

### Codegen

```js
import { generateClientTypes } from "@ageniti/core/client-gen";
import { writeFile } from "node:fs/promises";

await writeFile(".ageniti/client.d.ts", generateClientTypes(actions, {
  interfaceName: "TasksClient",
}));
```

Emits a typed `.d.ts` so consumers get IDE autocomplete on action names,
inputs, and outputs.

## Runtime Capabilities

| Capability | How |
|---|---|
| Validation | input + output schema (built-in or wrapped Zod / Standard Schema) |
| Permissions | `permissionChecker` callback on `createRuntime` |
| Confirmation gate | destructive actions need `confirm: true` on cli/json/mcp/http surfaces |
| Idempotency | `idempotencyKey` in invoke options; LRU-bounded cache; replay marker in `meta.idempotent` |
| Concurrency | `concurrency: { max: N }` on the action; returns `CONCURRENCY_LIMIT` (retryable) |
| Timeout + retry | per-attempt `AbortController` so retries see fresh signal |
| Cancellation | external `signal` + CLI SIGINT + React unmount all wired |
| Streaming | `runtime.stream()` async iterable of log/artifact/progress/result |
| Redaction | log fields, artifact metadata, error messages — default keys + custom |
| Hooks | `onInvocationStart` / `onInvocationEnd` for telemetry |
| Deprecated warn | warn log emitted on every invocation of a deprecated action |

## Recommended App Shape

For integrated apps, prefer:

```text
src/ageniti/app.js
src/ageniti/actions/
src/ageniti/services/
```

Keep this entry Node-safe.

Do not import:

- React components
- page/layout files
- browser-only APIs
- Expo screens

into the build entry used for CLI, MCP, HTTP, package, or publish artifacts.

## Main Surfaces

- `app.createCli()` — CLI command generator with `--ndjson` live streaming, `--idempotency-key`, `--timeout-ms`, `--confirm`
- `app.createHttpHandler()` / `app.createHttpServer()` — JSON HTTP handler with detailed status code mapping (400 / 401 / 403 / 404 / 405 / 409 / 413 / 415 / 429 / 499 / 500 / 502 / 504), Content-Type guard, body size limit
- `app.createMcpHandler()` plus top-level `createMcpStdioServer({ actions, runtime })` — MCP server (stdio auto-detects Content-Length and newline framing)
- `app.createOpenAITools()` / `app.createOpenAIResponsesTools()` — OpenAI tool specs
- `app.createAISDKTools()` — Vercel AI SDK tools
- `app.createJsonRunner()` — JSON-in / JSON-out invocation
- `app.createDevServer()` — local dev console
- `app.createReactAdapter()` — React-friendly invocation (for hook state, use `@ageniti/core/react-hooks`)

## Safety Rules

- Do not call `action.run()` directly from external surfaces.
- Respect `visibility`, `supportedSurfaces`, `sideEffects`, `requiresConfirmation`, `permissions`, `deprecated`, and `deprecation`.
- Keep secrets and internal-only notes in `metadata`, not `publicMetadata`.
- Put host-facing guidance in `description`, `docs`, and `publicMetadata`.
- Treat generated `GUIDE.md`, manifests, schemas, and tool metadata as public contract.
- Destructive actions require confirmation by default and are filtered from LLM-oriented surfaces unless explicitly allowed.

## Error Codes

Standard codes exported as `ERROR_CODES`:

```
ACTION_NOT_FOUND, VALIDATION_ERROR, OUTPUT_VALIDATION_ERROR,
OUTPUT_SERIALIZATION_ERROR, AUTHENTICATION_ERROR, AUTHORIZATION_ERROR,
RATE_LIMITED, TIMEOUT, CANCELLED, CONFLICT, EXTERNAL_SERVICE_ERROR,
INTERNAL_ERROR, UNSUPPORTED_SURFACE, UNSAFE_ACTION,
CONFIRMATION_REQUIRED, CONCURRENCY_LIMIT
```

HTTP and CLI exit code mappings live in [`docs/api.md`](docs/api.md#error-codes).

## Attribution

Ageniti supports optional app-level `attribution` metadata.

When configured, it can appear in:

- CLI help
- surface manifests
- MCP metadata
- OpenAI / Responses / AI SDK tool metadata
- generated `GUIDE.md`
- generated bundle `README.md`
- generated bundle `package.json`

It is descriptive metadata, not telemetry.

## Build And Package

Useful commands:

```text
ageniti init react
ageniti init expo
ageniti init next
ageniti init host-openai
ageniti init host-ai-sdk
ageniti init host-mcp
ageniti init host-http
ageniti doctor
task-app build
task-app docs
task-app package
task-app publish
```

`build bundle` generates:

- `ageniti.manifest.json`
- `ageniti.actions.json`
- `ageniti.mcp.json`
- `cli.mjs`
- `mcp-stdio.mjs`
- `GUIDE.md`
- `package.json`
- `README.md`
- `ageniti.bundle.json`

## Read Next

If you need more detail after this file:

- `docs/getting-started.md`
- `docs/api.md`
- `docs/scope.md`
- `examples/streaming.js`, `examples/zod-action.js`, `examples/typed-client.js`, `examples/bulk-handlers.js`, `examples/test-helpers.test.js`
- `src/app.js`
- `src/runtime/core.js`
