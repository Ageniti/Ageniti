// React hooks for Ageniti. Imported separately from `./react.js` so that
// projects without React installed don't break when they import the main
// `@ageniti/core` entrypoint.
//
// Usage:
//   import { useAction } from "@ageniti/core/react-hooks";
//   const { invoke, status, data, logs } = useAction(myAction, { runtime });

import * as React from "react";

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
export function useAction(action, options = {}) {
  const { useState, useRef, useCallback, useEffect } = React;

  const runtime = options.runtime;
  if (!runtime) {
    throw new Error("useAction(): pass { runtime }.");
  }

  const [state, setState] = useState({
    status: "idle",
    data: null,
    error: null,
    logs: [],
    artifacts: [],
    progress: null,
  });

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
    safeSet((prev) => (prev.status === "loading" ? { ...prev, status: "cancelled" } : prev), invocationId);
  }, [clearInFlight, safeSet]);

  const reset = useCallback(() => {
    clearInFlight({ clearController: true });
    invocationRef.current += 1;
    safeSet({ status: "idle", data: null, error: null, logs: [], artifacts: [], progress: null });
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

    safeSet({
      status: "loading",
      data: null,
      error: null,
      logs: [],
      artifacts: [],
      progress: null,
    }, invocationId);

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
        if (event.type === "log") {
          safeSet((prev) => ({ ...prev, logs: [...prev.logs, event] }), invocationId);
        } else if (event.type === "artifact") {
          safeSet((prev) => ({ ...prev, artifacts: [...prev.artifacts, event.artifact] }), invocationId);
        } else if (event.type === "progress") {
          safeSet((prev) => ({ ...prev, progress: { percent: event.percent, message: event.message } }), invocationId);
        } else if (event.type === "result") {
          envelope = event.envelope;
          if (envelope.ok) {
            safeSet((prev) => ({ ...prev, status: "success", data: envelope.data }), invocationId);
          } else if (envelope.error?.code === "CANCELLED") {
            // Either the user called cancel() or an external abort fired.
            // Either way, the terminal state is "cancelled", not "error".
            safeSet((prev) => ({ ...prev, status: "cancelled", error: envelope.error }), invocationId);
          } else {
            // Don't downgrade an already-cancelled status to "error" if a
            // residual non-cancel envelope arrives during teardown.
            safeSet((prev) => prev.status === "cancelled"
              ? prev
              : { ...prev, status: "error", error: envelope.error }, invocationId);
          }
        }
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
