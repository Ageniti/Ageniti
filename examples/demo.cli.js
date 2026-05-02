#!/usr/bin/env node
import { AgenitiError, createAgenitiApp, defineAction, s } from "../src/index.js";

const searchTasks = defineAction({
  name: "search_tasks",
  title: "Search Tasks",
  description: "Search workspace tasks by keyword and status.",
  visibility: "public",
  sideEffects: "read",
  idempotency: "idempotent",
  input: s.object({
    keyword: s.string().optional().describe("Keyword to search in task title"),
    status: s.enum(["open", "blocked", "done"]).optional().describe("Task status filter"),
    limit: s.number().int().min(1).max(50).default(10).describe("Maximum number of tasks to return"),
  }),
  output: s.object({
    tasks: s.array(s.object({
      id: s.string(),
      title: s.string(),
      status: s.string(),
      priority: s.string(),
    })),
  }),
  async run(input, ctx) {
    ctx.logger.info("Searching tasks.", input);
    const tasks = await ctx.services.tasks.search(input);
    return { tasks };
  },
});

const createTask = defineAction({
  name: "create_task",
  title: "Create Task",
  description: "Create a workspace task.",
  visibility: "public",
  sideEffects: "write",
  idempotency: "conditional",
  permissions: ["task:create"],
  input: s.object({
    title: s.string().min(1).describe("Task title"),
    assignee: s.string().optional().describe("Optional assignee id"),
    priority: s.enum(["low", "normal", "high"]).default("normal").describe("Task priority"),
    idempotencyKey: s.string().optional().describe("Optional key used to avoid duplicate tasks"),
  }),
  output: s.object({
    taskId: s.string(),
    title: s.string(),
    status: s.string(),
    priority: s.string(),
  }),
  async run(input, ctx) {
    ctx.logger.info("Creating task.", {
      title: input.title,
      priority: input.priority,
    });
    return ctx.services.tasks.create(input);
  },
});

const deleteTask = defineAction({
  name: "delete_task",
  title: "Delete Task",
  description: "Delete a task. Requires explicit confirmation.",
  visibility: "local",
  sideEffects: "destructive",
  idempotency: "conditional",
  requiresConfirmation: true,
  permissions: ["task:delete"],
  input: s.object({
    taskId: s.string().min(1).describe("Task id to delete"),
  }),
  output: s.object({
    deleted: s.boolean(),
    taskId: s.string(),
  }),
  async run({ taskId }, ctx) {
    ctx.logger.warn("Deleting task.", { taskId });
    return ctx.services.tasks.delete(taskId);
  },
});

const app = createAgenitiApp({
  name: "ageniti-demo",
  actions: [searchTasks, createTask, deleteTask],
  services: createServices(),
  permissionChecker({ action, context }) {
    if (action.permissions.length === 0) {
      return true;
    }

    const granted = context.auth?.permissions ?? ["task:create"];
    const missing = action.permissions.filter((permission) => !granted.includes(permission));
    return missing.length === 0 || `Missing permissions: ${missing.join(", ")}`;
  },
  middleware: [
    async ({ action, context, next }) => {
      context.logger.debug("Middleware before action.", { action: action.name });
      try {
        return await next();
      } catch (error) {
        if (error?.code) {
          throw error;
        }

        throw new AgenitiError("INTERNAL_ERROR", error instanceof Error ? error.message : "Unknown action error.");
      }
    },
  ],
});

await app.createCli().main();

function createServices() {
  const tasks = new Map();

  return {
    tasks: {
      async search({ keyword, status, limit }) {
        const sampleTasks = [
          { id: "task_001", title: "Follow up with design review", status: "open", priority: "high" },
          { id: "task_002", title: "Prepare release notes", status: "blocked", priority: "normal" },
          { id: "task_003", title: "Archive onboarding checklist", status: "done", priority: "low" },
        ];

        return sampleTasks
          .filter((task) => !status || task.status === status)
          .filter((task) => !keyword || `${task.id} ${task.title}`.toLowerCase().includes(keyword.toLowerCase()))
          .slice(0, limit);
      },
      async create(input) {
        const taskId = input.idempotencyKey ? `task_${input.idempotencyKey}` : `task_${String(tasks.size + 1).padStart(3, "0")}`;
        const task = {
          taskId,
          title: input.title,
          status: "open",
          priority: input.priority,
        };
        tasks.set(taskId, task);
        return task;
      },
      async delete(taskId) {
        return {
          deleted: tasks.delete(taskId),
          taskId,
        };
      },
    },
  };
}
