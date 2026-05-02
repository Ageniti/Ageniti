import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultSurfaceAdapters } from "./adapters.js";
import { buildArtifacts, packageArtifacts, publishArtifacts } from "./build.js";
import { createRuntime } from "./core.js";
import { createDevServer } from "./dev-server.js";
import { createGuideDoc, exportDocs } from "./docs-export.js";
import { lintActions } from "./lint.js";
import { createActionManifest, createSurfaceManifest, diffActionManifests } from "./manifest.js";
import { createMcpManifest, createMcpStdioServer } from "./mcp.js";
import { doctorProject, initProject } from "./project-tools.js";

export function createCli(options) {
  const name = options.name ?? "ageniti";
  const actions = options.actions ?? [];
  const adapters = options.adapters ?? defaultSurfaceAdapters();
  const runtime = options.runtime ?? createRuntime({ actions, ...options.runtimeOptions });

  async function run(argv = process.argv.slice(2), io = defaultIo) {
    const [command, ...rest] = argv;

    if (!command || command === "--help" || command === "-h") {
      io.stdout(renderRootHelp(name, actions));
      return 0;
    }

    if (command === "actions") {
      io.stdout(JSON.stringify(createActionManifest(actions), null, 2));
      return 0;
    }

    if (command === "manifest") {
      io.stdout(JSON.stringify(createSurfaceManifest({ appName: name, actions, adapters }), null, 2));
      return 0;
    }

    if (command === "diff") {
      try {
        const cwd = readOption(rest, "--cwd") ?? process.cwd();
        const previousPath = readOption(rest, "--previous");
        const nextPath = readOption(rest, "--next");

        if (!previousPath || !nextPath) {
          io.stderr("diff requires --previous <file> and --next <file>.\n");
          return 2;
        }

        const diff = diffActionManifests(
          await readJsonFile(cwd, previousPath),
          await readJsonFile(cwd, nextPath),
        );
        io.stdout(JSON.stringify(diff, null, 2));
        return diff.ok ? 0 : 1;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
        return 2;
      }
    }

    if (command === "docs") {
      try {
        const outDir = readOption(rest, "--out-dir");
        const filename = readOption(rest, "--filename");
        if (outDir) {
          const result = await exportDocs({
            appName: name,
            appDescription: options.description,
            docs: options.docs,
            actions,
            cwd: readOption(rest, "--cwd") ?? process.cwd(),
            outDir,
            filename,
          });
          io.stdout(JSON.stringify(result, null, 2));
        } else {
          io.stdout(createGuideDoc({
            appName: name,
            appDescription: options.description,
            docs: options.docs,
            actions,
          }));
        }
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
        return 2;
      }
    }

    if (command === "build") {
      try {
        const buildResult = await runBuildCommand({
          appName: name,
          actions,
          adapters,
          defaults: options.buildOptions ?? {},
          args: rest,
        });
        io.stdout(JSON.stringify(buildResult, null, 2));
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
        return 2;
      }
    }

    if (command === "package") {
      try {
        const packageResult = await runPackageCommand({
          appName: name,
          actions,
          adapters,
          defaults: options.buildOptions ?? {},
          args: rest,
        });
        io.stdout(JSON.stringify(packageResult, null, 2));
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
        return 2;
      }
    }

    if (command === "publish") {
      try {
        const publishResult = await runPublishCommand({
          appName: name,
          actions,
          adapters,
          defaults: options.buildOptions ?? {},
          args: rest,
        });
        io.stdout(JSON.stringify(publishResult, null, 2));
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
        return 2;
      }
    }

    if (command === "doctor") {
      const result = await doctorProject({
        cwd: readOption(rest, "--cwd") ?? process.cwd(),
      });
      io.stdout(JSON.stringify(result, null, 2));
      return result.ok ? 0 : 1;
    }

    if (command === "init") {
      try {
        const template = rest[0] ?? "react";
        if (!["react", "expo", "next"].includes(template)) {
          io.stderr(`Unknown init template "${template}". Use "react", "expo", or "next".\n`);
          return 2;
        }

        const result = await initProject({
          template,
          cwd: readOption(rest, "--cwd") ?? process.cwd(),
          force: rest.includes("--force"),
        });
        io.stdout(JSON.stringify(result, null, 2));
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
        return 2;
      }
    }

    if (command === "lint") {
      const result = lintActions(actions);
      io.stdout(JSON.stringify(result, null, 2));
      return result.ok ? 0 : 1;
    }

    if (command === "mcp") {
      if (rest.includes("--stdio")) {
        if (io !== defaultIo) {
          io.stderr("MCP stdio mode requires default process IO.\n");
          return 1;
        }

        await createMcpStdioServer({ actions, runtime }).start();
        return 0;
      }

      io.stdout(JSON.stringify(createMcpManifest(actions), null, 2));
      return 0;
    }

    if (command === "dev") {
      const port = Number(readOption(rest, "--port") ?? 4321);
      const host = readOption(rest, "--host") ?? "127.0.0.1";
      const devServer = createDevServer({ name, actions, runtime });
      const listener = await devServer.listen(port, host);
      io.stdout(`Ageniti dev console: ${listener.url}`);

      if (io !== defaultIo) {
        await listener.close();
      }

      return 0;
    }

    const action = findAction(actions, command);
    if (!action) {
      io.stderr(`Unknown command "${command}".\n`);
      io.stderr(renderRootHelp(name, actions));
      return 4;
    }

    if (rest.includes("--help") || rest.includes("-h")) {
      io.stdout(renderActionHelp(name, action));
      return 0;
    }

    if (rest.includes("--schema")) {
      io.stdout(JSON.stringify(action.input.toJSONSchema(), null, 2));
      return 0;
    }

    const parseResult = parseActionInput(action, rest);
    if (!parseResult.ok) {
      io.stderr(`${parseResult.message}\n`);
      return 2;
    }

    const result = await runtime.invoke(action, parseResult.input, {
      surface: "cli",
      env: options.env,
      confirm: rest.includes("--confirm"),
    });

    io.stdout(JSON.stringify(result, null, 2));
    return result.ok ? 0 : errorCodeToExitCode(result.error.code);
  }

  async function main(argv = process.argv.slice(2), io = defaultIo) {
    const code = await run(argv, io);
    if (io === defaultIo) {
      process.exitCode = code;
    }
    return code;
  }

  return {
    name,
    actions,
    runtime,
    run,
    main,
  };
}

function parseActionInput(action, args) {
  args = args.filter((arg) => arg !== "--confirm");
  const jsonIndex = args.indexOf("--json");
  if (jsonIndex >= 0) {
    const json = args[jsonIndex + 1];
    if (!json) {
      return { ok: false, message: "--json requires a JSON object string." };
    }

    try {
      return { ok: true, input: JSON.parse(json) };
    } catch (error) {
      return { ok: false, message: `Invalid JSON input: ${error.message}` };
    }
  }

  const input = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      return { ok: false, message: `Unexpected positional argument "${arg}".` };
    }

    if (arg.startsWith("--no-")) {
      input[flagToField(arg.slice(5))] = false;
      continue;
    }

    const field = flagToField(arg.slice(2));
    const schema = action.input.shape?.[field];

    if (!schema) {
      return { ok: false, message: `Unknown option "${arg}".` };
    }

    if (schema.kind === "boolean") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        input[field] = true;
      } else {
        input[field] = parseBoolean(next);
        index += 1;
      }
      continue;
    }

    const rawValue = args[index + 1];
    if (!rawValue || rawValue.startsWith("--")) {
      return { ok: false, message: `Option "${arg}" requires a value.` };
    }

    try {
      input[field] = coerceCliValue(schema, rawValue);
    } catch (error) {
      return { ok: false, message: `Invalid value for "${arg}": ${error.message}` };
    }
    index += 1;
  }

  return { ok: true, input };
}

function coerceCliValue(schema, value) {
  if (schema.kind === "number") {
    return Number(value);
  }

  if (schema.kind === "array" || schema.kind === "object" || schema.kind === "any") {
    return JSON.parse(value);
  }

  return value;
}

function parseBoolean(value) {
  if (["true", "1", "yes"].includes(value.toLowerCase())) return true;
  if (["false", "0", "no"].includes(value.toLowerCase())) return false;
  return Boolean(value);
}

function renderRootHelp(name, actions) {
  const lines = [
    `${name}`,
    "",
    "Usage:",
    `  ${name} <action> [options]`,
    `  ${name} <action> --json '{"field":"value"}'`,
    `  ${name} <action> --schema`,
    `  ${name} actions`,
    `  ${name} manifest`,
    `  ${name} diff --previous old.json --next new.json`,
    `  ${name} build [manifest|cli|mcp|docs|bundle] [options]`,
    `  ${name} docs [options]`,
    `  ${name} package [options]`,
    `  ${name} publish [options]`,
    `  ${name} init <react|expo|next> [options]`,
    `  ${name} doctor [options]`,
    `  ${name} lint`,
    `  ${name} mcp`,
    `  ${name} mcp --stdio`,
    `  ${name} dev --port 4321`,
    "",
    "Actions:",
    ...actions.map((action) => `  ${commandName(action.name).padEnd(20)} ${action.description}`),
    "",
  ];

  return lines.join("\n");
}

async function runBuildCommand({ appName, actions, adapters, defaults, args }) {
  const target = !args[0] || args[0].startsWith("--") ? "bundle" : args[0];
  const validTargets = new Set(["manifest", "cli", "mcp", "docs", "bundle"]);
  if (!validTargets.has(target)) {
    throw new TypeError(`Unknown build target "${target}".`);
  }

  const cwd = readOption(args, "--cwd") ?? defaults.cwd;
  const outDir = readOption(args, "--out-dir") ?? defaults.outDir;
  const appModule = readOption(args, "--app-module") ?? defaults.appModule;
  const appExport = readOption(args, "--app-export") ?? defaults.appExport;
  const includePackageJson = args.includes("--package-json") || defaults.includePackageJson === true;
  const packageMetadata = readPackageMetadata(args, defaults.package);

  return buildArtifacts({
    appName,
    actions,
    adapters,
    targets: [target],
    outDir,
    appModule,
    appExport,
    includePackageJson,
    cwd,
    package: packageMetadata,
  });
}

async function runPackageCommand({ appName, actions, adapters, defaults, args }) {
  const cwd = readOption(args, "--cwd") ?? defaults.cwd;
  const outDir = readOption(args, "--out-dir") ?? defaults.outDir;
  const appModule = readOption(args, "--app-module") ?? defaults.appModule;
  const appExport = readOption(args, "--app-export") ?? defaults.appExport;
  const packageMetadata = readPackageMetadata(args, defaults.package);

  return packageArtifacts({
    appName,
    actions,
    adapters,
    outDir,
    appModule,
    appExport,
    cwd,
    dryRun: args.includes("--dry-run"),
    package: packageMetadata,
  });
}

async function runPublishCommand({ appName, actions, adapters, defaults, args }) {
  const cwd = readOption(args, "--cwd") ?? defaults.cwd;
  const outDir = readOption(args, "--out-dir") ?? defaults.outDir;
  const appModule = readOption(args, "--app-module") ?? defaults.appModule;
  const appExport = readOption(args, "--app-export") ?? defaults.appExport;
  const packageMetadata = readPackageMetadata(args, defaults.package);

  return publishArtifacts({
    appName,
    actions,
    adapters,
    outDir,
    appModule,
    appExport,
    cwd,
    dryRun: !args.includes("--live"),
    access: readOption(args, "--access"),
    tag: readOption(args, "--tag"),
    registry: readOption(args, "--registry"),
    package: packageMetadata,
  });
}

function renderActionHelp(name, action) {
  const lines = [
    `${name} ${commandName(action.name)}`,
    "",
    action.description,
    "",
    "Usage:",
    `  ${name} ${commandName(action.name)} [options]`,
    `  ${name} ${commandName(action.name)} --json '{"field":"value"}'`,
    "",
    "Options:",
  ];

  for (const [field, schema] of Object.entries(action.input.shape ?? {})) {
    const required = schema.isOptional || schema.defaultValue !== undefined ? "optional" : "required";
    const detail = schema.description ? ` - ${schema.description}` : "";
    lines.push(`  --${fieldToFlag(field).padEnd(18)} ${schema.kind} (${required})${detail}`);
  }

  lines.push("");
  return lines.join("\n");
}

function findAction(actions, command) {
  return actions.find((action) => action.name === command || commandName(action.name) === command);
}

function readOption(args, option) {
  const index = args.indexOf(option);
  if (index < 0) {
    return undefined;
  }

  return args[index + 1];
}

function readPackageMetadata(args, defaults = {}) {
  return {
    ...defaults,
    name: readOption(args, "--package-name") ?? defaults?.name,
    version: readOption(args, "--package-version") ?? defaults?.version,
    description: readOption(args, "--package-description") ?? defaults?.description,
    license: readOption(args, "--package-license") ?? defaults?.license,
    binName: readOption(args, "--bin-name") ?? defaults?.binName,
    mcpServerName: readOption(args, "--mcp-server-name") ?? defaults?.mcpServerName,
    private: args.includes("--public") ? false : defaults?.private,
  };
}

async function readJsonFile(cwd, filePath) {
  const resolvedPath = path.resolve(cwd, filePath);
  return JSON.parse(await readFile(resolvedPath, "utf8"));
}

function commandName(actionName) {
  return actionName.replaceAll("_", "-");
}

function fieldToFlag(field) {
  return field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function flagToField(flag) {
  return flag.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function errorCodeToExitCode(code) {
  const codes = {
    VALIDATION_ERROR: 2,
    AUTHENTICATION_ERROR: 3,
    AUTHORIZATION_ERROR: 3,
    ACTION_NOT_FOUND: 4,
    EXTERNAL_SERVICE_ERROR: 5,
    TIMEOUT: 124,
    CANCELLED: 130,
  };

  return codes[code] ?? 1;
}

const defaultIo = {
  stdout(value) {
    process.stdout.write(`${value}\n`);
  },
  stderr(value) {
    process.stderr.write(value);
  },
};
