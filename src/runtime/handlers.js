// Bulk-registration helpers for app code that already has functions you want
// to expose. Each helper is intentionally thin — we don't try to read or
// rewrite the underlying function. Users keep their handlers; we wrap them.

import { defineAction } from "./core.js";

const camelToSnake = (name) => name
  .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
  .replace(/[-\s]+/g, "_")
  .toLowerCase();

// Wrap any (input, ctx?) => result function into an action. The handler
// signature is preserved — `ctx` is optional so existing 1-arg functions
// (Server Actions, tRPC procedures, plain handlers) keep working.
export function actionFromHandler(handler, config) {
  if (typeof handler !== "function") {
    throw new TypeError("actionFromHandler() requires a function as the first argument.");
  }
  if (!config?.name) {
    throw new TypeError("actionFromHandler() requires { name } in config.");
  }
  return defineAction({
    ...config,
    run: handler.length >= 2
      ? (input, ctx) => handler(input, ctx)
      : (input) => handler(input),
  });
}

// Register a record of named actions in one call. Keys can be camelCase or
// snake_case; they're normalized to snake_case for the action name (since
// MCP / CLI conventions prefer snake_case).
//
// defineActions({
//   createTask: { description, input, run },
//   searchTasks: { description, input, output, run },
// })
//
// You can also pass a function as the value when no extra config is needed:
//   defineActions({
//     ping: () => ({ pong: true }),
//   }, {
//     defaults: { description: "..." },
//   })
export function defineActions(map, options = {}) {
  if (!map || typeof map !== "object") {
    throw new TypeError("defineActions() requires a record of action configs.");
  }

  const defaults = options.defaults ?? {};
  const renameStrategy = options.rename ?? camelToSnake;
  const actions = [];

  for (const [key, value] of Object.entries(map)) {
    const name = value?.name ?? renameStrategy(key);
    if (typeof value === "function") {
      actions.push(defineAction({
        ...defaults,
        name,
        description: defaults.description ?? `Action ${key}.`,
        run: value.length >= 2 ? value : (input) => value(input),
      }));
      continue;
    }

    if (!value || typeof value !== "object") {
      throw new TypeError(`defineActions(): entry "${key}" must be a function or config object.`);
    }

    const config = { ...defaults, ...value, name };
    if (typeof config.run !== "function") {
      throw new TypeError(`defineActions(): entry "${key}" requires a run function.`);
    }
    const handler = config.run;
    config.run = handler.length >= 2 ? handler : (input) => handler(input);

    actions.push(defineAction(config));
  }

  return actions;
}

// Helper for users who already have a record of plain handlers (e.g.,
// Next.js Server Actions in `app/actions/index.ts`). Pair them with metadata.
//
//   actionsFromHandlers(
//     { createTask, searchTasks },
//     {
//       createTask: { description: "...", input: zCreateTask, sideEffects: "write" },
//       searchTasks: { description: "...", input: zSearch },
//     },
//   )
export function actionsFromHandlers(handlers, metadata = {}) {
  if (!handlers || typeof handlers !== "object") {
    throw new TypeError("actionsFromHandlers() requires a handler record.");
  }

  const map = {};
  for (const [key, fn] of Object.entries(handlers)) {
    if (typeof fn !== "function") continue;
    const meta = metadata[key] ?? {};
    map[key] = { ...meta, run: fn };
  }
  return defineActions(map);
}
