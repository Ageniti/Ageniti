import assert from "node:assert/strict";
import test from "node:test";
import {
  actionFromHandler,
  actionsFromHandlers,
  collectStream,
  createClient,
  createTestRuntime,
  defineAction,
  defineActions,
  expectError,
  expectOk,
  generateClientTypes,
  jsonSchemaToTs,
  s,
  wrapSchema,
} from "../src/index.js";

// ---------- Foreign schema (Zod-like duck typing) ----------

// Build a tiny mock that quacks like Zod so we don't take Zod as a dep.
function mockZodObject(shape) {
  return {
    _def: { typeName: "ZodObject", shape: () => shape, unknownKeys: "strict" },
    shape,
    safeParse(value) {
      if (!value || typeof value !== "object") {
        return { success: false, error: { issues: [{ path: [], message: "Expected object." }] } };
      }
      const issues = [];
      const out = {};
      for (const [k, v] of Object.entries(shape)) {
        const r = v.safeParse(value[k]);
        if (!r.success) {
          for (const issue of r.error.issues) {
            issues.push({ path: [k, ...(issue.path ?? [])], message: issue.message });
          }
        } else {
          out[k] = r.data;
        }
      }
      if (issues.length > 0) return { success: false, error: { issues } };
      return { success: true, data: out };
    },
  };
}
function mockZodString() {
  return {
    _def: { typeName: "ZodString", checks: [] },
    safeParse(value) {
      if (typeof value !== "string") {
        return { success: false, error: { issues: [{ path: [], message: "Expected string." }] } };
      }
      return { success: true, data: value };
    },
  };
}
function mockZodNumber() {
  return {
    _def: { typeName: "ZodNumber", checks: [] },
    safeParse(value) {
      if (typeof value !== "number") {
        return { success: false, error: { issues: [{ path: [], message: "Expected number." }] } };
      }
      return { success: true, data: value };
    },
  };
}

test("defineAction accepts Zod-like schemas via duck typing", async () => {
  const zodInput = mockZodObject({ name: mockZodString(), age: mockZodNumber() });
  const action = defineAction({
    name: "greet_zod",
    description: "Greet via Zod schema.",
    input: zodInput,
    run: ({ name, age }) => ({ greeting: `Hello ${name}, age ${age}` }),
  });

  const json = action.input.toJSONSchema();
  assert.equal(json.type, "object");
  assert.equal(json.properties.name.type, "string");
  assert.deepEqual(json.required.sort(), ["age", "name"]);

  const t = createTestRuntime([action]);
  const ok = await t.invoke("greet_zod", { name: "Ada", age: 42 });
  assert.deepEqual(expectOk(ok), { greeting: "Hello Ada, age 42" });

  const bad = await t.invoke("greet_zod", { name: "Ada", age: "not a number" });
  expectError(bad, "VALIDATION_ERROR");
});

test("Zod adapter introspects shape through optional/nullable wrappers", () => {
  const inner = mockZodObject({ name: mockZodString() });
  // Simulate z.object({...}).optional() with a wrapper around inner.
  const optionalWrapper = {
    _def: { typeName: "ZodOptional", innerType: inner },
    safeParse: (v) => v === undefined ? { success: true, data: undefined } : inner.safeParse(v),
  };
  const action = defineAction({
    name: "wrapped_obj",
    description: "Optional object input.",
    input: optionalWrapper,
    run: (input) => ({ got: input ?? null }),
  });
  // Introspected JSON schema should reach the inner object's properties.
  const json = action.input.toJSONSchema();
  assert.equal(json.type, "object");
  assert.equal(json.properties.name.type, "string");
});

test("wrapSchema recognizes Standard Schema v1", () => {
  const standardSchema = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate(value) {
        if (typeof value !== "string") {
          return { issues: [{ path: [], message: "Expected string." }] };
        }
        return { value };
      },
    },
  };
  const wrapped = wrapSchema(standardSchema);
  const ok = wrapped.validate("hi");
  assert.equal(ok.ok, true);
  assert.equal(ok.value, "hi");
  const bad = wrapped.validate(42);
  assert.equal(bad.ok, false);
});

// ---------- Bulk registration ----------

test("defineActions registers a record of action configs", async () => {
  const createTask = async ({ title }) => ({ id: `t-${title}` });
  const searchTasks = ({ query }) => ({ results: [query] });

  const actions = defineActions({
    createTask: {
      description: "Create a task.",
      input: s.object({ title: s.string() }),
      run: createTask,
    },
    searchTasks: {
      description: "Search tasks.",
      input: s.object({ query: s.string() }),
      run: searchTasks,
    },
  });

  assert.equal(actions.length, 2);
  assert.equal(actions[0].name, "create_task");
  assert.equal(actions[1].name, "search_tasks");

  const t = createTestRuntime(actions);
  assert.deepEqual(expectOk(await t.invoke("create_task", { title: "x" })), { id: "t-x" });
});

test("actionFromHandler wraps an existing function", async () => {
  const handler = async (input) => ({ doubled: input.x * 2 });
  const action = actionFromHandler(handler, {
    name: "double",
    description: "Double a number.",
    input: s.object({ x: s.number() }),
  });
  const t = createTestRuntime([action]);
  const ok = await t.invoke("double", { x: 21 });
  assert.deepEqual(expectOk(ok), { doubled: 42 });
});

test("actionsFromHandlers pairs handlers with metadata", async () => {
  const handlers = {
    addOne: ({ x }) => ({ y: x + 1 }),
    subOne: ({ x }) => ({ y: x - 1 }),
  };
  const actions = actionsFromHandlers(handlers, {
    addOne: { description: "Add one.", input: s.object({ x: s.number() }) },
    subOne: { description: "Subtract one.", input: s.object({ x: s.number() }) },
  });
  assert.equal(actions.length, 2);
  assert.equal(actions[0].name, "add_one");
  const t = createTestRuntime(actions);
  assert.deepEqual(expectOk(await t.invoke("add_one", { x: 5 })), { y: 6 });
});

// ---------- Streaming events ----------

test("runtime.stream emits log/progress/result events live", async () => {
  const action = defineAction({
    name: "streamy",
    description: "Streams progress.",
    run: async (_input, ctx) => {
      ctx.logger.info("start");
      ctx.progress.report({ percent: 50, message: "halfway" });
      ctx.logger.info("done");
      return { ok: true };
    },
  });
  const t = createTestRuntime([action]);
  const events = await collectStream(t.stream("streamy", {}));
  const types = events.map((e) => e.type);
  assert.deepEqual(types.slice(0, 3), ["log", "progress", "log"]);
  assert.equal(types[types.length - 1], "result");
  const result = events.at(-1);
  assert.equal(result.envelope.ok, true);
});

test("runtime.stream emits artifacts as they are added", async () => {
  const action = defineAction({
    name: "artifact_stream",
    description: "Adds an artifact.",
    run: async (_i, ctx) => {
      ctx.artifacts.add({ type: "file", name: "report.txt", uri: "file:///tmp/report.txt" });
      return { ok: true };
    },
  });
  const t = createTestRuntime([action]);
  const events = await collectStream(t.stream("artifact_stream", {}));
  const artifactEvents = events.filter((e) => e.type === "artifact");
  assert.equal(artifactEvents.length, 1);
  assert.equal(artifactEvents[0].artifact.name, "report.txt");
});

// ---------- Typed client (in-process) ----------

test("createClient runs in-process actions through proxy", async () => {
  const action = defineAction({
    name: "double_action",
    description: "Double a number.",
    input: s.object({ x: s.number() }),
    output: s.object({ y: s.number() }),
    run: ({ x }) => ({ y: x * 2 }),
  });
  const t = createTestRuntime([action]);
  const client = createClient({ runtime: t.runtime, surface: "json" });

  const data = await client.double_action({ x: 21 });
  assert.deepEqual(data, { y: 42 });

  // Raw envelope path
  const envelope = await client.double_action({ x: 21 }, { raw: true });
  assert.equal(envelope.ok, true);
});

test("createClient passes null input through unchanged (does not collapse to {})", async () => {
  // Action whose input contract is `null` literal — anything else must fail.
  const action = defineAction({
    name: "expects_null",
    description: "Expects literal null input.",
    input: s.literal(null),
    output: s.object({ got: s.literal(null) }),
    run: (input) => ({ got: input }),
  });
  const t = createTestRuntime([action]);
  const client = createClient({ runtime: t.runtime, surface: "json" });

  // Explicit null — must reach the action as null, not {}.
  const data = await client.expects_null(null);
  assert.equal(data.got, null);

  // Sanity check: passing {} would now (correctly) be a validation error.
  await assert.rejects(
    () => client.expects_null({}),
    (err) => err.code === "VALIDATION_ERROR",
  );
});

test("MCP, JSON runner, and dev server preserve null root input", async () => {
  const { createMcpHandler, createJsonRunner } = await import("../src/index.js");

  const action = defineAction({
    name: "any_null",
    description: "Expects null.",
    input: s.literal(null),
    output: s.object({ got: s.literal(null) }),
    run: (input) => ({ got: input }),
  });

  // MCP
  const mcp = createMcpHandler({ actions: [action] });
  const mcpResp = await mcp({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "any_null", arguments: null },
  });
  assert.equal(mcpResp.result.structuredContent.ok, true);
  assert.equal(mcpResp.result.structuredContent.data.got, null);

  // JSON runner
  const json = createJsonRunner({ actions: [action] });
  const jsonResp = await json.invoke({ action: "any_null", input: null });
  assert.equal(jsonResp.ok, true);
  assert.equal(jsonResp.data.got, null);
});

test("HTTP handler preserves null root input", async () => {
  const { createHttpHandler } = await import("../src/index.js");
  const action = defineAction({
    name: "http_null",
    description: "Expects null.",
    input: s.literal(null),
    output: s.object({ got: s.literal(null) }),
    run: (input) => ({ got: input }),
  });
  const handle = createHttpHandler({ actions: [action] });
  const r = await handle({
    method: "POST",
    url: "/ageniti/actions/http_null/invoke",
    body: { input: null }, // explicit null
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.data.got, null);
});

test("generateClientTypes overloads raw:true to return RuntimeResult", () => {
  const actions = [
    defineAction({
      name: "tt",
      description: "Typed test.",
      input: s.object({ x: s.number() }),
      output: s.object({ y: s.number() }),
      run: ({ x }) => ({ y: x }),
    }),
  ];
  const dts = generateClientTypes(actions);
  // Two overloads per action: one with RawInvokeOptions returning RuntimeResult, one default.
  assert.match(dts, /tt\(input: [^)]+, options: RawInvokeOptions\): Promise<RuntimeResult<\{[\s\S]*?y: number;[\s\S]*?\}>>;/);
  assert.match(dts, /tt\(input: [^)]+, options\?: InvokeOptions\): Promise<\{[\s\S]*?y: number;[\s\S]*?\}>;/);
  // $invoke same overload pair.
  assert.match(dts, /\$invoke<T = unknown>\(name: string, input: unknown, options: RawInvokeOptions\): Promise<RuntimeResult<T>>;/);
  // RawInvokeOptions interface present.
  assert.match(dts, /export interface RawInvokeOptions extends InvokeOptions \{\s+raw: true;\s+\}/);
});

test("aborted invocation produces CANCELLED envelope so useAction maps to 'cancelled'", async () => {
  // useAction's hook treats result-type events with envelope.error.code === "CANCELLED"
  // as the terminal "cancelled" status. This test pins the runtime contract that
  // makes that mapping correct.
  const slow = defineAction({
    name: "slow_op",
    description: "Slow op.",
    run: async (_i, ctx) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ ok: true }), 5000);
      ctx.signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      });
    }),
  });
  const t = createTestRuntime([slow]);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);

  // Drain the stream and capture the final result event the hook would consume.
  let lastResult;
  for await (const event of t.stream("slow_op", {}, { signal: controller.signal })) {
    if (event.type === "result") lastResult = event.envelope;
  }
  assert.equal(lastResult.ok, false);
  assert.equal(lastResult.error.code, "CANCELLED");
});

test("createClient throws AgenitiClientError on failure", async () => {
  const action = defineAction({
    name: "fails_always",
    description: "Always fails.",
    run: () => { throw new Error("boom"); },
  });
  const t = createTestRuntime([action]);
  const client = createClient({ runtime: t.runtime, surface: "json" });

  await assert.rejects(
    () => client.fails_always({}),
    (err) => err.name === "AgenitiClientError" && err.code === "INTERNAL_ERROR",
  );
});

test("remote createClient rejects untrusted user/auth passthrough", async () => {
  const client = createClient({
    url: "https://example.com",
    fetch: async () => {
      throw new Error("fetch should not run");
    },
  });

  await assert.rejects(
    () => client.any_action({}, { user: { id: "alice" } }),
    (err) => err.name === "AgenitiClientError" && err.code === "UNTRUSTED_REMOTE_IDENTITY",
  );
});

test("remote createClient wraps transport and invalid response failures", async () => {
  const networkClient = createClient({
    url: "https://example.com",
    fetch: async () => {
      throw new Error("socket hang up");
    },
  });
  await assert.rejects(
    () => networkClient.any_action({}),
    (err) => err.name === "AgenitiClientError" && err.code === "TRANSPORT_ERROR",
  );

  const invalidClient = createClient({
    url: "https://example.com",
    fetch: async () => ({
      status: 502,
      text: async () => "<html>bad gateway</html>",
    }),
  });
  await assert.rejects(
    () => invalidClient.any_action({}),
    (err) => err.name === "AgenitiClientError" && err.code === "INVALID_RESPONSE",
  );
});

// ---------- Codegen ----------

test("generateClientTypes produces a typed interface from actions", () => {
  const actions = [
    defineAction({
      name: "search_tasks",
      description: "Search tasks.",
      input: s.object({ query: s.string(), limit: s.number().optional() }),
      output: s.object({ results: s.array(s.string()) }),
      run: () => ({ results: [] }),
    }),
  ];

  const dts = generateClientTypes(actions, { interfaceName: "MyClient" });
  assert.match(dts, /interface MyClient/);
  assert.match(dts, /search_tasks\(input:/);
  assert.match(dts, /query: string/);
  assert.match(dts, /limit\?: number/);
  assert.match(dts, /results: Array<string>/);
});

test("jsonSchemaToTs handles unions and enums", () => {
  assert.equal(jsonSchemaToTs({ type: "string" }), "string");
  assert.equal(jsonSchemaToTs({ enum: ["a", "b"] }), '"a" | "b"');
  assert.equal(jsonSchemaToTs({ const: 42 }), "42");
  assert.equal(jsonSchemaToTs({ anyOf: [{ type: "string" }, { type: "number" }] }), "string | number");
});

// ---------- Test helpers ----------

test("expectOk / expectError / expectLog work as advertised", async () => {
  const action = defineAction({
    name: "log_ok",
    description: "Logs.",
    run: (_i, ctx) => {
      ctx.logger.info("hello world");
      return { ok: true };
    },
  });
  const t = createTestRuntime([action]);
  const envelope = await t.invoke("log_ok", {});
  expectOk(envelope);
  const log = (await import("../src/testing/test-utils.js")).expectLog(envelope, /hello/);
  assert.equal(log.message, "hello world");

  // expectOk on a failed envelope throws
  const failingT = createTestRuntime([
    defineAction({ name: "fail_now", description: "Fails.", run: () => { throw new Error("nope"); } }),
  ]);
  const failed = await failingT.invoke("fail_now", {});
  assert.throws(() => expectOk(failed));
  expectError(failed); // does not throw
  assert.throws(() => expectError(failed, "VALIDATION_ERROR")); // wrong code
});
