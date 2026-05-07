import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultSurfaceAdapters } from "../adapters.js";
import { buildArtifacts, packageArtifacts, publishArtifacts } from "./build.js";
import { createDevServer } from "../dev-server.js";
import { createGuideDoc, exportDocs } from "./docs-export.js";
import { lintActions } from "./lint.js";
import { createActionManifest, createSurfaceManifest, diffActionManifests } from "../runtime/manifest.js";
import { createMcpManifest, createMcpStdioServer } from "../transports/mcp.js";
import { doctorProject, initProject, initTemplates } from "./project-tools.js";
import { resolveRuntimeAndActions } from "../transports/surface-utils.js";

export function createCli(options) {
  const name = options.name ?? "ageniti";
  const adapters = options.adapters ?? defaultSurfaceAdapters();
  const { runtime, actions } = resolveRuntimeAndActions(options);

  async function run(argv = process.argv.slice(2), io = defaultIo) {
    const [command, ...rest] = argv;

    if (!command || command === "--help" || command === "-h") {
      io.stdout(renderRootHelp(name, actions, options.attribution));
      return 0;
    }

    if (command === "actions") {
      io.stdout(JSON.stringify(createActionManifest(actions), null, 2));
      return 0;
    }

    if (command === "manifest") {
      io.stdout(JSON.stringify(createSurfaceManifest({
        appName: name,
        actions,
        adapters,
        attribution: options.attribution,
      }), null, 2));
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
            attribution: options.attribution,
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
            attribution: options.attribution,
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
          appDescription: options.description,
          docs: options.docs,
          attribution: options.attribution,
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
          appDescription: options.description,
          docs: options.docs,
          attribution: options.attribution,
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
          appDescription: options.description,
          docs: options.docs,
          attribution: options.attribution,
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
        if (!initTemplates.includes(template)) {
          io.stderr(`Unknown init template "${template}". Use ${initTemplates.map((item) => `"${item}"`).join(", ")}.\n`);
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

        await createMcpStdioServer({
          actions,
          runtime,
          attribution: options.attribution,
        }).start();
        return 0;
      }

      io.stdout(JSON.stringify(createMcpManifest(actions, {
        attribution: options.attribution,
      }), null, 2));
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
      io.stderr(renderRootHelp(name, actions, options.attribution));
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

    const ndjson = rest.includes("--ndjson");
    const idempotencyKey = readOption(rest, "--idempotency-key");
    const timeoutFlag = readOption(rest, "--timeout-ms");
    const timeoutMs = timeoutFlag ? Number(timeoutFlag) : undefined;

    const abortController = new AbortController();
    const onSigint = () => {
      abortController.abort();
    };
    const sigintAttachable = io === defaultIo && typeof process.on === "function";
    if (sigintAttachable) {
      process.on("SIGINT", onSigint);
    }

    let result;
    try {
      if (ndjson && typeof runtime.stream === "function") {
        // Live streaming: emit each log/artifact/progress event as a line as
        // it happens, then emit the final result line.
        const events = runtime.stream(action, parseResult.input, {
          surface: "cli",
          env: options.env,
          confirm: rest.includes("--confirm"),
          signal: abortController.signal,
          idempotencyKey,
          timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
        });
        for await (const event of events) {
          if (event.type === "result") {
            result = event.envelope;
            io.stdout(JSON.stringify({
              type: "result",
              ok: result.ok,
              ...(result.ok ? { data: result.data } : { error: result.error }),
              meta: result.meta,
            }));
          } else {
            io.stdout(JSON.stringify(event));
          }
        }
      } else {
        result = await runtime.invoke(action, parseResult.input, {
          surface: "cli",
          env: options.env,
          confirm: rest.includes("--confirm"),
          signal: abortController.signal,
          idempotencyKey,
          timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
        });
        io.stdout(JSON.stringify(result, null, 2));
      }
    } finally {
      if (sigintAttachable) {
        process.off("SIGINT", onSigint);
      }
    }

    // Defensive: a misbehaving stream could close without ever yielding a
    // result event. Treat that as an internal error rather than crashing.
    if (!result) {
      io.stderr("Action stream closed without a result event.\n");
      return 1;
    }

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

const RESERVED_CLI_FLAGS = new Set([
  "--confirm", "--ndjson", "--idempotency-key", "--timeout-ms",
]);

function parseActionInput(action, args) {
  args = filterReservedFlags(args);
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
      const field = flagToField(arg.slice(5));
      const schema = action.input.shape?.[field];
      if (!schema) {
        return { ok: false, message: `Unknown option "${arg}".` };
      }
      if (schema.kind !== "boolean") {
        return { ok: false, message: `--no-* is only valid for boolean fields ("${field}" is ${schema.kind}).` };
      }
      input[field] = false;
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
    if (rawValue === undefined || rawValue.startsWith("--")) {
      return { ok: false, message: `Option "${arg}" requires a value.` };
    }

    try {
      const coerced = coerceCliValue(schema, rawValue);
      if (schema.kind === "array") {
        // Support repeated flags: --tag a --tag b → ["a","b"]
        // If user passes JSON-shaped value, use it directly; otherwise append.
        if (Array.isArray(coerced)) {
          input[field] = (input[field] ?? []).concat(coerced);
        } else {
          input[field] = (input[field] ?? []).concat([coerced]);
        }
      } else {
        input[field] = coerced;
      }
    } catch (error) {
      return { ok: false, message: `Invalid value for "${arg}": ${error.message}` };
    }
    index += 1;
  }

  return { ok: true, input };
}

function filterReservedFlags(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (RESERVED_CLI_FLAGS.has(arg)) {
      // --idempotency-key and --timeout-ms take a value; skip the value too.
      if (arg === "--idempotency-key" || arg === "--timeout-ms") {
        i += 1;
      }
      continue;
    }
    out.push(arg);
  }
  return out;
}

function coerceCliValue(schema, value) {
  if (schema.kind === "number") {
    const num = Number(value);
    if (Number.isNaN(num)) {
      throw new Error(`Expected number, got "${value}".`);
    }
    return num;
  }

  if (schema.kind === "object" || schema.kind === "any") {
    return JSON.parse(value);
  }

  if (schema.kind === "array") {
    // Allow either JSON array form (--tag '["a","b"]') or single repeated value.
    if (value.startsWith("[")) {
      return JSON.parse(value);
    }
    const itemSchema = schema.itemSchema;
    if (itemSchema?.kind === "number") {
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new Error(`Expected number array element, got "${value}".`);
      }
      return num;
    }
    return value;
  }

  return value;
}

function parseBoolean(value) {
  if (["true", "1", "yes"].includes(value.toLowerCase())) return true;
  if (["false", "0", "no"].includes(value.toLowerCase())) return false;
  return Boolean(value);
}

function renderRootHelp(name, actions, attribution) {
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
    `  ${name} init <${initTemplates.join("|")}> [options]`,
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

  if (attribution?.text) {
    lines.push("Attribution:");
    lines.push(`  ${attribution.text}`);
    if (attribution.vendor) {
      lines.push(`  Vendor: ${attribution.vendor}`);
    }
    if (attribution.product) {
      lines.push(`  Product: ${attribution.product}`);
    }
    if (attribution.licenseNotice) {
      lines.push(`  License: ${attribution.licenseNotice}`);
    }
    if (attribution.url) {
      lines.push(`  ${attribution.url}`);
    }
    if (attribution.docsUrl) {
      lines.push(`  Docs: ${attribution.docsUrl}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function runBuildCommand({ appName, appDescription, docs, attribution, actions, adapters, defaults, args }) {
  const target = !args[0] || args[0].startsWith("--") ? "bundle" : args[0];
  const validTargets = new Set(["manifest", "cli", "mcp", "docs", "bundle"]);
  if (!validTargets.has(target)) {
    throw new TypeError(`Unknown build target "${target}".`);
  }

  const resolved = readArtifactCommandOptions(args, defaults, {
    includeFilename: true,
    includePackageJson: true,
  });

  return buildArtifacts({
    appName,
    appDescription,
    docs,
    attribution,
    actions,
    adapters,
    targets: [target],
    outDir: resolved.outDir,
    appModule: resolved.appModule,
    appExport: resolved.appExport,
    filename: resolved.filename,
    includePackageJson: resolved.includePackageJson,
    cwd: resolved.cwd,
    package: resolved.packageMetadata,
  });
}

async function runPackageCommand({ appName, appDescription, docs, attribution, actions, adapters, defaults, args }) {
  const resolved = readArtifactCommandOptions(args, defaults);

  return packageArtifacts({
    appName,
    appDescription,
    docs,
    attribution,
    actions,
    adapters,
    outDir: resolved.outDir,
    appModule: resolved.appModule,
    appExport: resolved.appExport,
    cwd: resolved.cwd,
    dryRun: args.includes("--dry-run"),
    package: resolved.packageMetadata,
  });
}

async function runPublishCommand({ appName, appDescription, docs, attribution, actions, adapters, defaults, args }) {
  const resolved = readArtifactCommandOptions(args, defaults);

  return publishArtifacts({
    appName,
    appDescription,
    docs,
    attribution,
    actions,
    adapters,
    outDir: resolved.outDir,
    appModule: resolved.appModule,
    appExport: resolved.appExport,
    cwd: resolved.cwd,
    dryRun: !args.includes("--live"),
    access: readOption(args, "--access"),
    tag: readOption(args, "--tag"),
    registry: readOption(args, "--registry"),
    package: resolved.packageMetadata,
  });
}

function readArtifactCommandOptions(args, defaults = {}, options = {}) {
  return {
    cwd: readOption(args, "--cwd") ?? defaults.cwd,
    outDir: readOption(args, "--out-dir") ?? defaults.outDir,
    appModule: readOption(args, "--app-module") ?? defaults.appModule,
    appExport: readOption(args, "--app-export") ?? defaults.appExport,
    filename: options.includeFilename ? (readOption(args, "--filename") ?? defaults.filename) : undefined,
    includePackageJson: options.includePackageJson ? (args.includes("--package-json") || defaults.includePackageJson === true) : undefined,
    packageMetadata: readPackageMetadata(args, defaults.package),
  };
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
    "Action options:",
  ];

  for (const [field, schema] of Object.entries(action.input.shape ?? {})) {
    const required = schema.isOptional || schema.defaultValue !== undefined ? "optional" : "required";
    const detail = schema.description ? ` - ${schema.description}` : "";
    lines.push(`  --${fieldToFlag(field).padEnd(18)} ${schema.kind} (${required})${detail}`);
  }

  lines.push("");
  lines.push("Runtime options:");
  lines.push("  --json <object>      Pass full input as a JSON object (overrides per-field flags).");
  lines.push("  --schema             Print the action input JSON schema and exit.");
  lines.push("  --confirm            Required to execute destructive actions on cli/json/mcp/http.");
  lines.push("  --timeout-ms <n>     Override the action timeout for this invocation.");
  lines.push("  --idempotency-key <k> Replay the cached envelope for repeated invocations.");
  lines.push("  --ndjson             Emit logs, artifacts, and result as newline-delimited JSON.");
  if (action.sideEffects && action.sideEffects !== "read") {
    lines.push("");
    lines.push(`Side effects: ${action.sideEffects}${action.requiresConfirmation ? " (requires --confirm)" : ""}.`);
  }
  if (action.deprecated) {
    lines.push("");
    lines.push(`Deprecated: ${action.deprecation?.message ?? "yes"}${action.deprecation?.replacement ? ` Use "${action.deprecation.replacement}" instead.` : ""}`);
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
    OUTPUT_VALIDATION_ERROR: 2,
    OUTPUT_SERIALIZATION_ERROR: 2,
    AUTHENTICATION_ERROR: 3,
    AUTHORIZATION_ERROR: 3,
    CONFIRMATION_REQUIRED: 3,
    ACTION_NOT_FOUND: 4,
    UNSUPPORTED_SURFACE: 4,
    EXTERNAL_SERVICE_ERROR: 5,
    CONCURRENCY_LIMIT: 5,
    RATE_LIMITED: 5,
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
