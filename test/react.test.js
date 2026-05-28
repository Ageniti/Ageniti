import assert from "node:assert/strict";
import test from "node:test";
import { createReactActionAdapter, makeInvoker, streamAction } from "../src/react.js";
import { createRuntime, defineAction } from "../src/runtime/core.js";
import { s } from "../src/schema/schema.js";
import { collectStream } from "../src/testing/test-utils.js";

// These are the headless, React-free bindings shipped at @ageniti/core/react.
// They must work in non-React contexts (RSC, CLI), so they are pure functions
// over the runtime and are testable with zero dependencies.

const echo = defineAction({
  name: "echo",
  description: "Echo the input back.",
  input: s.object({ value: s.number() }),
  run: async (input) => ({ echoed: input.value }),
});

test("makeInvoker returns a function that invokes through a runtime and defaults surface to 'react'", async () => {
  let observedSurface;
  const action = defineAction({
    name: "surface_probe",
    description: "Reports the surface it ran under.",
    run: async (_input, ctx) => {
      observedSurface = ctx.surface;
      return { ok: true };
    },
  });

  const invoke = makeInvoker(action, { runtime: createRuntime({ actions: [action] }) });
  assert.equal(typeof invoke, "function");

  const envelope = await invoke({});
  assert.equal(envelope.ok, true);
  assert.equal(observedSurface, "react");
});

test("makeInvoker builds an implicit runtime when none is provided", async () => {
  const invoke = makeInvoker(echo);
  const envelope = await invoke({ value: 42 });
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, { echoed: 42 });
});

test("makeInvoker honors an explicit surface override from call options", async () => {
  let observedSurface;
  const action = defineAction({
    name: "surface_override",
    description: "Reports the surface it ran under.",
    run: async (_input, ctx) => {
      observedSurface = ctx.surface;
      return { ok: true };
    },
  });

  const invoke = makeInvoker(action);
  await invoke({}, { surface: "http" });
  assert.equal(observedSurface, "http");
});

test("streamAction yields the live event stream and a terminal result", async () => {
  const action = defineAction({
    name: "streamy_react",
    description: "Streams progress then resolves.",
    run: async (_input, ctx) => {
      ctx.logger.info("start");
      ctx.progress.report({ percent: 50, message: "halfway" });
      return { done: true };
    },
  });

  const runtime = createRuntime({ actions: [action] });
  const events = await collectStream(streamAction(runtime, action, {}));
  const types = events.map((e) => e.type);

  assert.ok(types.includes("log"));
  assert.ok(types.includes("progress"));
  assert.equal(types.at(-1), "result");
  assert.equal(events.at(-1).envelope.ok, true);
  assert.deepEqual(events.at(-1).envelope.data, { done: true });
});

test("createReactActionAdapter exposes a runtime and an invoker factory", async () => {
  const action = defineAction({
    name: "adapter_action",
    description: "Adapter-backed action.",
    input: s.object({ value: s.number() }),
    run: async (input) => ({ value: input.value }),
  });

  const adapter = createReactActionAdapter({ actions: [action] });
  assert.ok(adapter.runtime, "adapter exposes a runtime");
  assert.equal(typeof adapter.useAction, "function");

  const invoke = adapter.useAction(action);
  assert.equal(typeof invoke, "function");

  const envelope = await invoke({ value: 7 });
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, { value: 7 });
});

test("createReactActionAdapter reuses a provided runtime instead of creating one", async () => {
  const action = defineAction({
    name: "shared_runtime_action",
    description: "Runs through a shared runtime.",
    run: async () => ({ ok: true }),
  });

  const runtime = createRuntime({ actions: [action] });
  const adapter = createReactActionAdapter({ runtime });
  assert.equal(adapter.runtime, runtime);

  const envelope = await adapter.useAction(action)({});
  assert.equal(envelope.ok, true);
});
