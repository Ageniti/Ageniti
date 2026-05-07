import { createAgenitiApp, defineAction, s } from "../src/index.js";

const searchTasks = defineAction({
  name: "search_tasks",
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
      assignee: s.string().nullable(),
    })),
  }),
  async run(input, ctx) {
    ctx.logger.info("Searching tasks.", input);
    return {
      tasks: await ctx.services.tasks.search(input),
    };
  },
});

const createTask = defineAction({
  name: "create_task",
  description: "Create a workspace task.",
  visibility: "public",
  sideEffects: "write",
  idempotency: "conditional",
  permissions: ["task:create"],
  input: s.object({
    title: s.string().min(1).describe("Task title"),
    assignee: s.string().optional().describe("Optional assignee id"),
    priority: s.enum(["low", "normal", "high"]).default("normal").describe("Task priority"),
  }),
  output: s.object({
    taskId: s.string(),
    title: s.string(),
    status: s.string(),
    priority: s.string(),
    assignee: s.string().nullable(),
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
  description: "Delete a task by id.",
  visibility: "local",
  sideEffects: "destructive",
  idempotency: "conditional",
  requiresConfirmation: true,
  permissions: ["task:delete"],
  supportedSurfaces: ["cli", "http", "react", "dev"],
  input: s.object({
    taskId: s.string().min(1).describe("Task id to delete"),
  }),
  output: s.object({
    deleted: s.boolean(),
    taskId: s.string(),
  }),
  async run({ taskId }, ctx) {
    ctx.logger.warn("Deleting task.", { taskId });
    return ctx.services.tasks.remove(taskId);
  },
});

export function createTaskApp() {
  return createAgenitiApp({
    name: "task-app",
    description: "Workspace task operations exposed to external hosts and agent callers.",
    docs: {
      summary: "Use this app when a host needs task search and creation tools.",
      audience: "Agent hosts, automation scripts, and internal operator tools.",
    },
    actions: [searchTasks, createTask, deleteTask],
    services: createTaskServices(),
    permissionChecker({ action, context }) {
      if (action.permissions.length === 0) {
        return true;
      }

      const granted = context.auth?.permissions ?? [];
      const missing = action.permissions.filter((permission) => !granted.includes(permission));
      return missing.length === 0 || `Missing permissions: ${missing.join(", ")}`;
    },
  });
}

function createTaskServices() {
  const tasks = [
    { id: "task_001", title: "Follow up with design review", status: "open", priority: "high", assignee: "maya" },
    { id: "task_002", title: "Prepare release notes", status: "blocked", priority: "normal", assignee: "jo" },
    { id: "task_003", title: "Archive onboarding checklist", status: "done", priority: "low", assignee: null },
  ];

  return {
    tasks: {
      async search({ keyword, status, limit }) {
        return tasks
          .filter((task) => !status || task.status === status)
          .filter((task) => !keyword || `${task.id} ${task.title}`.toLowerCase().includes(keyword.toLowerCase()))
          .slice(0, limit);
      },
      async create(input) {
        const taskId = `task_${String(tasks.length + 1).padStart(3, "0")}`;
        const task = {
          taskId,
          title: input.title,
          status: "open",
          priority: input.priority,
          assignee: input.assignee ?? null,
        };
        tasks.push({
          id: taskId,
          title: task.title,
          status: task.status,
          priority: task.priority,
          assignee: task.assignee,
        });
        return task;
      },
      async remove(taskId) {
        const index = tasks.findIndex((task) => task.id === taskId);
        if (index >= 0) {
          tasks.splice(index, 1);
          return { deleted: true, taskId };
        }

        return { deleted: false, taskId };
      },
    },
  };
}
