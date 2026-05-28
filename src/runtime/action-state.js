// Framework-agnostic state machine for a live action invocation.
//
// This is the logic behind the React `useAction` hook, deliberately kept
// free of React (or any framework) so it can be tested with zero
// dependencies and reused by any binding layer (React, Vue, Svelte, Solid,
// a plain event emitter, ...). The framework binding is responsible only for
// driving this reducer from runtime.stream() events and pushing the returned
// state into its own reactivity system.
//
// State machine:
//   idle ── start ──▶ loading ──▶ success
//                              ╲▶ error
//                              ╲▶ cancelled

export function initialActionState() {
  return {
    status: "idle",
    data: null,
    error: null,
    logs: [],
    artifacts: [],
    progress: null,
  };
}

// Pure reducer: (state, event) -> nextState. Never mutates `state`.
//
// Recognized events:
//   { type: "start" }                       reset to a fresh loading state
//   { type: "log", ...logEvent }            append the log event to logs
//   { type: "artifact", artifact }          append artifact to artifacts
//   { type: "progress", percent, message }  replace progress
//   { type: "result", envelope }            move to a terminal status
//   { type: "cancel" }                      loading -> cancelled (else no-op)
export function reduceActionEvent(state, event) {
  switch (event?.type) {
    case "start":
      return {
        status: "loading",
        data: null,
        error: null,
        logs: [],
        artifacts: [],
        progress: null,
      };
    case "log":
      return { ...state, logs: [...state.logs, event] };
    case "artifact":
      return { ...state, artifacts: [...state.artifacts, event.artifact] };
    case "progress":
      return { ...state, progress: { percent: event.percent, message: event.message } };
    case "result":
      return reduceResult(state, event.envelope);
    case "cancel":
      return state.status === "loading" ? { ...state, status: "cancelled" } : state;
    default:
      return state;
  }
}

// Map a terminal runtime envelope onto a terminal UI state.
export function reduceResult(state, envelope) {
  if (envelope?.ok) {
    return { ...state, status: "success", data: envelope.data };
  }
  if (envelope?.error?.code === "CANCELLED") {
    // The user called cancel() or an external abort fired. Either way, the
    // terminal state is "cancelled", not "error".
    return { ...state, status: "cancelled", error: envelope.error };
  }
  // Don't downgrade an already-cancelled status to "error" if a residual
  // non-cancel envelope arrives during teardown.
  return state.status === "cancelled"
    ? state
    : { ...state, status: "error", error: envelope?.error ?? null };
}
