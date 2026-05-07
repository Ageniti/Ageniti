// Test helpers for actions and runtimes. Headless — works with any test
// framework that has plain assertions (node:test, vitest, jest).

import { createRuntime } from "../runtime/core.js";

// Create a runtime preconfigured for tests:
//   - all actions auto-registered
//   - default surface = "json" (no confirmation gate, no UI assumptions)
//   - permissionChecker overridable via { allow: false } to simulate denial
//   - services injectable for dependency stubs
export function createTestRuntime(actions, options = {}) {
  const runtimeOptions = {
    actions,
    services: options.services ?? {},
    middleware: options.middleware,
    hooks: options.hooks,
  };

  if (options.allow === false) {
    runtimeOptions.permissionChecker = () => "denied by test runtime";
  } else if (typeof options.allow === "function") {
    runtimeOptions.permissionChecker = options.allow;
  } else if (typeof options.allow === "string") {
    runtimeOptions.permissionChecker = () => options.allow;
  }

  if (options.redact) runtimeOptions.redact = options.redact;
  if (options.idempotencyCache) runtimeOptions.idempotencyCache = options.idempotencyCache;

  const runtime = createRuntime(runtimeOptions);

  return {
    runtime,
    invoke(name, input = {}, invokeOptions = {}) {
      return runtime.invoke(name, input, {
        surface: invokeOptions.surface ?? "json",
        confirm: invokeOptions.confirm ?? true, // tests usually want to bypass confirmation
        ...invokeOptions,
      });
    },
    stream(name, input = {}, invokeOptions = {}) {
      return runtime.stream(name, input, {
        surface: invokeOptions.surface ?? "json",
        confirm: invokeOptions.confirm ?? true,
        ...invokeOptions,
      });
    },
  };
}

// Assertion helpers. They throw plain Error so any framework picks them up.

export function expectOk(envelope) {
  if (!envelope || envelope.ok !== true) {
    const error = new Error(
      `Expected successful envelope, got ${envelope?.ok === false ? `error ${envelope.error?.code}: ${envelope.error?.message}` : String(envelope)}`
    );
    error.envelope = envelope;
    throw error;
  }
  return envelope.data;
}

export function expectError(envelope, expectedCode) {
  if (!envelope || envelope.ok !== false) {
    const error = new Error(`Expected failure envelope, got ok=${envelope?.ok}`);
    error.envelope = envelope;
    throw error;
  }
  if (expectedCode && envelope.error.code !== expectedCode) {
    const error = new Error(
      `Expected error code "${expectedCode}", got "${envelope.error.code}": ${envelope.error.message}`
    );
    error.envelope = envelope;
    throw error;
  }
  return envelope.error;
}

export function expectLog(envelope, predicate) {
  const found = (envelope.logs ?? []).find((log) => {
    if (typeof predicate === "string") return log.message.includes(predicate);
    if (predicate instanceof RegExp) return predicate.test(log.message);
    if (typeof predicate === "function") return predicate(log);
    return false;
  });
  if (!found) {
    const error = new Error(`No log entry matched ${String(predicate)}.`);
    error.envelope = envelope;
    throw error;
  }
  return found;
}

// collectStream: drain an async iterable into an array. Useful for asserting
// the full event sequence of a streaming invocation.
export async function collectStream(stream) {
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

// Stub action with controllable behavior — useful to simulate dependencies
// inside middleware tests.
export function stubAction(name, options = {}) {
  return {
    name,
    description: options.description ?? `Stub action ${name}.`,
    input: options.input,
    output: options.output,
    visibility: options.visibility ?? "public",
    sideEffects: options.sideEffects ?? "read",
    idempotency: options.idempotency ?? "unspecified",
    permissions: options.permissions ?? [],
    supportedSurfaces: options.supportedSurfaces ?? ["cli", "json", "http", "mcp", "react", "dev", "ai-sdk"],
    requiresConfirmation: Boolean(options.requiresConfirmation),
    metadata: options.metadata ?? {},
    publicMetadata: options.publicMetadata ?? {},
    docs: options.docs ?? {},
    deprecated: false,
    retry: { retries: 0, delayMs: 0 },
    concurrency: { max: 0 },
    title: name,
    version: "0.0.0-test",
    run: options.run ?? (() => options.returns ?? { ok: true }),
  };
}
