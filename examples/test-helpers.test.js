// How to test actions with @ageniti/core/test-utils.
//
// Run with: node --test examples/test-helpers.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { defineAction, s } from "../src/index.js";
import {
  collectStream,
  createTestRuntime,
  expectError,
  expectLog,
  expectOk,
} from "../src/index.js";

const greet = defineAction({
  name: "greet",
  description: "Greet someone.",
  input: s.object({ name: s.string().min(1) }),
  output: s.object({ greeting: s.string() }),
  run: ({ name }, ctx) => {
    ctx.logger.info("greeting requested", { name });
    return { greeting: `Hello ${name}` };
  },
});

const flaky = defineAction({
  name: "flaky",
  description: "Always fails.",
  run: () => { throw new Error("oops"); },
});

test("happy path: expectOk returns data", async () => {
  const t = createTestRuntime([greet]);
  const env = await t.invoke("greet", { name: "Ada" });
  const data = expectOk(env);
  assert.equal(data.greeting, "Hello Ada");
});

test("validation failure: expectError matches by code", async () => {
  const t = createTestRuntime([greet]);
  const env = await t.invoke("greet", { name: "" });
  const error = expectError(env, "VALIDATION_ERROR");
  assert.equal(error.issues[0].path[0], "name");
});

test("internal failure: expectError without code matches any failure", async () => {
  const t = createTestRuntime([flaky]);
  const env = await t.invoke("flaky", {});
  const error = expectError(env);
  assert.equal(error.code, "INTERNAL_ERROR");
});

test("logs: expectLog finds entries by string / regex", async () => {
  const t = createTestRuntime([greet]);
  const env = await t.invoke("greet", { name: "Ada" });
  const log = expectLog(env, /greeting/);
  assert.equal(log.fields.name, "Ada");
});

test("permission denial: allow option simulates auth check", async () => {
  const t = createTestRuntime([greet], { allow: "denied for tests" });
  const env = await t.invoke("greet", { name: "Ada" });
  const error = expectError(env, "AUTHORIZATION_ERROR");
  assert.match(error.message, /denied for tests/);
});

test("services: inject dependencies via runtime services", async () => {
  const action = defineAction({
    name: "save",
    description: "Save via injected store.",
    input: s.object({ value: s.string() }),
    run: ({ value }, ctx) => {
      ctx.services.store.put(value);
      return { ok: true };
    },
  });

  const writes = [];
  const t = createTestRuntime([action], {
    services: { store: { put: (v) => writes.push(v) } },
  });

  await t.invoke("save", { value: "x" });
  assert.deepEqual(writes, ["x"]);
});

test("streaming: collectStream drains all events including the final result", async () => {
  const t = createTestRuntime([greet]);
  const events = await collectStream(t.stream("greet", { name: "Ada" }));
  const types = events.map((e) => e.type);
  assert.ok(types.includes("log"));
  assert.equal(types[types.length - 1], "result");
});
