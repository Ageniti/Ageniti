import { resolveRuntimeAndActions } from "./transports/surface-utils.js";

export function createJsonRunner(options) {
  const { runtime } = resolveRuntimeAndActions(options);

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

      // Preserve `null` and other primitive root inputs — only fall back to {} when omitted.
      const rawInput = "input" in payload ? payload.input : {};
      return runtime.invoke(payload.action, rawInput, {
        surface: "json",
        confirm: payload.confirm,
        user: payload.user,
        auth: payload.auth,
        metadata: payload.metadata,
      });
    },
  };
}
