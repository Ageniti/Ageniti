import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import {
  AgenitiError,
  ERROR_CODES,
  createCli,
  createHttpHandler,
  createHttpServer,
  createMcpStdioServer,
  createRuntime,
  defineAction,
  s,
} from "../src/index.js";

// ---------- defineAction reserved names ----------

test("defineAction rejects reserved CLI command names", () => {
  for (const name of ["actions", "manifest", "mcp", "dev", "build", "lint"]) {
    assert.throws(
      () => defineAction({ name, description: "desc.", run: () => ({}) }),
      /reserved/,
    );
  }
});

// ---------- retry + timeout interaction ----------

test("retry works correctly across timeouts (per-attempt AbortController)", async () => {
  let attempts = 0;
  const flaky = defineAction({
    name: "flaky_timeout",
    description: "Hangs on first attempt, succeeds on second.",
    timeoutMs: 50,
    retry: { retries: 1, delayMs: 5 },
    output: s.object({ attempts: s.number() }),
    run: async (_input, ctx) => {
      attempts += 1;
      if (attempts === 1) {
        // Simulate a hang that will be aborted by timeout.
        return new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 10_000);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new AgenitiError(ERROR_CODES.TIMEOUT, "aborted", { retryable: true }));
          });
        });
      }
      return { attempts };
    },
  });

  const runtime = createRuntime({ actions: [flaky] });
  const result = await runtime.invoke("flaky_timeout", {}, { surface: "cli" });
  assert.equal(result.ok, true);
  assert.equal(result.data.attempts, 2);
});

test("retry backoff stops promptly when the caller aborts", async () => {
  let attempts = 0;
  const flaky = defineAction({
    name: "retry_backoff_abort",
    description: "Fails and waits for retry.",
    retry: { retries: 1, delayMs: 200 },
    run() {
      attempts += 1;
      throw new AgenitiError(ERROR_CODES.EXTERNAL_SERVICE_ERROR, "try again", { retryable: true });
    },
  });

  const runtime = createRuntime({ actions: [flaky] });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  const started = Date.now();
  const result = await runtime.invoke("retry_backoff_abort", {}, {
    surface: "cli",
    signal: controller.signal,
  });
  const elapsed = Date.now() - started;

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "CANCELLED");
  assert.equal(attempts, 1);
  assert.equal(elapsed < 150, true);
});

// ---------- external signal cancellation ----------

test("external AbortSignal cancels invocation", async () => {
  const slow = defineAction({
    name: "slow_action",
    description: "Slow action that respects abort.",
    output: s.object({ done: s.boolean() }),
    run: async (_input, ctx) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ done: true }), 5_000);
        ctx.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
    },
  });

  const runtime = createRuntime({ actions: [slow] });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  const result = await runtime.invoke("slow_action", {}, {
    surface: "cli",
    signal: controller.signal,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, ERROR_CODES.CANCELLED);
});

test("invocation rejects pre-aborted signal immediately", async () => {
  const action = defineAction({
    name: "any_action",
    description: "Any action.",
    run: () => ({ ok: true }),
  });
  const runtime = createRuntime({ actions: [action] });
  const controller = new AbortController();
  controller.abort();
  const result = await runtime.invoke("any_action", {}, {
    surface: "cli",
    signal: controller.signal,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, ERROR_CODES.CANCELLED);
});

test("runtime.stream aborts the underlying action when the consumer stops early", async () => {
  let aborted = false;
  const slow = defineAction({
    name: "stream_cancellable",
    description: "Emits once, then waits for cancellation.",
    run: async (_input, ctx) => {
      ctx.logger.info("started");
      return new Promise((resolve, reject) => {
        ctx.signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        }, { once: true });
        setTimeout(() => resolve({ ok: true }), 5_000);
      });
    },
  });

  const runtime = createRuntime({ actions: [slow] });
  const events = runtime.stream("stream_cancellable", {}, { surface: "cli" });
  const first = await events.next();
  assert.equal(first.done, false);
  assert.equal(first.value.type, "log");

  await events.return();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(aborted, true);
});

// ---------- idempotency ----------

test("idempotency key replays cached envelope for write actions", async () => {
  let runs = 0;
  const create = defineAction({
    name: "create_thing",
    description: "Create a thing once.",
    sideEffects: "write",
    idempotency: "conditional",
    input: s.object({ title: s.string() }),
    output: s.object({ id: s.string() }),
    run: ({ title }) => {
      runs += 1;
      return { id: `id-${runs}-${title}` };
    },
  });

  const runtime = createRuntime({ actions: [create] });
  const a = await runtime.invoke("create_thing", { title: "x" }, {
    surface: "cli", idempotencyKey: "k1",
  });
  const b = await runtime.invoke("create_thing", { title: "x" }, {
    surface: "cli", idempotencyKey: "k1",
  });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(runs, 1);
  assert.equal(a.data.id, b.data.id);
  assert.equal(b.meta.idempotent, "replayed");
});

test("idempotency cache is scoped by caller identity", async () => {
  let runs = 0;
  const create = defineAction({
    name: "create_scoped",
    description: "Create with caller-specific output.",
    sideEffects: "write",
    output: s.object({ owner: s.string(), run: s.number() }),
    run: (_input, ctx) => {
      runs += 1;
      return { owner: ctx.user.id, run: runs };
    },
  });

  const runtime = createRuntime({ actions: [create] });
  const a = await runtime.invoke("create_scoped", {}, {
    surface: "http",
    user: { id: "alice" },
    idempotencyKey: "same",
    confirm: true,
  });
  const b = await runtime.invoke("create_scoped", {}, {
    surface: "http",
    user: { id: "bob" },
    idempotencyKey: "same",
    confirm: true,
  });

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(runs, 2);
  assert.equal(a.data.owner, "alice");
  assert.equal(b.data.owner, "bob");
  assert.notEqual(b.meta.idempotent, "replayed");
});

test("idempotency cache is scoped by validated input", async () => {
  let runs = 0;
  const create = defineAction({
    name: "create_by_input",
    description: "Create with input-specific output.",
    sideEffects: "write",
    input: s.object({ value: s.string() }),
    output: s.object({ value: s.string(), run: s.number() }),
    run: ({ value }) => {
      runs += 1;
      return { value, run: runs };
    },
  });

  const runtime = createRuntime({ actions: [create] });
  const a = await runtime.invoke("create_by_input", { value: "a" }, {
    surface: "http",
    idempotencyKey: "same",
    confirm: true,
  });
  const b = await runtime.invoke("create_by_input", { value: "b" }, {
    surface: "http",
    idempotencyKey: "same",
    confirm: true,
  });

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(runs, 2);
  assert.equal(a.data.value, "a");
  assert.equal(b.data.value, "b");
  assert.notEqual(b.meta.idempotent, "replayed");
});

test("idempotency replay returns an isolated envelope copy", async () => {
  const create = defineAction({
    name: "create_isolated",
    description: "Create nested data.",
    sideEffects: "write",
    output: s.object({
      nested: s.object({
        value: s.string(),
      }),
    }),
    run: () => ({
      nested: { value: "original" },
    }),
  });

  const runtime = createRuntime({ actions: [create] });
  const first = await runtime.invoke("create_isolated", {}, {
    surface: "http",
    idempotencyKey: "same",
    confirm: true,
  });
  assert.equal(first.ok, true);
  first.data.nested.value = "mutated-live";

  const replay = await runtime.invoke("create_isolated", {}, {
    surface: "http",
    idempotencyKey: "same",
    confirm: true,
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.data.nested.value, "original");

  replay.data.nested.value = "mutated-replay";
  const replayAgain = await runtime.invoke("create_isolated", {}, {
    surface: "http",
    idempotencyKey: "same",
    confirm: true,
  });
  assert.equal(replayAgain.ok, true);
  assert.equal(replayAgain.data.nested.value, "original");
});

// ---------- concurrency limit ----------

test("concurrency limit rejects beyond max active invocations", async () => {
  let release;
  const blocking = defineAction({
    name: "blocking_action",
    description: "Blocks until released.",
    concurrency: { max: 1 },
    run: () => new Promise((resolve) => {
      release = () => resolve({ ok: true });
    }),
  });
  const runtime = createRuntime({ actions: [blocking] });

  const first = runtime.invoke("blocking_action", {}, { surface: "cli" });
  // wait a tick so the first invocation reserves the slot
  await new Promise((r) => setTimeout(r, 5));
  const second = await runtime.invoke("blocking_action", {}, { surface: "cli" });
  assert.equal(second.ok, false);
  assert.equal(second.error.code, ERROR_CODES.CONCURRENCY_LIMIT);

  release();
  const firstResult = await first;
  assert.equal(firstResult.ok, true);
});

// ---------- runtime hooks ----------

test("runtime hooks observe invocation lifecycle", async () => {
  const action = defineAction({
    name: "hooked_action",
    description: "Hooked action.",
    run: () => ({ ok: true }),
  });
  const events = [];
  const runtime = createRuntime({
    actions: [action],
    hooks: {
      onInvocationStart: (ev) => events.push(["start", ev.action.name]),
      onInvocationEnd: (ev) => events.push(["end", ev.action.name, ev.envelope.ok]),
    },
  });
  await runtime.invoke("hooked_action", {}, { surface: "cli" });
  assert.deepEqual(events, [["start", "hooked_action"], ["end", "hooked_action", true]]);
});

test("runtime hook errors do not break invocation", async () => {
  const action = defineAction({
    name: "ok_action",
    description: "ok.",
    run: () => ({ ok: true }),
  });
  const runtime = createRuntime({
    actions: [action],
    hooks: {
      onInvocationStart: () => { throw new Error("boom"); },
      onInvocationEnd: () => { throw new Error("boom"); },
    },
  });
  const r = await runtime.invoke("ok_action", {}, { surface: "cli" });
  assert.equal(r.ok, true);
});

// ---------- deprecated runtime warning ----------

test("deprecated actions emit a runtime warn log", async () => {
  const old = defineAction({
    name: "old_action",
    description: "Old action.",
    deprecated: true,
    deprecation: { message: "use new_action", replacement: "new_action" },
    run: () => ({ ok: true }),
  });
  const runtime = createRuntime({ actions: [old] });
  const r = await runtime.invoke("old_action", {}, { surface: "cli" });
  assert.equal(r.ok, true);
  assert.equal(r.logs.some((l) => l.level === "warn" && /deprecated/i.test(l.message)), true);
});

// ---------- redaction ----------

test("logger redacts default secret keys", async () => {
  const action = defineAction({
    name: "leaky_action",
    description: "Logs sensitive fields.",
    run: (_i, ctx) => {
      ctx.logger.info("called", {
        token: "supersecret",
        nested: { apiKey: "abc", harmless: 1 },
        password: "p@ss",
      });
      return { ok: true };
    },
  });
  const runtime = createRuntime({ actions: [action] });
  const r = await runtime.invoke("leaky_action", {}, { surface: "cli" });
  const fields = r.logs[0].fields;
  assert.equal(fields.token, "[REDACTED]");
  assert.equal(fields.password, "[REDACTED]");
  assert.equal(fields.nested.apiKey, "[REDACTED]");
  assert.equal(fields.nested.harmless, 1);
});

test("error messages have obvious secrets redacted", async () => {
  const action = defineAction({
    name: "leaky_error",
    description: "Throws with a token in message.",
    run: () => {
      throw new Error("upstream rejected token sk-live_abcdefghijklmno1234 and Authorization: Bearer eyJabcdefghijklmnopqrstuvwxyz");
    },
  });
  const runtime = createRuntime({ actions: [action] });
  const r = await runtime.invoke("leaky_error", {}, { surface: "cli" });
  assert.equal(r.ok, false);
  assert.equal(r.error.message.includes("sk-live_"), false);
  assert.equal(r.error.message.includes("eyJabcdef"), false);
  assert.match(r.error.message, /\[REDACTED\]/);
});

test("idempotency cache evicts past LRU cap", async () => {
  let runs = 0;
  const create = defineAction({
    name: "create_with_cap",
    description: "Create.",
    sideEffects: "write",
    input: s.object({ x: s.number() }),
    run: ({ x }) => {
      runs += 1;
      return { x, runs };
    },
  });
  const runtime = createRuntime({ actions: [create], idempotencyMaxEntries: 2 });

  await runtime.invoke("create_with_cap", { x: 1 }, { surface: "cli", idempotencyKey: "a" });
  await runtime.invoke("create_with_cap", { x: 2 }, { surface: "cli", idempotencyKey: "b" });
  await runtime.invoke("create_with_cap", { x: 3 }, { surface: "cli", idempotencyKey: "c" });
  // "a" should be evicted: replay should re-run it.
  const replayA = await runtime.invoke("create_with_cap", { x: 1 }, { surface: "cli", idempotencyKey: "a" });
  assert.notEqual(replayA.meta.idempotent, "replayed");
  // "c" is still cached.
  const replayC = await runtime.invoke("create_with_cap", { x: 3 }, { surface: "cli", idempotencyKey: "c" });
  assert.equal(replayC.meta.idempotent, "replayed");
});

test("redact accepts custom keys", async () => {
  const action = defineAction({
    name: "custom_redact",
    description: "Redact custom keys.",
    run: (_i, ctx) => {
      ctx.logger.info("call", { ssn: "123-45-6789", normal: "ok" });
      return { ok: true };
    },
  });
  const runtime = createRuntime({ actions: [action], redact: { keys: ["ssn"] } });
  const r = await runtime.invoke("custom_redact", {}, { surface: "cli" });
  assert.equal(r.logs[0].fields.ssn, "[REDACTED]");
  assert.equal(r.logs[0].fields.normal, "ok");
});

// ---------- JSON serializable ----------

test("non-serializable outputs are rejected with a clear reason", async () => {
  const bad = defineAction({
    name: "bad_output",
    description: "Returns a Map.",
    run: () => new Map([["a", 1]]),
  });
  const runtime = createRuntime({ actions: [bad] });
  const r = await runtime.invoke("bad_output", {}, { surface: "cli" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR_CODES.OUTPUT_SERIALIZATION_ERROR);
  assert.match(r.error.message, /Map/);
});

test("circular outputs are rejected", async () => {
  const action = defineAction({
    name: "circular_output",
    description: "Returns circular.",
    run: () => {
      const obj = {};
      obj.self = obj;
      return obj;
    },
  });
  const runtime = createRuntime({ actions: [action] });
  const r = await runtime.invoke("circular_output", {}, { surface: "cli" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR_CODES.OUTPUT_SERIALIZATION_ERROR);
});

// ---------- Schema strict ----------

test("ObjectSchema .strict() rejects unknown properties", () => {
  const schema = s.object({ a: s.number() }).strict();
  const ok = schema.validate({ a: 1 });
  assert.equal(ok.ok, true);
  const bad = schema.validate({ a: 1, extra: 2 });
  assert.equal(bad.ok, false);
  assert.match(bad.issues[0].message, /Unexpected/);
});

// ---------- CLI behaviors ----------

const cliAction = defineAction({
  name: "cli_action",
  description: "CLI action.",
  input: s.object({
    label: s.string(),
    enabled: s.boolean().default(true),
    tags: s.array(s.string()).default([]),
  }),
  run: (input) => input,
});

test("CLI rejects --no-<flag> for non-boolean fields", async () => {
  const cli = createCli({ name: "x", actions: [cliAction] });
  const errs = [];
  const code = await cli.run(["cli-action", "--no-label"], {
    stdout: () => {},
    stderr: (v) => errs.push(v),
  });
  assert.equal(code, 2);
  assert.match(errs[0], /--no-\* is only valid for boolean/);
});

test("CLI accepts repeated array flags", async () => {
  const cli = createCli({ name: "x", actions: [cliAction] });
  const out = [];
  const code = await cli.run(
    ["cli-action", "--label", "hi", "--tags", "a", "--tags", "b"],
    { stdout: (v) => out.push(v), stderr: () => {} },
  );
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out[0]).data.tags, ["a", "b"]);
});

test("CLI emits NDJSON when --ndjson is supplied", async () => {
  const logging = defineAction({
    name: "logging_action",
    description: "Logs then returns.",
    run: (_i, ctx) => {
      ctx.logger.info("hello");
      return { ok: true };
    },
  });
  const cli = createCli({ name: "x", actions: [logging] });
  const out = [];
  const code = await cli.run(["logging-action", "--ndjson"], {
    stdout: (v) => out.push(v),
    stderr: () => {},
  });
  assert.equal(code, 0);
  const lines = out.map((line) => JSON.parse(line));
  assert.equal(lines[0].type, "log");
  assert.equal(lines[lines.length - 1].type, "result");
  assert.equal(lines[lines.length - 1].ok, true);
});

test("CLI passes idempotency key into runtime", async () => {
  let runs = 0;
  const create = defineAction({
    name: "create_action",
    description: "Create.",
    sideEffects: "write",
    input: s.object({ x: s.number() }),
    run: ({ x }) => {
      runs += 1;
      return { id: `${runs}-${x}` };
    },
  });
  const cli = createCli({ name: "x", actions: [create] });
  const out = [];
  await cli.run(["create-action", "--x", "1", "--idempotency-key", "k", "--confirm"], {
    stdout: (v) => out.push(v), stderr: () => {},
  });
  await cli.run(["create-action", "--x", "1", "--idempotency-key", "k", "--confirm"], {
    stdout: (v) => out.push(v), stderr: () => {},
  });
  assert.equal(runs, 1);
});

// ---------- HTTP hardening ----------

test("HTTP error codes map to detailed statuses", async () => {
  const failing = defineAction({
    name: "failing_action",
    description: "Always fails.",
    run: () => {
      throw new AgenitiError(ERROR_CODES.RATE_LIMITED, "slow down", { retryable: true });
    },
  });
  const handle = createHttpHandler({ actions: [failing] });
  const r = await handle({
    method: "POST",
    url: "/ageniti/actions/failing_action/invoke",
    body: { input: {} },
  });
  assert.equal(r.status, 429);
});

test("HTTP handler ignores untrusted body auth/user by default", async () => {
  const action = defineAction({
    name: "admin_only",
    description: "Admin action.",
    output: s.object({ ok: s.boolean() }),
    run: () => ({ ok: true }),
  });
  const handle = createHttpHandler({
    actions: [action],
    runtimeOptions: {
      permissionChecker: ({ context }) => context.auth?.role === "admin" || "forbidden",
    },
  });

  const res = await handle({
    method: "POST",
    url: "/ageniti/actions/admin_only/invoke",
    headers: {},
    body: { input: {}, auth: { role: "admin" }, user: { id: "attacker" } },
  });

  assert.equal(res.status, 403);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, "AUTHORIZATION_ERROR");
});

test("HTTP handler accepts trusted context via resolveContext", async () => {
  const action = defineAction({
    name: "trusted_admin",
    description: "Trusted admin action.",
    output: s.object({ ok: s.boolean() }),
    run: () => ({ ok: true }),
  });
  const handle = createHttpHandler({
    actions: [action],
    resolveContext: ({ request }) => ({
      auth: request.headers?.authorization === "Bearer trusted-admin" ? { role: "admin" } : { role: "user" },
      user: { id: "resolved-user" },
    }),
    runtimeOptions: {
      permissionChecker: ({ context }) => context.auth?.role === "admin" || "forbidden",
    },
  });

  const res = await handle({
    method: "POST",
    url: "/ageniti/actions/trusted_admin/invoke",
    headers: { authorization: "Bearer trusted-admin" },
    body: { input: {}, auth: { role: "user" } },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test("HTTP server rejects oversized bodies", async () => {
  const action = defineAction({
    name: "echo_action",
    description: "Echo.",
    input: s.object({ data: s.string() }),
    run: (i) => i,
  });
  const { server, listen } = createHttpServer({
    actions: [action], maxBodyBytes: 64,
  });
  let listener;
  try {
    listener = await listen(0);
  } catch (error) {
    if (error?.code === "EPERM") {
      server.close();
      return;
    }
    throw error;
  }
  try {
    const body = JSON.stringify({ input: { data: "x".repeat(1024) } });
    const res = await fetch(`${listener.url}/ageniti/actions/echo_action/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(res.status, 413);
    const payload = await res.json();
    assert.equal(payload.error.code, "PAYLOAD_TOO_LARGE");
  } finally {
    await listener.close();
  }
});

test("HTTP server rejects non-JSON content type", async () => {
  const action = defineAction({
    name: "echo_two",
    description: "Echo.",
    input: s.object({ data: s.string() }),
    run: (i) => i,
  });
  const { server, listen } = createHttpServer({ actions: [action] });
  let listener;
  try {
    listener = await listen(0);
  } catch (error) {
    if (error?.code === "EPERM") {
      server.close();
      return;
    }
    throw error;
  }
  try {
    const res = await fetch(`${listener.url}/ageniti/actions/echo_two/invoke`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "raw text",
    });
    assert.equal(res.status, 415);
  } finally {
    await listener.close();
  }
});

test("HTTP server requires application/json when content type is missing", async () => {
  const action = defineAction({
    name: "echo_three",
    description: "Echo.",
    input: s.object({ data: s.string() }),
    run: (i) => i,
  });
  const { server, listen } = createHttpServer({ actions: [action] });
  let listener;
  try {
    listener = await listen(0);
  } catch (error) {
    if (error?.code === "EPERM") {
      server.close();
      return;
    }
    throw error;
  }
  try {
    const res = await fetch(`${listener.url}/ageniti/actions/echo_three/invoke`, {
      method: "POST",
      body: JSON.stringify({ input: { data: "hello" } }),
    });
    assert.equal(res.status, 415);
    const payload = await res.json();
    assert.equal(payload.error.code, "UNSUPPORTED_MEDIA_TYPE");
  } finally {
    await listener.close();
  }
});

// ---------- MCP framing ----------

test("MCP stdio handles Content-Length framed requests", async () => {
  const action = defineAction({
    name: "mcp_echo",
    description: "Echo.",
    input: s.object({ value: s.string() }),
    output: s.object({ value: s.string() }),
    run: (i) => i,
  });

  const server = createMcpStdioServer({ actions: [action] });
  const input = new PassThrough();
  const output = new PassThrough();
  const collected = [];
  output.on("data", (chunk) => collected.push(chunk));

  const started = server.start({ input, output });

  const request = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "mcp_echo", arguments: { value: "hi" } },
  });
  const body = Buffer.from(request, "utf8");
  input.write(`Content-Length: ${body.length}\r\n\r\n`);
  input.write(body);

  // give the server time to process
  await new Promise((r) => setTimeout(r, 50));
  input.end();
  await started;

  const raw = Buffer.concat(collected).toString("utf8");
  // Response should be Content-Length-framed
  assert.match(raw, /^Content-Length: \d+\r\n\r\n/);
  const headerEnd = raw.indexOf("\r\n\r\n");
  const payload = JSON.parse(raw.slice(headerEnd + 4));
  assert.equal(payload.result.structuredContent.ok, true);
  assert.equal(payload.result.structuredContent.data.value, "hi");
});

test("MCP stdio returns parse errors for invalid JSON payloads", async () => {
  const server = createMcpStdioServer({ actions: [] });
  const input = new PassThrough();
  const output = new PassThrough();
  const collected = [];
  output.on("data", (chunk) => collected.push(chunk));

  const started = server.start({ input, output });
  input.write("{\"jsonrpc\":\"2.0\"");

  await new Promise((r) => setTimeout(r, 20));
  input.end("\n");
  await started;

  const raw = Buffer.concat(collected).toString("utf8").trim();
  const payload = JSON.parse(raw);
  assert.equal(payload.error.code, -32700);
});

test("MCP stdio auto-detect waits for a split Content-Length header", async () => {
  const action = defineAction({
    name: "mcp_echo_split",
    description: "Echo.",
    input: s.object({ value: s.string() }),
    output: s.object({ value: s.string() }),
    run: (i) => i,
  });

  const server = createMcpStdioServer({ actions: [action] });
  const input = new PassThrough();
  const output = new PassThrough();
  const collected = [];
  output.on("data", (chunk) => collected.push(chunk));

  const started = server.start({ input, output });
  const request = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "mcp_echo_split", arguments: { value: "split" } },
  });
  const body = Buffer.from(request, "utf8");

  input.write("Content-Len");
  await new Promise((r) => setTimeout(r, 5));
  input.write(`gth: ${body.length}\r\n`);
  await new Promise((r) => setTimeout(r, 5));
  input.write("\r\n");
  input.write(body);

  await new Promise((r) => setTimeout(r, 50));
  input.end();
  await started;

  const raw = Buffer.concat(collected).toString("utf8");
  assert.match(raw, /^Content-Length: \d+\r\n\r\n/);
  const headerEnd = raw.indexOf("\r\n\r\n");
  const payload = JSON.parse(raw.slice(headerEnd + 4));
  assert.equal(payload.result.structuredContent.ok, true);
  assert.equal(payload.result.structuredContent.data.value, "split");
});

test("MCP stdio handles newline-delimited requests", async () => {
  const action = defineAction({
    name: "mcp_echo_nd",
    description: "Echo.",
    input: s.object({ value: s.string() }),
    output: s.object({ value: s.string() }),
    run: (i) => i,
  });

  const server = createMcpStdioServer({ actions: [action] });
  const input = new PassThrough();
  const output = new PassThrough();
  const collected = [];
  output.on("data", (chunk) => collected.push(chunk));

  const started = server.start({ input, output });

  const request = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "mcp_echo_nd", arguments: { value: "yo" } },
  });
  input.write(`${request}\n`);

  await new Promise((r) => setTimeout(r, 50));
  input.end();
  await started;

  const raw = Buffer.concat(collected).toString("utf8").trim();
  const payload = JSON.parse(raw);
  assert.equal(payload.result.structuredContent.data.value, "yo");
});

test("MCP stdio rejects oversized newline frames", async () => {
  const server = createMcpStdioServer({ actions: [], maxFrameBytes: 64 });
  const input = new PassThrough();
  const output = new PassThrough();
  const collected = [];
  output.on("data", (chunk) => collected.push(chunk));

  const started = server.start({ input, output });
  input.write(`${"x".repeat(80)}\n`);
  await new Promise((r) => setTimeout(r, 50));
  input.end();
  await started;

  const raw = Buffer.concat(collected).toString("utf8").trim();
  const payload = JSON.parse(raw);
  assert.equal(payload.error.code, -32600);
  assert.match(payload.error.message, /exceeds limit/i);
});

test("MCP stdio rejects oversized Content-Length frames", async () => {
  const server = createMcpStdioServer({ actions: [], maxFrameBytes: 64 });
  const input = new PassThrough();
  const output = new PassThrough();
  const collected = [];
  output.on("data", (chunk) => collected.push(chunk));

  const started = server.start({ input, output });
  input.write("Content-Length: 128\r\n\r\n");
  input.write("x".repeat(128));
  await new Promise((r) => setTimeout(r, 50));
  input.end();
  await started;

  const raw = Buffer.concat(collected).toString("utf8");
  assert.match(raw, /^Content-Length: \d+\r\n\r\n/);
  const headerEnd = raw.indexOf("\r\n\r\n");
  const payload = JSON.parse(raw.slice(headerEnd + 4));
  assert.equal(payload.error.code, -32600);
  assert.match(payload.error.message, /exceeds limit/i);
});
