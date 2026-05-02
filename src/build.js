import { execFile } from "node:child_process";
import { access, mkdir, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { exportDocs } from "./docs-export.js";
import { createActionManifest, createSurfaceManifest } from "./manifest.js";
import { detectTypeScriptRuntime, findDefaultAppModule, loadProjectConfig, supportsTypeScriptEntrypoints } from "./project-tools.js";

const DEFAULT_OUT_DIR = path.join("dist", "ageniti");
const execFileAsync = promisify(execFile);

export async function buildArtifacts(options) {
  const appName = options.appName;
  const actions = options.actions ?? [];
  const adapters = options.adapters ?? [];
  const cwd = options.cwd ?? process.cwd();
  const config = options.config ?? await loadProjectConfig({ cwd });
  const resolvedOptions = mergeConfig(options, config);
  const outDir = path.resolve(cwd, resolvedOptions.outDir ?? DEFAULT_OUT_DIR);
  const requestedTargets = normalizeTargets(resolvedOptions.targets);
  const targets = expandTargets(requestedTargets, resolvedOptions.includePackageJson);
  const files = [];

  await mkdir(outDir, { recursive: true });

  const manifestFilename = "ageniti.manifest.json";
  const manifestPath = path.join(outDir, manifestFilename);
  const manifest = createSurfaceManifest({ appName, actions, adapters });

  if (targets.has("manifest")) {
    await writeJsonFile(manifestPath, manifest);
    files.push(describeBuiltFile("manifest", manifestPath));
  }

  if (targets.has("cli") || targets.has("mcp")) {
    const launcher = await resolveLauncher(resolvedOptions, outDir, cwd, config);

    if (targets.has("cli")) {
      const cliPath = path.join(outDir, "cli.mjs");
      await writeExecutableModule(cliPath, renderCliLauncher(launcher, resolvedOptions));
      files.push(describeBuiltFile("cli", cliPath, { executable: true }));
    }

    if (targets.has("mcp")) {
      const mcpPath = path.join(outDir, "mcp-stdio.mjs");
      await writeExecutableModule(mcpPath, renderMcpLauncher(launcher, resolvedOptions));
      files.push(describeBuiltFile("mcp", mcpPath, { executable: true }));
      const descriptorPath = path.join(outDir, "ageniti.mcp.json");
      await writeJsonFile(descriptorPath, createMcpDescriptor({ appName, options: resolvedOptions }));
      files.push(describeBuiltFile("mcp-descriptor", descriptorPath));
    }
  }

  if (targets.has("docs")) {
    const docsResult = await exportDocs({
      appName,
      appDescription: resolvedOptions.appDescription,
      docs: resolvedOptions.docs,
      actions,
      cwd,
      outDir,
    });
    for (const file of docsResult.files) {
      files.push(describeBuiltFile(file.kind, file.path));
    }
  }

  if (targets.has("package-json")) {
    const packageJsonPath = path.join(outDir, "package.json");
    await writeJsonFile(packageJsonPath, createBundlePackageJson(appName, files, resolvedOptions));
    files.push(describeBuiltFile("package-json", packageJsonPath));
    const readmePath = path.join(outDir, "README.md");
    await writeFile(readmePath, renderBundleReadme({ appName, outDir, options: resolvedOptions }));
    files.push(describeBuiltFile("readme", readmePath));
  }

  const actionsFilename = "ageniti.actions.json";
  const actionsPath = path.join(outDir, actionsFilename);
  if (targets.has("bundle")) {
    await writeJsonFile(actionsPath, createActionManifest(actions));
    files.push(describeBuiltFile("actions", actionsPath));
  }

  const bundleReportPath = path.join(outDir, "ageniti.bundle.json");
  const report = {
    schemaVersion: 1,
    name: appName,
    generatedAt: new Date().toISOString(),
    outDir,
    targets: [...requestedTargets],
    source: resolvedOptions.appModule ? {
      appModule: resolvedOptions.appModule,
      appExport: resolvedOptions.appExport ?? "app",
    } : undefined,
    files: files.map((file) => ({
      kind: file.kind,
      filename: path.basename(file.path),
      relativePath: path.relative(outDir, file.path) || path.basename(file.path),
      executable: file.executable,
    })),
    commands: {
      cli: files.some((file) => file.kind === "cli") ? "node ./cli.mjs" : undefined,
      mcp: files.some((file) => file.kind === "mcp") ? "node ./mcp-stdio.mjs" : undefined,
      pack: files.some((file) => file.kind === "package-json") ? "npm pack" : undefined,
    },
  };
  await writeJsonFile(bundleReportPath, report);
  files.push(describeBuiltFile("bundle-report", bundleReportPath));

  return {
    ok: true,
    name: appName,
    outDir,
    targets: [...requestedTargets],
    files,
    report,
  };
}

export async function packageArtifacts(options) {
  const cwd = options.cwd ?? process.cwd();
  const config = options.config ?? await loadProjectConfig({ cwd });
  const mergedOptions = mergeConfig({
    ...options,
    targets: ["bundle"],
    includePackageJson: true,
  }, config);
  const build = await buildArtifacts(mergedOptions);
  const packageDir = build.outDir;
  const { stdout } = await runNpmCommand({
    cwd: packageDir,
    command: "pack",
    dryRun: options.dryRun === true,
  });
  const packageFile = options.dryRun === true
    ? undefined
    : path.join(packageDir, stdout.trim().split(/\r?\n/).at(-1));

  if (packageFile) {
    await access(packageFile, constants.F_OK);
  }

  return {
    ok: true,
    outDir: build.outDir,
    packageDir,
    packageFile,
    build,
  };
}

export async function publishArtifacts(options) {
  const packaged = await packageArtifacts({
    ...options,
    dryRun: false,
  });
  const packageDir = packaged.packageDir;
  const publishArgs = ["publish"];

  if (options.dryRun !== false) {
    publishArgs.push("--dry-run");
  }

  if (options.access) {
    publishArgs.push("--access", options.access);
  }

  if (options.tag) {
    publishArgs.push("--tag", options.tag);
  }

  if (options.registry) {
    publishArgs.push("--registry", options.registry);
  }

  const { stdout, stderr } = await runNpmCommand({
    cwd: packageDir,
    argv: publishArgs,
    dryRun: options.dryRun !== false,
  });

  return {
    ok: true,
    outDir: packaged.outDir,
    packageDir,
    packageFile: packaged.packageFile,
    published: options.dryRun === false ? "live" : "dry-run",
    stdout,
    stderr,
    build: packaged.build,
  };
}

function normalizeTargets(targets) {
  if (!targets || targets.length === 0) {
    return new Set(["bundle"]);
  }

  return new Set(targets);
}

function expandTargets(targets, includePackageJson) {
  const expanded = new Set(targets);

  if (expanded.has("bundle")) {
    expanded.add("manifest");
    expanded.add("cli");
    expanded.add("mcp");
    expanded.add("docs");
    expanded.add("package-json");
  }

  if (includePackageJson) {
    expanded.add("package-json");
  }

  return expanded;
}

async function resolveLauncher(options, outDir, cwd, config) {
  let appModule = options.appModule;
  if (!appModule) {
    const discovery = await findDefaultAppModule({ cwd, config });
    if (discovery.found) {
      appModule = discovery.modulePath;
    } else if (discovery.reason === "typescript-only-entry") {
      if (supportsTypeScriptEntrypoints({ packageJson: options.packageJson, config })) {
        appModule = discovery.modulePath;
      } else {
        throw new TypeError(
          `Found ${discovery.modulePath}, but build launchers need a Node-safe .js/.mjs/.cjs entry or TypeScript runtime support. ` +
          "Install `tsx`, set build.typescriptRuntime to `tsx` in ageniti.config.json, create ./src/ageniti/app.js, or pass --app-module pointing at compiled JavaScript.",
        );
      }
    } else {
      throw new TypeError(
        "No default Ageniti app entry was found. Create ./src/ageniti/app.js, run `ageniti init react` or `ageniti init expo`, " +
        "or pass --app-module explicitly.",
      );
    }
  }

  assertBuildEntrypointLooksNodeSafe(appModule);

  return {
    importSpecifier: await resolveImportSpecifier(appModule, outDir, cwd),
    exportName: options.appExport ?? "app",
    typescriptRuntime: detectTypeScriptRuntime({ packageJson: options.packageJson, config }),
  };
}

async function resolveImportSpecifier(appModule, outDir, cwd) {
  if (appModule.startsWith(".") || appModule.startsWith("/")) {
    const absoluteModulePath = await realpath(path.resolve(cwd, appModule));
    const absoluteOutDir = await realpath(outDir);
    let relativePath = path.relative(absoluteOutDir, absoluteModulePath).replaceAll(path.sep, "/");
    if (!relativePath.startsWith(".")) {
      relativePath = `./${relativePath}`;
    }
    return relativePath;
  }

  return appModule;
}

function renderCliLauncher(launcher, options) {
  return renderLauncher({
    launcher,
    body: `await ${launcher.exportName}.createCli().main();`,
    options,
  });
}

function renderMcpLauncher(launcher, options) {
  return renderLauncher({
    launcher,
    body: `await ${launcher.exportName}.createCli().run(["mcp", "--stdio"]);`,
    options,
  });
}

function renderLauncher({ launcher, body }) {
  const lines = ["#!/usr/bin/env node"];

  if (isTypeScriptModule(launcher.importSpecifier)) {
    if (launcher.typescriptRuntime !== "tsx") {
      throw new TypeError("TypeScript launcher generation currently requires the `tsx` runtime.");
    }

    lines.push('import { register } from "node:module";');
    lines.push('import { pathToFileURL } from "node:url";');
    lines.push('register("tsx", pathToFileURL("./"));');
    lines.push(`const { ${launcher.exportName} } = await import(${JSON.stringify(launcher.importSpecifier)});`);
  } else {
    lines.push(`import { ${launcher.exportName} } from ${JSON.stringify(launcher.importSpecifier)};`);
  }

  lines.push("");
  lines.push(body);
  lines.push("");

  return lines.join("\n");
}

function createBundlePackageJson(appName, files, options = {}) {
  const packageName = options.package?.name ?? `${toPackageName(appName)}-ageniti`;
  const version = options.package?.version ?? "0.0.0";
  const description = options.package?.description ?? `Ageniti bundle for ${appName}.`;
  const pkg = {
    name: packageName,
    version,
    description,
    private: options.package?.private ?? true,
    type: "module",
    license: options.package?.license ?? "UNLICENSED",
  };

  const bin = {};
  if (files.some((file) => file.kind === "cli")) {
    bin[options.package?.binName ?? toPackageName(appName)] = "./cli.mjs";
  }
  if (files.some((file) => file.kind === "mcp")) {
    bin[`${options.package?.binName ?? toPackageName(appName)}-mcp`] = "./mcp-stdio.mjs";
  }
  if (Object.keys(bin).length > 0) {
    pkg.bin = bin;
  }

  if (Array.isArray(options.package?.keywords) && options.package.keywords.length > 0) {
    pkg.keywords = options.package.keywords;
  }

  return pkg;
}

function toPackageName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "ageniti-app";
}

async function writeExecutableModule(filePath, contents) {
  await writeFile(filePath, contents, { mode: 0o755 });
}

async function writeJsonFile(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function describeBuiltFile(kind, filePath, options = {}) {
  return {
    kind,
    path: filePath,
    executable: options.executable === true,
  };
}

function createMcpDescriptor({ appName, options }) {
  const serverName = options.package?.mcpServerName ?? toPackageName(appName);
  const stdioConfig = {
    command: "node",
    args: ["./mcp-stdio.mjs"],
    cwd: ".",
    env: options.mcp?.env ?? {},
  };

  return {
    schemaVersion: 1,
    name: appName,
    transport: options.mcp?.transport ?? "stdio",
    command: ["node", "./mcp-stdio.mjs"],
    cwd: ".",
    env: options.mcp?.env ?? {},
    snippets: {
      stdio: stdioConfig,
      claudeDesktop: {
        mcpServers: {
          [serverName]: stdioConfig,
        },
      },
      codex: {
        mcpServers: {
          [serverName]: stdioConfig,
        },
      },
    },
  };
}

function mergeConfig(options, config) {
  const build = config?.build ?? {};
  const mcp = config?.mcp ?? {};
  const pkg = config?.package ?? {};

  return {
    ...options,
    targets: options.targets ?? build.targets,
    appDescription: options.appDescription ?? config?.description,
    docs: options.docs ?? config?.docs,
    outDir: options.outDir ?? build.outDir,
    appModule: options.appModule ?? build.appModule,
    appExport: options.appExport ?? build.appExport,
    includePackageJson: options.includePackageJson ?? build.includePackageJson,
    mcp,
    package: {
      ...pkg,
      ...options.package,
    },
  };
}

function isTypeScriptModule(importSpecifier) {
  return [".ts", ".mts", ".cts"].includes(path.extname(importSpecifier).toLowerCase());
}

function assertBuildEntrypointLooksNodeSafe(appModule) {
  if (!appModule.startsWith(".") && !appModule.startsWith("/")) {
    return;
  }

  const normalized = appModule.replaceAll("\\", "/");
  const extension = path.extname(normalized).toLowerCase();
  const basename = path.basename(normalized, extension).toLowerCase();
  const segments = normalized.toLowerCase().split("/");

  if (extension === ".tsx" || extension === ".jsx") {
    throw new TypeError(renderReactEntrypointError(appModule, "React component files are not valid Node launcher entrypoints."));
  }

  if (["page", "layout", "template", "loading", "error", "not-found"].includes(basename)) {
    throw new TypeError(renderReactEntrypointError(appModule, "Next.js route modules are not valid Ageniti launcher entrypoints."));
  }

  if (basename.includes("component") && segments.some((segment) => segment === "components" || segment === "ui")) {
    throw new TypeError(renderReactEntrypointError(appModule, "UI component modules are not valid Ageniti launcher entrypoints."));
  }
}

function renderReactEntrypointError(appModule, detail) {
  return [
    `${detail}`,
    `Received app module: ${appModule}`,
    "Build launchers must import a headless Ageniti app module that can run in Node.",
    "Create a separate module such as ./src/ageniti/app.js that imports shared actions/services and exports `app = createAgenitiApp(...)`.",
    "Then build with --app-module pointing at that headless module instead of a React page, layout, or component file.",
  ].join(" ");
}

function renderBundleReadme({ appName, options }) {
  const binName = options.package?.binName ?? toPackageName(appName);

  return `# ${appName} Ageniti Bundle

This directory was generated by Ageniti and contains runnable CLI and MCP artifacts.

## Files

- \`cli.mjs\`: CLI launcher
- \`mcp-stdio.mjs\`: MCP stdio launcher
- \`ageniti.manifest.json\`: surface manifest
- \`ageniti.actions.json\`: action manifest
- \`ageniti.mcp.json\`: MCP descriptor and client snippets
- \`ageniti.bundle.json\`: build report

## Run Directly

\`\`\`text
node ./cli.mjs
node ./mcp-stdio.mjs
\`\`\`

## Install As A Package

\`\`\`text
npm pack
npm install -g ./${options.package?.name ?? `${toPackageName(appName)}-ageniti`}-*.tgz
${binName}
${binName}-mcp
\`\`\`

## Publish

\`\`\`text
npm publish --dry-run
\`\`\`
`;
}

async function runNpmCommand({ cwd, command, argv, dryRun = false }) {
  const npmBinary = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmCacheDir = path.join(cwd, ".npm-cache");
  await mkdir(npmCacheDir, { recursive: true });

  const args = argv ?? [command];
  return execFileAsync(npmBinary, args, {
    cwd,
    env: {
      ...process.env,
      npm_config_cache: npmCacheDir,
      npm_config_dry_run: dryRun ? "true" : "false",
    },
  });
}
