// React hooks for Ageniti. Imported separately from `./react.js` so that
// projects without React installed don't break when they import the main
// `@ageniti/core` entrypoint.
//
// Usage:
//   import { useAction } from "@ageniti/core/react-hooks";
//   const { invoke, status, data, logs } = useAction(myAction, { runtime });

import * as React from "react";
import { initialActionState, reduceActionEvent } from "./runtime/action-state.js";

// useAction(action, { runtime })
//
// State machine:
//   idle  ── invoke ──▶ loading ──▶ success
//                                 ╲▶ error
//                                 ╲▶ cancelled
//
// While loading, logs/artifacts/progress update live as the runtime emits
// streaming events. Call cancel() to abort the in-flight invocation, or
// reset() to wipe state back to idle.
//
// This hook is intentionally thin: all state-transition logic lives in the
// framework-agnostic reducer in ./runtime/action-state.js (which is unit
// tested without React). The hook only wires runtime.stream() events into
// React state and manages React lifecycle concerns (mount, invocation race).
export function useAction(action, options = {}) {
  const { useState, useRef, useCallback, useEffect } = React;

  const runtime = options.runtime;
  if (!runtime) {
    throw new Error("useAction(): pass { runtime }.");
  }

  const [state, setState] = useState(initialActionState);

  const controllerRef = useRef(null);
  const externalAbortCleanupRef = useRef(null);
  const mountedRef = useRef(true);
  const invocationRef = useRef(0);

  const cleanupExternalAbort = useCallback(() => {
    externalAbortCleanupRef.current?.();
    externalAbortCleanupRef.current = null;
  }, []);

  const clearInFlight = useCallback((options = {}) => {
    cleanupExternalAbort();
    if (options.abort !== false) {
      controllerRef.current?.abort();
    }
    if (options.clearController === true) {
      controllerRef.current = null;
    }
  }, [cleanupExternalAbort]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearInFlight({ clearController: true });
    };
  }, [clearInFlight]);

  const safeSet = useCallback((updater, invocationId) => {
    if (!mountedRef.current) return;
    if (invocationId !== undefined && invocationRef.current !== invocationId) return;
    setState((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  const cancel = useCallback(() => {
    const invocationId = invocationRef.current;
    clearInFlight();
    safeSet((prev) => reduceActionEvent(prev, { type: "cancel" }), invocationId);
  }, [clearInFlight, safeSet]);

  const reset = useCallback(() => {
    clearInFlight({ clearController: true });
    invocationRef.current += 1;
    safeSet(initialActionState());
  }, [clearInFlight, safeSet]);

  const invoke = useCallback(async (input, callOptions = {}) => {
    clearInFlight();
    const controller = new AbortController();
    const invocationId = invocationRef.current + 1;
    invocationRef.current = invocationId;
    controllerRef.current = controller;

    if (callOptions.signal) {
      if (callOptions.signal.aborted) {
        controller.abort();
      } else {
        const forwardAbort = () => controller.abort();
        callOptions.signal.addEventListener("abort", forwardAbort, { once: true });
        externalAbortCleanupRef.current = () => {
          callOptions.signal.removeEventListener("abort", forwardAbort);
        };
      }
    } else {
      externalAbortCleanupRef.current = null;
    }

    safeSet((prev) => reduceActionEvent(prev, { type: "start" }), invocationId);

    const events = runtime.stream(action, input, {
      surface: callOptions.surface ?? "react",
      env: callOptions.env,
      confirm: callOptions.confirm,
      idempotencyKey: callOptions.idempotencyKey,
      timeoutMs: callOptions.timeoutMs,
      signal: controller.signal,
      user: callOptions.user,
      auth: callOptions.auth,
      metadata: callOptions.metadata,
    });

    let envelope;
    const makeCancelledEnvelope = () => ({
      ok: false,
      error: {
        code: "CANCELLED",
        message: "Invocation was cancelled.",
        issues: [],
        retryable: false,
      },
      artifacts: [],
      logs: [],
      meta: {
        action: typeof action === "string" ? action : action?.name,
        invocationId: `react-${invocationId}`,
        surface: callOptions.surface ?? "react",
        durationMs: 0,
      },
    });
    try {
      for await (const event of events) {
        if (invocationRef.current !== invocationId) {
          await events.return?.();
          envelope = makeCancelledEnvelope();
          break;
        }
        if (event.type === "result") {
          envelope = event.envelope;
        }
        // All state-transition logic lives in the framework-agnostic reducer.
        // For unhandled event types it returns the same state reference, so
        // React bails out of the re-render.
        safeSet((prev) => reduceActionEvent(prev, event), invocationId);
      }
    } finally {
      cleanupExternalAbort();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }

    return envelope ?? makeCancelledEnvelope();
  }, [action, cleanupExternalAbort, clearInFlight, runtime, safeSet]);

  return { ...state, invoke, cancel, reset };
}
