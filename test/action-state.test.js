import assert from "node:assert/strict";
import test from "node:test";
import {
  initialActionState,
  reduceActionEvent,
  reduceResult,
} from "../src/runtime/action-state.js";

// This is the framework-agnostic state machine behind the React `useAction`
// hook. It carries all of the non-trivial transition logic (terminal-state
// resolution, the cancelled-vs-error rule), so it is the right place to test
// that behavior — no React renderer required.

test("initialActionState is idle and empty", () => {
  assert.deepEqual(initialActionState(), {
    status: "idle",
    data: null,
    error: null,
    logs: [],
    artifacts: [],
    progress: null,
  });
});

test("initialActionState returns a fresh object each call (no shared mutation)", () => {
  const a = initialActionState();
  const b = initialActionState();
  assert.notEqual(a, b);
  assert.notEqual(a.logs, b.logs);
});

test("start resets to a fresh loading state regardless of prior state", () => {
  const prev = {
    status: "error",
    data: { stale: true },
    error: { code: "BOOM" },
    logs: [{ type: "log" }],
    artifacts: [{ name: "old" }],
    progress: { percent: 90 },
  };
  const next = reduceActionEvent(prev, { type: "start" });
  assert.deepEqual(next, {
    status: "loading",
    data: null,
    error: null,
    logs: [],
    artifacts: [],
    progress: null,
  });
});

test("log appends the whole event without mutating prior state", () => {
  const prev = reduceActionEvent(initialActionState(), { type: "start" });
  const event = { type: "log", level: "info", message: "hi" };
  const next = reduceActionEvent(prev, event);
  assert.deepEqual(next.logs, [event]);
  assert.equal(prev.logs.length, 0, "prior state is not mutated");

  const event2 = { type: "log", level: "warn", message: "careful" };
  const next2 = reduceActionEvent(next, event2);
  assert.deepEqual(next2.logs, [event, event2]);
});

test("artifact appends event.artifact", () => {
  const prev = reduceActionEvent(initialActionState(), { type: "start" });
  const next = reduceActionEvent(prev, {
    type: "artifact",
    artifact: { type: "file", name: "report.txt" },
  });
  assert.deepEqual(next.artifacts, [{ type: "file", name: "report.txt" }]);
});

test("progress replaces the progress field", () => {
  const prev = reduceActionEvent(initialActionState(), { type: "start" });
  const mid = reduceActionEvent(prev, { type: "progress", percent: 25, message: "quarter" });
  assert.deepEqual(mid.progress, { percent: 25, message: "quarter" });
  const later = reduceActionEvent(mid, { type: "progress", percent: 75, message: "most" });
  assert.deepEqual(later.progress, { percent: 75, message: "most" });
});

test("result(ok) moves to success and carries data", () => {
  const prev = reduceActionEvent(initialActionState(), { type: "start" });
  const next = reduceActionEvent(prev, { type: "result", envelope: { ok: true, data: { n: 42 } } });
  assert.equal(next.status, "success");
  assert.deepEqual(next.data, { n: 42 });
  assert.equal(next.error, null);
});

test("result with a non-cancel error moves to error", () => {
  const prev = reduceActionEvent(initialActionState(), { type: "start" });
  const err = { code: "INTERNAL_ERROR", message: "boom" };
  const next = reduceActionEvent(prev, { type: "result", envelope: { ok: false, error: err } });
  assert.equal(next.status, "error");
  assert.deepEqual(next.error, err);
});

test("result with CANCELLED error moves to cancelled, not error", () => {
  const prev = reduceActionEvent(initialActionState(), { type: "start" });
  const err = { code: "CANCELLED", message: "Invocation was cancelled." };
  const next = reduceActionEvent(prev, { type: "result", envelope: { ok: false, error: err } });
  assert.equal(next.status, "cancelled");
  assert.deepEqual(next.error, err);
});

test("a residual error envelope does not downgrade an already-cancelled state", () => {
  // The user cancelled; a late non-cancel error envelope arrives during
  // teardown. The terminal state must stay "cancelled".
  const cancelled = reduceActionEvent(
    reduceActionEvent(initialActionState(), { type: "start" }),
    { type: "cancel" },
  );
  assert.equal(cancelled.status, "cancelled");

  const after = reduceActionEvent(cancelled, {
    type: "result",
    envelope: { ok: false, error: { code: "INTERNAL_ERROR" } },
  });
  assert.equal(after, cancelled, "state is returned unchanged (same reference)");
  assert.equal(after.status, "cancelled");
});

test("cancel only transitions from loading", () => {
  const idle = initialActionState();
  assert.equal(reduceActionEvent(idle, { type: "cancel" }), idle, "idle is unchanged");

  const loading = reduceActionEvent(idle, { type: "start" });
  const cancelled = reduceActionEvent(loading, { type: "cancel" });
  assert.equal(cancelled.status, "cancelled");

  const success = reduceActionEvent(loading, { type: "result", envelope: { ok: true, data: 1 } });
  assert.equal(reduceActionEvent(success, { type: "cancel" }), success, "success is unchanged");
});

test("unknown or missing event types return the same state reference", () => {
  const state = reduceActionEvent(initialActionState(), { type: "start" });
  assert.equal(reduceActionEvent(state, { type: "nope" }), state);
  assert.equal(reduceActionEvent(state, {}), state);
  assert.equal(reduceActionEvent(state, undefined), state);
});

test("reduceResult tolerates a missing error object", () => {
  const prev = reduceActionEvent(initialActionState(), { type: "start" });
  const next = reduceResult(prev, { ok: false });
  assert.equal(next.status, "error");
  assert.equal(next.error, null);
});
