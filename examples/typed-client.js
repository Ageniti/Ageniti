// Typed client: invoke actions through a Proxy that returns `data` on
// success and throws AgenitiClientError on failure. Works in-process or
// over HTTP to a remote @ageniti server.
//
// Run with: node examples/typed-client.js

import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgenitiClientError,
  createClient,
  createRuntime,
  defineAction,
  generateClientTypes,
  s,
} from "../src/index.js";

const actions = [
  defineAction({
    name: "search_tasks",
    description: "Search tasks by query.",
    input: s.object({
      query: s.string(),
      limit: s.number().int().min(1).max(100).default(20),
    }),
    output: s.object({
      results: s.array(s.object({ id: s.string(), title: s.string() })),
    }),
    run: ({ query, limit }) => ({
      results: [
        { id: "t1", title: `${query} task #1` },
        { id: "t2", title: `${query} task #2` },
      ].slice(0, limit),
    }),
  }),
  defineAction({
    name: "create_task",
    description: "Create a task.",
    sideEffects: "write",
    input: s.object({ title: s.string().min(1) }),
    output: s.object({ id: s.string(), title: s.string() }),
    run: ({ title }) => ({ id: crypto.randomUUID(), title }),
  }),
];

const runtime = createRuntime({ actions });
const client = createClient({ runtime, surface: "json" });

// 1. Successful call returns data directly.
console.log("=== search_tasks ===");
const found = await client.search_tasks({ query: "ship", limit: 1 });
console.log(found);

// 2. Errors throw AgenitiClientError.
console.log("\n=== validation error ===");
try {
  await client.create_task({ title: "" });
} catch (error) {
  if (error instanceof AgenitiClientError) {
    console.log("code:", error.code);
    console.log("issues:", error.issues);
  }
}

// 3. Raw envelope (skip the throw).
console.log("\n=== raw envelope ===");
const raw = await client.create_task({ title: "" }, { raw: true });
console.log(raw.ok ? "ok" : `failed: ${raw.error.code}`);

// 4. Streaming via the same proxy.
console.log("\n=== streaming via $stream ===");
for await (const event of client.$stream("search_tasks", { query: "x" })) {
  if (event.type === "result") {
    console.log("got", event.envelope.data.results.length, "results");
  }
}

// 5. Generate typed client .d.ts for IDE autocomplete on the consumer side.
const dir = await mkdtemp(join(tmpdir(), "ageniti-client-"));
const dts = join(dir, "client.d.ts");
await writeFile(dts, generateClientTypes(actions, { interfaceName: "TasksClient" }));
console.log("\n=== generated client types ===");
console.log(`wrote ${dts}`);
