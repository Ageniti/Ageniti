import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultAppModuleCandidates = [
  "src/ageniti/app.js",
  "src/ageniti/app.mjs",
  "src/ageniti/app.cjs",
  "ageniti/app.js",
  "ageniti/app.mjs",
  "ageniti/app.cjs",
];

const tsOnlyAppModuleCandidates = [
  "src/ageniti/app.ts",
  "src/ageniti/app.mts",
  "src/ageniti/app.cts",
  "ageniti/app.ts",
  "ageniti/app.mts",
  "ageniti/app.cts",
];

const uiEntrypointCandidates = [
  "App.tsx",
  "App.jsx",
  "src/app/page.tsx",
  "src/app/layout.tsx",
  "app/page.tsx",
  "app/layout.tsx",
];

const configCandidates = [
  "ageniti.config.json",
  "ageniti.config.js",
  "ageniti.config.mjs",
  "ageniti.config.cjs",
];

export const initTemplates = ["react", "expo", "next", "host-openai", "host-ai-sdk", "host-mcp", "host-http"];

export async function findDefaultAppModule(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const config = options.config ?? await loadProjectConfig({ cwd });

  if (config?.build?.appModule) {
    return {
      found: true,
      modulePath: config.build.appModule,
      reason: "configured",
    };
  }

  for (const candidate of defaultAppModuleCandidates) {
    if (await fileExists(path.join(cwd, candidate))) {
      return {
        found: true,
        modulePath: `./${candidate.replaceAll(path.sep, "/")}`,
        reason: "node-safe-default",
      };
    }
  }

  for (const candidate of tsOnlyAppModuleCandidates) {
    if (await fileExists(path.join(cwd, candidate))) {
      return {
        found: false,
        modulePath: `./${candidate.replaceAll(path.sep, "/")}`,
        reason: "typescript-only-entry",
      };
    }
  }

  return {
    found: false,
    reason: "missing",
  };
}

export async function doctorProject(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const packageJson = await readPackageJson(cwd);
  const config = await loadProjectConfig({ cwd });
  const kind = detectProjectKind(packageJson);
  const defaultEntry = await findDefaultAppModule({ cwd, config });
  const checks = [];
  const recommendations = [];

  if (packageJson) {
    checks.push(check("info", "PACKAGE_JSON", `Detected package.json for "${packageJson.name ?? "unnamed-project"}".`));
  } else {
    checks.push(check("warning", "MISSING_PACKAGE_JSON", "No package.json found in the current working directory."));
  }

  checks.push(check("info", "PROJECT_KIND", `Detected project kind: ${kind}.`));

  if (config) {
    checks.push(check("info", "CONFIG_FOUND", `Loaded Ageniti config from ${config.configPath}.`));
  } else {
    checks.push(check("info", "CONFIG_MISSING", "No ageniti.config.* file found. Using built-in defaults."));
  }

  if (defaultEntry.found) {
    checks.push(check("info", "DEFAULT_APP_MODULE", `Found default Ageniti app entry at ${defaultEntry.modulePath}.`));
  } else if (defaultEntry.reason === "typescript-only-entry") {
    if (supportsTypeScriptEntrypoints({ packageJson, config })) {
      checks.push(check(
        "info",
        "TYPESCRIPT_APP_MODULE",
        `Found ${defaultEntry.modulePath}. Ageniti will use the configured TypeScript runtime for launchers.`,
      ));
    } else {
      checks.push(check(
        "warning",
        "TYPESCRIPT_ONLY_APP_MODULE",
        `Found ${defaultEntry.modulePath}, but build launchers need a Node-safe .js/.mjs/.cjs entry or TypeScript runtime support.`,
      ));
      recommendations.push("Install `tsx`, set `build.typescriptRuntime` to `tsx` in ageniti.config.json, create ./src/ageniti/app.js, or point build at compiled JavaScript with --app-module.");
    }
  } else {
    checks.push(check("warning", "MISSING_APP_MODULE", "No default Ageniti app entry was found."));
    recommendations.push("Run `ageniti init react`, `ageniti init expo`, `ageniti init next`, or a host starter such as `ageniti init host-openai`, or create ./src/ageniti/app.js manually.");
  }

  for (const candidate of uiEntrypointCandidates) {
    if (await fileExists(path.join(cwd, candidate))) {
      checks.push(check(
        "info",
        "UI_ENTRYPOINT_PRESENT",
        `Found UI entrypoint ${candidate}. Keep this separate from your headless Ageniti app module.`,
      ));
    }
  }

  if (kind === "expo") {
    recommendations.push("Keep Expo screens/components in React Native files and export a separate headless Ageniti app module under ./src/ageniti/app.js.");
  }

  if (kind === "react" || kind === "next") {
    recommendations.push("Share actions/services with your React app, but build CLI/MCP from a Node-safe headless entry instead of page/layout/component files.");
  }

  return {
    ok: checks.every((item) => item.level !== "warning"),
    kind,
    cwd,
    configPath: config?.configPath,
    defaultAppModule: defaultEntry.found ? defaultEntry.modulePath : undefined,
    typescriptRuntime: detectTypeScriptRuntime({ packageJson, config }),
    checks,
    recommendations: dedupe(recommendations),
  };
}

export async function initProject(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const template = options.template ?? "react";
  const force = options.force === true;
  if (!initTemplates.includes(template)) {
    throw new TypeError(`Unknown init template "${template}". Use ${initTemplates.map((item) => `"${item}"`).join(", ")}.`);
  }

  const files = templateFiles(template);
  const written = [];

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(cwd, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });

    if (!force && await fileExists(absolutePath)) {
      throw new TypeError(`Refusing to overwrite existing file ${relativePath}. Re-run with --force to replace scaffold files.`);
    }

    await writeFile(absolutePath, contents);
    written.push(absolutePath);
  }

  return {
    ok: true,
    template,
    cwd,
    files: written,
    appModule: "./src/ageniti/app.js",
    nextSteps: initNextSteps(template),
  };
}

async function readPackageJson(cwd) {
  const packageJsonPath = path.join(cwd, "package.json");
  if (!await fileExists(packageJsonPath)) {
    return undefined;
  }

  return JSON.parse(await readFile(packageJsonPath, "utf8"));
}

export async function loadProjectConfig(options = {}) {
  const cwd = options.cwd ?? process.cwd();

  for (const candidate of configCandidates) {
    const absolutePath = path.join(cwd, candidate);
    if (!await fileExists(absolutePath)) {
      continue;
    }

    const loaded = await loadConfigFile(absolutePath);
    return {
      ...loaded,
      configPath: absolutePath,
    };
  }

  return undefined;
}

function detectProjectKind(packageJson) {
  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };

  if (dependencies.expo || dependencies["react-native"]) {
    return "expo";
  }

  if (dependencies.next) {
    return "next";
  }

  if (dependencies.react) {
    return "react";
  }

  return "node";
}

function templateFiles(template) {
  if (template.startsWith("host-")) {
    return hostTemplateFiles(template);
  }

  const intro = template === "expo"
    ? "This project uses Expo/React Native UI plus a separate headless Ageniti entry for CLI and MCP builds."
    : template === "next"
      ? "This project uses Next.js UI routes plus a separate headless Ageniti entry for CLI and MCP builds."
      : "This project uses React UI plus a separate headless Ageniti entry for CLI and MCP builds.";

  return {
    "ageniti.config.json": `${JSON.stringify({
      build: {
        appModule: "./src/ageniti/app.js",
        appExport: "app",
        outDir: "./dist/ageniti",
        includePackageJson: true,
      },
      mcp: {
        transport: "stdio",
      },
    }, null, 2)}
`,
    "src/ageniti/actions/ping.js": `import { defineAction, s } from "@ageniti/core";

export const ping = defineAction({
  name: "ping",
  description: "Return a quick health check from the shared app layer.",
  input: s.object({
    name: s.string().default("world"),
  }),
  output: s.object({
    message: s.string(),
  }),
  async run(input, ctx) {
    ctx.logger.info("Running ping action.", input);
    return {
      message: await ctx.services.ping.reply(input.name),
    };
  },
});
`,
    "src/ageniti/services/ping-service.js": `export const pingService = {
  async reply(name) {
    return \`hello, \${name}\`;
  },
};
`,
    "src/ageniti/app.js": `import { createAgenitiApp } from "@ageniti/core";
import { ping } from "./actions/ping.js";
import { pingService } from "./services/ping-service.js";

export const app = createAgenitiApp({
  name: "my-app",
  attribution: {
    text: "Powered by Ageniti",
    vendor: "Ageniti",
    product: "Ageniti Core",
    url: "https://ageniti.dev",
  },
  actions: [ping],
  services: {
    ping: pingService,
  },
});
`,
    "src/ageniti/README.md": `# Ageniti Entry

${intro}

Keep this folder Node-safe:

- share business actions and services with your UI
- do not import React components, Expo screens, page.tsx, or layout.tsx here
- build CLI and MCP artifacts from \`src/ageniti/app.js\`

Recommended commands:

\`\`\`text
ageniti build
ageniti package
ageniti build bundle --out-dir ./dist/ageniti
ageniti doctor
\`\`\`
`,
  };
}

function initNextSteps(template) {
  if (template.startsWith("host-")) {
    return hostTemplateNextSteps(template);
  }

  const first = "Move shared business logic into src/ageniti/actions and src/ageniti/services.";
  const second = "Export your headless app from src/ageniti/app.js and keep UI-only imports out of that module.";
  const third = template === "expo"
    ? "From your Expo app, call shared actions/services from screens, then run `ageniti build` to create CLI/MCP artifacts."
    : template === "next"
      ? "Keep Next.js pages and layouts separate, share actions/services, then run `ageniti build` to create CLI/MCP artifacts."
    : "From your React app, call shared actions/services from components, then run `ageniti build` to create CLI/MCP artifacts.";

  return [first, second, third];
}

function hostTemplateFiles(template) {
  const appFile = `import { createAgenitiApp, defineAction, s } from "@ageniti/core";

const searchTasks = defineAction({
  name: "search_tasks",
  description: "Search workspace tasks by keyword and status.",
  visibility: "public",
  sideEffects: "read",
  input: s.object({
    keyword: s.string().optional().describe("Keyword to search in task title"),
    status: s.enum(["open", "blocked", "done"]).optional().describe("Task status filter"),
  }),
  output: s.object({
    tasks: s.array(s.object({
      id: s.string(),
      title: s.string(),
      status: s.string(),
      owner: s.string().nullable(),
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
  permissions: ["task:create"],
  input: s.object({
    title: s.string().min(1).describe("Task title"),
    priority: s.enum(["low", "normal", "high"]).default("normal"),
  }),
  output: s.object({
    taskId: s.string(),
    title: s.string(),
    status: s.string(),
    priority: s.string(),
  }),
  async run(input, ctx) {
    ctx.logger.info("Creating task.", input);
    return ctx.services.tasks.create(input);
  },
});

export const app = createAgenitiApp({
  name: "task-app",
  description: "Workspace task operations exposed to external hosts.",
  attribution: {
    text: "Powered by Ageniti",
    vendor: "Ageniti",
    product: "Ageniti Core",
    url: "https://ageniti.dev",
    docsUrl: "https://ageniti.dev/docs",
  },
  docs: {
    summary: "Use this app when a host needs task search and creation tools.",
  },
  actions: [searchTasks, createTask],
  services: createServices(),
  permissionChecker({ action, context }) {
    if (action.permissions.length === 0) {
      return true;
    }

    const granted = context.auth?.permissions ?? [];
    const missing = action.permissions.filter((permission) => !granted.includes(permission));
    return missing.length === 0 || \`Missing permissions: \${missing.join(", ")}\`;
  },
});

function createServices() {
  const tasks = [
    { id: "task_001", title: "Follow up with design review", status: "open", owner: "maya" },
    { id: "task_002", title: "Prepare release notes", status: "blocked", owner: "jo" },
    { id: "task_003", title: "Archive onboarding checklist", status: "done", owner: null },
  ];

  return {
    tasks: {
      async search({ keyword, status }) {
        return tasks
          .filter((task) => !status || task.status === status)
          .filter((task) => !keyword || \`\${task.id} \${task.title}\`.toLowerCase().includes(keyword.toLowerCase()));
      },
      async create(input) {
        const taskId = \`task_\${String(tasks.length + 1).padStart(3, "0")}\`;
        const task = {
          taskId,
          title: input.title,
          status: "open",
          priority: input.priority,
        };
        tasks.push({
          id: taskId,
          title: task.title,
          status: task.status,
          owner: null,
        });
        return task;
      },
    },
  };
}
`;

  const readmeByTemplate = {
    "host-openai": `# OpenAI Responses Host Starter

This scaffold is for applications that already call the OpenAI Responses API and need a stable tool set generated from Ageniti actions.

Files:

- \`src/ageniti/app.js\`: shared task app definition
- \`src/ageniti/host-openai.js\`: request factory for OpenAI Responses
`,
    "host-ai-sdk": `# AI SDK Host Starter

This scaffold is for applications that already use the AI SDK and need executable tools backed by the Ageniti runtime.

Files:

- \`src/ageniti/app.js\`: shared task app definition
- \`src/ageniti/host-ai-sdk.js\`: AI SDK tool context factory
`,
    "host-mcp": `# MCP Host Starter

This scaffold is for applications or local tooling that need an MCP-compatible handler generated from Ageniti actions.

Files:

- \`src/ageniti/app.js\`: shared task app definition
- \`src/ageniti/host-mcp.js\`: in-process MCP handler demo
`,
    "host-http": `# HTTP Gateway Starter

This scaffold is for applications that want to keep transport and auth in their own backend while delegating action execution to Ageniti.

Files:

- \`src/ageniti/app.js\`: shared task app definition
- \`src/ageniti/host-http.js\`: HTTP handler demo
`,
  };

  const hostFilesByTemplate = {
    "host-openai": `import { app } from "./app.js";

export function createResponsesRequest({ input, model = "your-model" }) {
  return {
    model,
    input,
    tools: app.createOpenAIResponsesTools(),
  };
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  console.log(JSON.stringify(createResponsesRequest({
    input: "Find the blocked tasks and summarize the owners.",
  }), null, 2));
}
`,
    "host-ai-sdk": `import { app } from "./app.js";

export function createAISDKContext({ model, auth }) {
  return {
    model,
    tools: app.createAISDKTools({ returnEnvelope: true }),
    toolContext: { auth },
  };
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const context = createAISDKContext({
    model: "your-model-instance",
    auth: { permissions: ["task:create"] },
  });

  const result = await context.tools.create_task.execute({
    title: "Follow up with the design review owner",
    priority: "high",
  }, {
    auth: context.toolContext.auth,
  });

  console.log(JSON.stringify(result, null, 2));
}
`,
    "host-mcp": `import { app } from "./app.js";

const handle = app.createMcpHandler();

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const list = await handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });

  const call = await handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "search_tasks",
      arguments: { status: "blocked" },
    },
  });

  console.log(JSON.stringify({ list, call }, null, 2));
}
`,
    "host-http": `import { app } from "./app.js";

const handle = app.createHttpHandler();

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const actions = await handle({
    method: "GET",
    url: "/ageniti/actions",
  });

  const invoke = await handle({
    method: "POST",
    url: "/ageniti/actions/create_task/invoke",
    auth: {
      permissions: ["task:create"],
    },
    body: {
      input: {
        title: "Write the release review summary",
        priority: "high",
      },
    },
  });

  console.log(JSON.stringify({ actions, invoke }, null, 2));
}
`,
  };

  return {
    "ageniti.config.json": `${JSON.stringify({
      build: {
        appModule: "./src/ageniti/app.js",
        appExport: "app",
        outDir: "./dist/ageniti",
        includePackageJson: true,
      },
      mcp: {
        transport: "stdio",
      },
    }, null, 2)}
`,
    "src/ageniti/app.js": appFile,
    [`src/ageniti/${template}.js`]: hostFilesByTemplate[template],
    "src/ageniti/README.md": readmeByTemplate[template],
  };
}

function hostTemplateNextSteps(template) {
  const first = "Review src/ageniti/app.js and replace the sample task service with your real product capability.";
  const second = `Run node ./src/ageniti/${template}.js to verify the host starter behaves as expected.`;
  const third = "Once the contract looks right, export docs/manifests and package your CLI or MCP bundle for downstream hosts.";
  return [first, second, third];
}

function check(level, code, message) {
  return { level, code, message };
}

function dedupe(values) {
  return [...new Set(values)];
}

export function detectTypeScriptRuntime({ packageJson, config } = {}) {
  const configured = config?.build?.typescriptRuntime;
  if (configured) {
    return configured;
  }

  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };

  if (dependencies.tsx) {
    return "tsx";
  }

  return undefined;
}

export function supportsTypeScriptEntrypoints({ packageJson, config } = {}) {
  return detectTypeScriptRuntime({ packageJson, config }) === "tsx";
}

async function loadConfigFile(absolutePath) {
  if (absolutePath.endsWith(".json")) {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  }

  const imported = await import(pathToFileURL(absolutePath).href);
  return imported.default ?? imported.config ?? imported;
}

async function fileExists(filePath) {
  try {
    const details = await stat(filePath);
    return details.isFile();
  } catch {
    return false;
  }
}
