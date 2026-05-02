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
    recommendations.push("Run `ageniti init react`, `ageniti init expo`, or `ageniti init next`, or create ./src/ageniti/app.js manually.");
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
  const first = "Move shared business logic into src/ageniti/actions and src/ageniti/services.";
  const second = "Export your headless app from src/ageniti/app.js and keep UI-only imports out of that module.";
  const third = template === "expo"
    ? "From your Expo app, call shared actions/services from screens, then run `ageniti build` to create CLI/MCP artifacts."
    : template === "next"
      ? "Keep Next.js pages and layouts separate, share actions/services, then run `ageniti build` to create CLI/MCP artifacts."
    : "From your React app, call shared actions/services from components, then run `ageniti build` to create CLI/MCP artifacts.";

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
