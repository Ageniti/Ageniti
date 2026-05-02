import { createRuntime } from "./core.js";

export function createJsonRunner(options) {
  const actions = options.actions ?? [];
  const runtime = options.runtime ?? createRuntime({ actions, ...options.runtimeOptions });

  return {
    runtime,
    async invoke(payload) {
      if (!payload || typeof payload !== "object") {
        return {
          ok: false,
          error: {
            code: "INVALID_JSON_RUNNER_PAYLOAD",
            message: "JSON runner payload must be an object.",
            issues: [],
            retryable: false,
          },
          artifacts: [],
          logs: [],
          meta: {
            surface: "json",
            durationMs: 0,
          },
        };
      }

      return runtime.invoke(payload.action, payload.input ?? {}, {
        surface: "json",
        confirm: payload.confirm,
        user: payload.user,
        auth: payload.auth,
        metadata: payload.metadata,
      });
    },
  };
}
