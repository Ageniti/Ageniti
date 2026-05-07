import { createRuntime } from "../runtime/core.js";

export function resolveRuntimeAndActions(options = {}) {
  const runtime = options.runtime ?? createRuntime({ actions: options.actions ?? [], ...options.runtimeOptions });
  const actions = options.actions ?? Array.from(runtime.registry.values());
  return { runtime, actions };
}

export function pickInvocationInput(container, fields) {
  if (!container || typeof container !== "object") {
    return {};
  }

  for (const field of fields) {
    if (field in container) {
      return container[field];
    }
  }

  return {};
}
