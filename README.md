<p align="center">
  <a href="https://ageniti.dev">
    <img src="assets/logo.svg" alt="Ageniti logo" width="96" height="96">
  </a>
</p>

<h1 align="center">Ageniti</h1>

<p align="center">
  <strong>The action primitive for apps that need to be callable by agents.</strong>
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
  <a href="docs/getting-started.md">Getting Started</a>
  ·
  <a href="docs/api.md">API</a>
</p>

Ageniti is the action primitive layer for apps that need to expose
capabilities to agents, automation systems, and external tools. You define an
action once — input contract, output contract, side effects, permissions —
and any caller (CLI, HTTP, MCP, OpenAI / AI SDK tools, React UI, your own
typed client) can invoke it through the same runtime, with the same
streaming events, the same redaction, the same error contract.

> **Stability — pre-1.0.** Ageniti is currently `0.x`. The action contract and
> primary surfaces (CLI, HTTP, MCP, AI SDK) are stable enough for real use, but
> minor versions may still introduce breaking changes to export shape, adapter
> APIs, or manifest format until `1.0`. Pin an exact version (`@ageniti/core@0.1.x`)
> in production and read the [CHANGELOG](./CHANGELOG.md) before upgrading.

## Why Ageniti

Modern apps want to be callable not just from people but from agents, scripts,
and other apps. Today every entry point comes with its own glue: argv parsing,
schema validation, tool descriptions, permission checks, log redaction, error
shapes, idempotency, cancellation. Each surface re-implements the same things
inconsistently.

Ageniti collapses all of that into one concept. Each action you declare runs
through a single runtime that handles the cross-cutting concerns. Each surface
is a thin adapter over the same contract. Streaming events let any consumer —
agent caller, UI, log shipper — observe the action live without owning it.

## Install

```bash
npm i @ageniti/core
```

Subpath exports:

| Subpath | What it gives you |
|---|---|
| `@ageniti/core` | Main authoring API plus packaging/project helpers such as `buildArtifacts`, `packageArtifacts`, `publishArtifacts`, `createGuideDoc`, `exportDocs`, `initProject`, `doctorProject`, and `detectTypeScriptRuntime` |
| `@ageniti/core/ai-sdk` | `createOpenAITools`, `createOpenAIResponsesTools`, `createAISDKTools`, `createFunctionCallingManifest` |
| `@ageniti/core/adapters` | Built-in surface adapters and helpers such as `httpAdapter`, `mcpAdapter`, `aiSdkAdapter`, `cliAdapter`, `jsonAdapter`, `reactAdapter`, `devAdapter`, `defaultSurfaceAdapters`, `defineSurfaceAdapter`, and `findAdapter` |
| `@ageniti/core/app`, `/core`, `/cli`, `/mcp`, `/dev`, `/manifest`, `/json-runner`, `/lint` | Narrow imports for the corresponding runtime or surface modules |
| `@ageniti/core/http` | `createHttpHandler`, `createHttpServer`, `parseRequestBody`, `sendJson`, `sendText` |
| `@ageniti/core/handlers` | `defineActions`, `actionFromHandler`, `actionsFromHandlers` |
| `@ageniti/core/schema-adapter` | `wrapSchema`, Zod / Standard Schema v1 interop |
| `@ageniti/core/schema` | Schema helpers only |
| `@ageniti/core/client` | `createClient`, `AgenitiClientError` |
| `@ageniti/core/client-gen` | `generateClientTypes`, `jsonSchemaToTs` |
| `@ageniti/core/test-utils` | `createTestRuntime`, `expectOk`, `expectError`, `expectLog`, `collectStream`, `stubAction` |
| `@ageniti/core/react` | `createReactActionAdapter`, `makeInvoker`, `streamAction` (no React import) |
| `@ageniti/core/react-hooks` | `useAction` — full state-machine hook (React peer dep) |
| `@ageniti/core/package.json` | Package metadata for tooling that needs to inspect the published package |

## The 5 Core Primitives

### 1. The Action Contract

```ts
import { defineAction, s } from "@ageniti/core";

export const createTask = defineAction({
  name: "create_task",
  description: "Create a task in the user's inbox.",
  sideEffects: "write",
  idempotency: "conditional",
  input: s.object({
    title: s.string().min(1),
    priority: s.enum(["low", "high"]).default("low"),
  }),
  output: s.object({ id: s.string(), title: s.string() }),
  async run({ title, priority }, ctx) {
    ctx.logger.info("Creating task", { title });
    const task = await ctx.services.tasks.create({ title, priority });
    return { id: task.id, title: task.title };
  },
});
```

The contract is the source of truth. Every surface — CLI flags, MCP tool
definition, OpenAI tool spec, HTTP route, React hook, typed client — is
derived from it. You never describe the same action twice.

### 2. Bring Your Own Schema

You don't have to use `s.*`. Zod, Valibot, ArkType, anything that quacks
like Standard Schema v1 just works:

```ts
import { z } from "zod";
import { defineAction } from "@ageniti/core";

export const search = defineAction({
  name: "search_tasks",
  description: "Search for tasks matching a query.",
  input: z.object({ query: z.string(), limit: z.number().int().optional() }),
  output: z.object({ results: z.array(z.object({ id: z.string(), title: z.string() })) }),
  async run({ query, limit }) {
    return { results: await tasks.search(query, limit ?? 20) };
  },
});
```

Ageniti detects foreign schemas (anything with `.safeParse` / `.parse` /
`"~standard".validate`) and wraps them transparently. JSON Schema for MCP
and OpenAI tool descriptions is generated from the wrapped schema.

### 3. Bulk-Wrap Functions You Already Have

For Next.js Server Actions, tRPC procedures, or any plain functions:

```ts
import { actionsFromHandlers, s } from "@ageniti/core";
import * as handlers from "./app/actions/tasks"; // your existing functions

export const actions = actionsFromHandlers(handlers, {
  createTask: {
    description: "Create a task.",
    input: s.object({ title: s.string() }),
    sideEffects: "write",
  },
  searchTasks: {
    description: "Search tasks.",
    input: s.object({ query: s.string() }),
  },
});
```

Or `defineActions` for full control:

```ts
import { defineActions, s } from "@ageniti/core";

export const actions = defineActions({
  createTask: {
    description: "Create a task.",
    input: s.object({ title: s.string() }),
    run: async ({ title }) => tasks.create({ title }),
  },
  // function shorthand for read-only no-input actions
  ping: () => ({ ok: true, time: Date.now() }),
});
```

CamelCase keys are normalized to snake_case action names automatically.

### 4. Streaming Events

Every action runs through a runtime that emits **live events** as it
executes. UIs, agents, and log shippers can subscribe without owning the
action:

```ts
const events = runtime.stream("create_task", { title: "Ship v1" });

for await (const event of events) {
  if (event.type === "log") console.log(event.level, event.message);
  if (event.type === "progress") updateProgressBar(event.percent);
  if (event.type === "artifact") attachToUi(event.artifact);
  if (event.type === "result") finalize(event.envelope);
}
```

Events come from `ctx.logger.*`, `ctx.progress.report()`, and
`ctx.artifacts.add()` inside your `run()` function. The CLI's `--ndjson`
mode and the React hook are both built on this primitive.

### 5. Typed Client + Codegen

```ts
import { createClient } from "@ageniti/core/client";

// In-process
const client = createClient({ runtime });
const task = await client.create_task({ title: "Hello" });
//      ^? { id: string; title: string }

// Or talk to a remote @ageniti HTTP server
const remote = createClient({ url: "https://api.example.com" });
const tasks = await remote.search_tasks({ query: "today" });
```

Remote HTTP clients can send `metadata`, `confirm`, and `idempotencyKey`.
Trusted `user` / `auth` must be resolved server-side via headers or
`resolveContext`, not passed in the request body.

Generate `.d.ts` for the typed client surface from your action manifest:

```ts
import { generateClientTypes } from "@ageniti/core/client-gen";
import { writeFile } from "node:fs/promises";

await writeFile(".ageniti/client.d.ts", generateClientTypes(actions));
```

## React

Two layers: a stateless adapter and a state-machine hook.

```ts
// app/components/CreateTaskButton.tsx
"use client";
import { useAction } from "@ageniti/core/react-hooks";
import { runtime } from "@/src/ageniti/app";
import { createTask } from "@/src/ageniti/actions/tasks";

export function CreateTaskButton() {
  const { invoke, status, data, error, logs, progress, cancel } =
    useAction(createTask, { runtime });

  return (
    <>
      <button onClick={() => invoke({ title: "Hello" })} disabled={status === "loading"}>
        {status === "loading" ? `${progress?.percent ?? 0}%` : "Create"}
      </button>
      {status === "loading" && <button onClick={cancel}>Cancel</button>}
      {status === "success" && <p>Created task {data.id}</p>}
      {status === "error" && <p>Error: {error.message}</p>}
      <pre>{logs.map((l) => l.message).join("\n")}</pre>
    </>
  );
}
```

The hook subscribes to `runtime.stream` so logs / artifacts / progress
update live during the invocation. Unmounts auto-abort.

## Exposing Surfaces

```ts
import { createAgenitiApp, createMcpStdioServer } from "@ageniti/core";
import { actions } from "./actions";

export const app = createAgenitiApp({
  name: "tasks",
  actions,
  description: "Task management actions for operators, automation, and agent callers.",
});

// CLI
app.createCli().main();

// MCP stdio (auto-detects Content-Length or newline framing)
createMcpStdioServer({ actions: app.actions, runtime: app.runtime }).start();

// HTTP (Express / Hono / Next.js Route Handler / raw Node)
const handler = app.createHttpHandler();

// OpenAI / AI SDK tool specs
const openai = app.createOpenAITools();
const responses = app.createOpenAIResponsesTools();
const aiSdk = app.createAISDKTools();
const manifest = app.createFunctionCallingManifest();
```

Each surface is generated from the same action contract.

## Runtime Capabilities

The runtime handles all the cross-cutting concerns so your `run()` function
stays focused on business logic:

- **Validation** (input, output, JSON-serializable check)
- **Permission gating** (overridable `permissionChecker`)
- **Confirmation gate** for destructive actions (machine surfaces require
  `{ confirm: true }` or surface to be `react`/`dev`)
- **Idempotency** — `idempotencyKey` replays a cached envelope scoped by
  action, validated input, surface, and trusted caller fingerprint; LRU cap
  keeps memory bounded
- **Concurrency limits** per action — returns `CONCURRENCY_LIMIT` (retryable)
- **Timeout + retry** — per-attempt `AbortController` so retries see fresh
  signal
- **Cancellation** — external `signal`, CLI SIGINT, React unmount all wired
- **Streaming events** — log / progress / artifact / result
- **Redaction** — log fields, artifact metadata, error messages (Bearer /
  JWT / `sk-` style tokens)
- **Hooks** — `onInvocationStart`, `onInvocationEnd` for telemetry
- **Deprecated warnings** — emitted on every invocation of a deprecated action

## The Envelope

Every invocation returns the same envelope shape:

```ts
{
  ok: true,
  data: { /* validated output */ },
  artifacts: [...],
  logs: [...],
  meta: { action, invocationId, surface, durationMs, idempotent? },
}
```

Or on failure:

```ts
{
  ok: false,
  error: { code, message, issues, retryable },
  artifacts: [...],
  logs: [...],
  meta: { ... },
}
```

Standard error codes are exported as `ERROR_CODES`:

```
ACTION_NOT_FOUND, VALIDATION_ERROR, OUTPUT_VALIDATION_ERROR,
OUTPUT_SERIALIZATION_ERROR, AUTHENTICATION_ERROR, AUTHORIZATION_ERROR,
RATE_LIMITED, TIMEOUT, CANCELLED, CONFLICT, EXTERNAL_SERVICE_ERROR,
INTERNAL_ERROR, UNSUPPORTED_SURFACE, UNSAFE_ACTION,
CONFIRMATION_REQUIRED, CONCURRENCY_LIMIT
```

HTTP maps these to `400 / 401 / 403 / 404 / 405 / 409 / 413 / 415 / 429 /
499 / 500 / 502 / 504`. CLI maps them to `0 / 1 / 2 / 3 / 4 / 5 / 124 / 130`.

## Testing

```ts
import { createTestRuntime, expectOk, expectError, collectStream } from "@ageniti/core/test-utils";
import { createTask } from "./actions/tasks";

test("create_task happy path", async () => {
  const t = createTestRuntime([createTask], { services: { tasks: stubTasksService } });
  const env = await t.invoke("create_task", { title: "Hello" });
  const data = expectOk(env);
  expect(data.title).toBe("Hello");
});

test("rejects empty title", async () => {
  const t = createTestRuntime([createTask]);
  const env = await t.invoke("create_task", { title: "" });
  expectError(env, "VALIDATION_ERROR");
});

test("emits progress events", async () => {
  const t = createTestRuntime([longRunning]);
  const events = await collectStream(t.stream("long_running", {}));
  const progress = events.filter((e) => e.type === "progress");
  expect(progress.length).toBeGreaterThan(0);
});
```

## Drop-In Into An Existing App

You don't restructure your app. Pick the functions you want to expose,
declare them as actions, mount the surfaces:

```ts
// app/actions/tasks.ts — your existing Server Actions / handlers
"use server";
export async function createTask(input: { title: string }) { /* ... */ }

// src/ageniti/app.ts — new
import { createAgenitiApp, actionsFromHandlers, s } from "@ageniti/core";
import * as handlers from "@/app/actions/tasks";

export const app = createAgenitiApp({
  name: "tasks",
  actions: actionsFromHandlers(handlers, {
    createTask: {
      description: "Create a task.",
      input: s.object({ title: s.string() }),
      sideEffects: "write",
    },
  }),
});

// app/api/[[...ageniti]]/route.ts
import { app } from "@/src/ageniti/app";
const handler = app.createHttpHandler();
export { handler as GET, handler as POST };
```

That's it. The same actions are now reachable from CLI (`npx ageniti
create-task --title hello`), MCP (`ageniti mcp --stdio`), HTTP (`/ageniti/...`),
OpenAI / AI SDK tools, and the React hook.

## Examples

| File | Shows |
|---|---|
| [examples/hello.cli.js](examples/hello.cli.js) | Minimum viable action + CLI |
| [examples/task-app.js](examples/task-app.js) | Real-world app with multiple actions |
| [examples/demo.cli.js](examples/demo.cli.js) | Multi-surface demo app with CLI, dev, and MCP modes |
| [examples/buildable-app.mjs](examples/buildable-app.mjs) | Minimal build-safe app export for launcher/package flows |
| [examples/streaming.js](examples/streaming.js) | Live progress / log streaming |
| [examples/zod-action.js](examples/zod-action.js) | Using Zod-style schemas |
| [examples/typed-client.js](examples/typed-client.js) | Typed in-process client, raw envelopes, streams, and client codegen |
| [examples/bulk-handlers.js](examples/bulk-handlers.js) | `defineActions` / `actionsFromHandlers` |
| [examples/test-helpers.test.js](examples/test-helpers.test.js) | Testing actions |
| [examples/openai-responses-host.js](examples/openai-responses-host.js) | OpenAI Responses tool spec |
| [examples/ai-sdk-route.js](examples/ai-sdk-route.js) | Vercel AI SDK tool integration |
| [examples/http-gateway.js](examples/http-gateway.js) | HTTP server with detailed status codes |
| [examples/mcp-host.js](examples/mcp-host.js) | MCP host calling actions |

## Documentation

- [Getting Started](docs/getting-started.md)
- [API Reference](docs/api.md)
- [Scope](docs/scope.md)
- [Skill Spec](docs/skill.md)
- [Release Checklist](docs/release-checklist.md)

## Contributing

PRs and issues welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

MIT — see [LICENSE](LICENSE).
