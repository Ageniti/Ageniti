// Bulk-register a record of plain handler functions as actions.
// Use this to expose existing app functions (Server Actions, tRPC procedures,
// any handler record) without rewriting them.
//
// Run with: node examples/bulk-handlers.js

import {
  actionsFromHandlers,
  createRuntime,
  defineActions,
  s,
} from "../src/index.js";

// Pretend these are your existing app handlers.
const handlers = {
  createTask: async ({ title }) => ({ id: `t-${Date.now()}`, title }),
  searchTasks: ({ query }) => ({ results: [`${query} #1`, `${query} #2`] }),
  deleteTask: async ({ id }) => ({ deleted: id }),
};

// 1. actionsFromHandlers — pair existing functions with metadata.
const actionsA = actionsFromHandlers(handlers, {
  createTask: {
    description: "Create a task.",
    input: s.object({ title: s.string().min(1) }),
    sideEffects: "write",
  },
  searchTasks: {
    description: "Search tasks.",
    input: s.object({ query: s.string() }),
  },
  deleteTask: {
    description: "Delete a task by ID.",
    input: s.object({ id: s.string() }),
    sideEffects: "destructive",
    permissions: ["task:delete"],
  },
});

console.log(
  "actionsFromHandlers →",
  actionsA.map((a) => `${a.name} (${a.sideEffects})`),
);

// 2. defineActions — full control, including inline run functions.
const actionsB = defineActions({
  ping: () => ({ ok: true, time: Date.now() }),
  echo: {
    description: "Echo input back.",
    input: s.object({ value: s.string() }),
    run: ({ value }) => ({ value }),
  },
}, {
  defaults: { visibility: "public" },
});

console.log(
  "defineActions →",
  actionsB.map((a) => a.name),
);

// 3. Run them.
const runtime = createRuntime({ actions: [...actionsA, ...actionsB] });
const created = await runtime.invoke("create_task", { title: "Ship v1" }, { surface: "json" });
console.log("create_task →", created.data);

const echoed = await runtime.invoke("echo", { value: "hi" }, { surface: "json" });
console.log("echo →", echoed.data);

// 4. Destructive action requires confirm: true on cli/json/mcp/http surfaces.
const denied = await runtime.invoke("delete_task", { id: "t1" }, { surface: "json" });
console.log("delete_task without confirm →", denied.error?.code);

const allowed = await runtime.invoke("delete_task", { id: "t1" }, { surface: "json", confirm: true });
console.log("delete_task with confirm →", allowed.data);
