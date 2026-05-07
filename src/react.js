// Headless React-friendly bindings. This file deliberately does NOT import
// React, so it can be loaded in projects that don't have React installed
// (e.g., a CLI-only consumer of @ageniti/core that still imports the main
// index). For the stateful hook with live streaming, use the dedicated
// `@ageniti/core/react-hooks` subpath, which has React as a peer dep.

import { createRuntime } from "./runtime/core.js";

export function createReactActionAdapter(options = {}) {
  const runtime = options.runtime ?? createRuntime({ actions: options.actions ?? [] });

  return {
    runtime,
    useAction(action) {
      return (input, invokeOptions = {}) => runtime.invoke(action, input, {
        ...invokeOptions,
        surface: "react",
      });
    },
  };
}

// Headless invoker — returns Promise<envelope>. Use this when you don't need
// streaming state (e.g., inside a Server Component or one-shot useEffect).
export function makeInvoker(action, options = {}) {
  const runtime = options.runtime ?? createRuntime({ actions: options.actions ?? [action] });
  return (input, callOptions = {}) => runtime.invoke(action, input, {
    surface: callOptions.surface ?? "react",
    ...callOptions,
  });
}

// Convenience: drain a streaming invocation as an async iterable. Pure JS,
// no React dependency. Useful inside RSC or non-React code paths.
export async function* streamAction(runtime, action, input, options = {}) {
  yield* runtime.stream(action, input, { surface: "react", ...options });
}
