import { createRuntime } from "./core.js";

export function createReactActionAdapter(options = {}) {
  const runtime = options.runtime ?? createRuntime({ actions: options.actions ?? [] });

  function useAction(action) {
    return async function runAction(input, invokeOptions = {}) {
      return runtime.invoke(action, input, {
        ...invokeOptions,
        surface: "react",
      });
    };
  }

  return {
    runtime,
    useAction,
  };
}
