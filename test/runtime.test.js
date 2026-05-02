import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import {
  AgenitiError,
  createAgenitiApp,
  createAISDKTools,
  buildArtifacts,
  packageArtifacts,
  publishArtifacts,
  exportDocs,
  loadProjectConfig,
  doctorProject,
  createCli,
  createDevServer,
  createHttpHandler,
  findDefaultAppModule,
  initProject,
  createOpenAIResponsesTools,
  createOpenAITools,
  createMcpHandler,
  createMcpManifest,
  createRuntime,
  diffActionManifests,
  defineAction,
  lintActions,
  s,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const packageDir = path.dirname(fileURLToPath(import.meta.url));
const buildableAppModule = path.join(packageDir, "..", "examples", "buildable-app.mjs");

const add = defineAction({
  name: "add_numbers",
  description: "Add two numbers.",
  input: s.object({
    a: s.number(),
    b: s.number(),
  }),
  output: s.object({
    sum: s.number(),
  }),
  run({ a, b }, ctx) {
    ctx.logger.info("Adding numbers.", { a, b });
    return { sum: a + b };
  },
});

test("runtime returns structured success envelopes", async () => {
  const runtime = createRuntime({ actions: [add] });
  const result = await runtime.invoke("add_numbers", { a: 2, b: 3 }, { surface: "cli" });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { sum: 5 });
  assert.equal(result.meta.action, "add_numbers");
  assert.equal(result.logs.length, 1);
});

test("runtime returns structured validation errors", async () => {
  const runtime = createRuntime({ actions: [add] });
  const result = await runtime.invoke("add_numbers", { a: "2", b: 3 }, { surface: "cli" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VALIDATION_ERROR");
  assert.deepEqual(result.error.issues[0].path, ["a"]);
});

test("cli maps flags into action input", async () => {
  const output = [];
  const errors = [];
  const cli = createCli({ name: "math", actions: [add] });
  const code = await cli.run(["add-numbers", "--a", "4", "--b", "8"], {
    stdout: (value) => output.push(value),
    stderr: (value) => errors.push(value),
  });

  assert.equal(code, 0);
  assert.equal(errors.length, 0);
  assert.equal(JSON.parse(output[0]).data.sum, 12);
});

test("mcp handler lists and calls tools", async () => {
  const handle = createMcpHandler({ actions: [add] });
  const list = await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });

  assert.equal(list.result.tools[0].name, "add_numbers");

  const call = await handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "add_numbers",
      arguments: { a: 1, b: 6 },
    },
  });

  assert.equal(call.result.structuredContent.ok, true);
  assert.equal(call.result.structuredContent.data.sum, 7);
});

test("mcp handler blocks tools hidden from discovery", async () => {
  const hidden = defineAction({
    name: "hidden_write",
    description: "Hidden write action.",
    visibility: "private",
    sideEffects: "write",
    input: s.object({ id: s.string() }),
    output: s.object({ ok: s.boolean() }),
    run() {
      return { ok: true };
    },
  });

  const handle = createMcpHandler({ actions: [hidden] });
  const list = await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const call = await handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "hidden_write",
      arguments: { id: "one" },
    },
  });

  assert.equal(list.result.tools.length, 0);
  assert.equal(call.error.code, -32601);
});

test("public metadata is exposed consistently while internal metadata stays separate", async () => {
  const annotated = defineAction({
    name: "annotated_action",
    description: "Action with metadata.",
    metadata: {
      internalOnly: true,
      owner: "ops",
    },
    publicMetadata: {
      category: "admin",
      docsUrl: "https://example.com/docs/annotated-action",
    },
    input: s.object({ id: s.string() }),
    output: s.object({ ok: s.boolean() }),
    run(input, ctx) {
      assert.equal(ctx.metadata.requestId, "req-123");
      return { ok: Boolean(input.id) };
    },
  });

  const manifest = createAgenitiApp({
    name: "meta-app",
    actions: [annotated],
  }).manifest();
  assert.equal(manifest.actions[0].metadata.internalOnly, true);
  assert.equal(manifest.actions[0].publicMetadata.category, "admin");

  const mcp = createMcpManifest([annotated]);
  assert.equal(mcp.tools[0].metadata.category, "admin");
  assert.equal("internalOnly" in mcp.tools[0].metadata, false);

  const openai = createOpenAITools([annotated]);
  assert.equal(openai[0].metadata.category, "admin");
  assert.equal("internalOnly" in (openai[0].metadata ?? {}), false);

  const responses = createOpenAIResponsesTools([annotated]);
  assert.equal(responses[0].metadata.docsUrl, "https://example.com/docs/annotated-action");

  const aiSdk = createAISDKTools([annotated]);
  assert.equal(aiSdk.annotated_action.metadata.category, "admin");

  const runtime = createRuntime({ actions: [annotated] });
  const result = await runtime.invoke("annotated_action", { id: "1" }, {
    surface: "cli",
    metadata: { requestId: "req-123" },
  });
  assert.equal(result.ok, true);
});

test("action manifests include versioning and deprecation metadata", () => {
  const legacy = defineAction({
    name: "legacy_action",
    version: "2.1.0",
    description: "Legacy action.",
    deprecated: true,
    deprecation: {
      message: "Use modern_action instead.",
      since: "2.1.0",
      replacement: "modern_action",
    },
    run() {
      return { ok: true };
    },
  });

  const manifest = createAgenitiApp({
    name: "legacy-app",
    actions: [legacy],
  }).manifest();

  assert.equal(manifest.actions[0].version, "2.1.0");
  assert.equal(manifest.actions[0].deprecated, true);
  assert.equal(manifest.actions[0].deprecation.replacement, "modern_action");
});

test("diffActionManifests reports breaking and advisory contract changes", () => {
  const before = createAgenitiApp({
    name: "contracts",
    actions: [add],
  }).manifest();
  const changed = defineAction({
    name: "add_numbers",
    version: "2.0.0",
    description: "Add two numbers with a required label.",
    input: s.object({
      a: s.number(),
      b: s.number(),
      label: s.string(),
    }),
    output: s.object({
      sum: s.number(),
    }),
    deprecated: true,
    run({ a, b }) {
      return { sum: a + b };
    },
  });
  const after = createAgenitiApp({
    name: "contracts",
    actions: [changed],
  }).manifest();

  const diff = diffActionManifests(before, after);

  assert.equal(diff.ok, false);
  assert.equal(diff.summary.breaking, 1);
  assert.equal(diff.summary.warnings, 1);
  assert.equal(diff.changes.some((change) => change.field === "inputSchema"), true);
  assert.equal(diff.changes.some((change) => change.type === "deprecated"), true);
});

test("http handler exposes structured action discovery and invocation", async () => {
  const handle = createHttpHandler({ actions: [add] });
  const list = await handle({ method: "GET", path: "/ageniti/actions" });
  const call = await handle({
    method: "POST",
    path: "/ageniti/actions/add_numbers/invoke",
    body: {
      input: { a: 4, b: 9 },
    },
  });

  assert.equal(list.status, 200);
  assert.equal(list.body.actions[0].name, "add_numbers");
  assert.equal(call.status, 200);
  assert.equal(call.body.ok, true);
  assert.equal(call.body.data.sum, 13);
});

test("destructive actions require explicit confirmation outside UI/dev surfaces", async () => {
  const destroy = defineAction({
    name: "destroy_thing",
    description: "Destroy a thing.",
    sideEffects: "destructive",
    input: s.object({ id: s.string() }),
    output: s.object({ destroyed: s.boolean() }),
    run() {
      return { destroyed: true };
    },
  });
  const runtime = createRuntime({ actions: [destroy] });

  const denied = await runtime.invoke("destroy_thing", { id: "one" }, { surface: "cli" });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "CONFIRMATION_REQUIRED");

  const confirmed = await runtime.invoke("destroy_thing", { id: "one" }, { surface: "cli", confirm: true });
  assert.equal(confirmed.ok, true);
});

test("runtime supports retryable Ageniti errors", async () => {
  let attempts = 0;
  const flaky = defineAction({
    name: "flaky_action",
    description: "Fail once, then succeed.",
    retry: { retries: 1, delayMs: 1 },
    output: s.object({ attempts: s.number() }),
    run() {
      attempts += 1;
      if (attempts === 1) {
        throw new AgenitiError("EXTERNAL_SERVICE_ERROR", "Temporary failure.", { retryable: true });
      }

      return { attempts };
    },
  });

  const runtime = createRuntime({ actions: [flaky] });
  const result = await runtime.invoke("flaky_action", {}, { surface: "cli" });

  assert.equal(result.ok, true);
  assert.equal(result.data.attempts, 2);
  assert.equal(result.logs.some((log) => log.message.includes("Retrying action")), true);
});

test("app factory creates shared surfaces from one action list", async () => {
  const app = createAgenitiApp({
    name: "math",
    description: "Math actions for operators and agents.",
    docs: {
      summary: "Use math actions to perform safe arithmetic.",
      audience: "Internal operators and agent runtimes.",
    },
    actions: [add],
  });

  assert.equal(app.manifest().actions[0].name, "add_numbers");
  assert.equal(app.createMcpManifest().tools[0].name, "add_numbers");

  const output = [];
  const code = await app.createCli().run(["add-numbers", "--json", '{"a":3,"b":9}'], {
    stdout: (value) => output.push(value),
    stderr: () => {},
  });

  assert.equal(code, 0);
  assert.equal(JSON.parse(output[0]).data.sum, 12);

  const json = await app.createJsonRunner().invoke({
    action: "add_numbers",
    input: { a: 10, b: 2 },
  });
  assert.equal(json.data.sum, 12);
  assert.equal(app.lint().ok, true);
  assert.match(app.createGuideDoc(), /Use math actions to perform safe arithmetic/);
});

test("app build writes official bundle artifacts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-build-"));
  const outDir = path.join(tempDir, "bundle");
  const app = createAgenitiApp({
    name: "math",
    actions: [add],
    build: {
      appModule: buildableAppModule,
      appExport: "app",
    },
  });

  const result = await app.build({ outDir });

  assert.equal(result.ok, true);
  assert.equal(result.files.some((file) => file.kind === "manifest"), true);
  assert.equal(result.files.some((file) => file.kind === "cli"), true);
  assert.equal(result.files.some((file) => file.kind === "mcp"), true);
  assert.equal(result.files.some((file) => file.kind === "package-json"), true);
  assert.equal(result.files.some((file) => file.kind === "mcp-descriptor"), true);
  assert.equal(result.files.some((file) => file.kind === "guide-doc"), true);

  const bundleReport = JSON.parse(await readFile(path.join(outDir, "ageniti.bundle.json"), "utf8"));
  assert.equal(bundleReport.commands.cli, "node ./cli.mjs");
  assert.equal(bundleReport.commands.mcp, "node ./mcp-stdio.mjs");
  assert.equal(bundleReport.commands.pack, "npm pack");
  const mcpDescriptor = JSON.parse(await readFile(path.join(outDir, "ageniti.mcp.json"), "utf8"));
  assert.deepEqual(mcpDescriptor.command, ["node", "./mcp-stdio.mjs"]);
  assert.equal(mcpDescriptor.snippets.claudeDesktop.mcpServers.math.command, "node");
  const bundleReadme = await readFile(path.join(outDir, "README.md"), "utf8");
  assert.match(bundleReadme, /Ageniti Bundle/);
  assert.match(bundleReadme, /npm pack/);
  const guideDoc = await readFile(path.join(outDir, "GUIDE.md"), "utf8");
  assert.match(guideDoc, /Available Actions/);
});

test("exportDocs writes a single GUIDE document", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-guide-"));
  const result = await exportDocs({
    appName: "math",
    appDescription: "Math actions for agent-facing workflows.",
    docs: {
      summary: "This app exposes simple arithmetic actions.",
      quickStart: ["Pick an action.", "Provide valid input.", "Read the structured result."],
    },
    actions: [add],
    cwd: tempDir,
    outDir: "./docs-out",
  });

  assert.equal(result.ok, true);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].kind, "guide-doc");
  const guide = await readFile(path.join(tempDir, "docs-out", "GUIDE.md"), "utf8");
  assert.match(guide, /Math Guide|math Guide/i);
  assert.match(guide, /This app exposes simple arithmetic actions/);
});

test("packageArtifacts creates a distributable npm tarball", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-package-"));
  const outDir = path.join(tempDir, "bundle");

  const result = await packageArtifacts({
    appName: "math",
    actions: [add],
    outDir,
    appModule: buildableAppModule,
    appExport: "app",
    package: {
      name: "math-bundle",
      version: "1.2.3",
      description: "Math bundle",
      private: false,
      binName: "math-cli",
      mcpServerName: "math-server",
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.packageFile ?? "", /math-bundle-1\.2\.3\.tgz$/);
  const pkg = JSON.parse(await readFile(path.join(outDir, "package.json"), "utf8"));
  assert.equal(pkg.name, "math-bundle");
  assert.equal(pkg.version, "1.2.3");
  assert.equal(pkg.private, false);
  assert.equal(pkg.bin["math-cli"], "./cli.mjs");
  assert.equal(pkg.bin["math-cli-mcp"], "./mcp-stdio.mjs");
  const descriptor = JSON.parse(await readFile(path.join(outDir, "ageniti.mcp.json"), "utf8"));
  assert.equal(descriptor.snippets.codex.mcpServers["math-server"].args[0], "./mcp-stdio.mjs");
});

test("publishArtifacts performs an npm publish dry-run", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-publish-"));
  const outDir = path.join(tempDir, "bundle");

  const result = await publishArtifacts({
    appName: "math",
    actions: [add],
    outDir,
    appModule: buildableAppModule,
    appExport: "app",
    dryRun: true,
    access: "public",
    tag: "next",
    package: {
      name: "math-publish-bundle",
      version: "2.0.0",
      private: false,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.published, "dry-run");
  assert.match(result.stdout + result.stderr, /npm notice|dry-run|publish/i);
  assert.match(result.packageFile ?? "", /math-publish-bundle-2\.0\.0\.tgz$/);
});

test("app build discovers default app module automatically", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-auto-build-"));
  const scaffold = await initProject({ cwd: tempDir, template: "react" });
  const outDir = path.join(tempDir, "bundle");
  const app = createAgenitiApp({
    name: "math",
    actions: [add],
  });

  const result = await app.build({ outDir, cwd: tempDir });

  assert.equal(scaffold.appModule, "./src/ageniti/app.js");
  assert.equal(result.files.some((file) => file.kind === "cli"), true);
});

test("buildArtifacts creates runnable cli launcher", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-cli-build-"));
  const outDir = path.join(tempDir, "bundle");

  await buildArtifacts({
    appName: "math",
    actions: [add],
    targets: ["cli"],
    outDir,
    appModule: buildableAppModule,
    appExport: "app",
  });

  const { stdout } = await execFileAsync(process.execPath, [path.join(outDir, "cli.mjs"), "actions"], {
    cwd: "/Users/aidenli/Desktop/CLI-SDK",
  });
  const actions = JSON.parse(stdout);

  assert.equal(actions[0].name, "add_numbers");
});

test("buildArtifacts rejects React and Next entry modules for launchers", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-react-build-"));

  await assert.rejects(() => buildArtifacts({
    appName: "math",
    actions: [add],
    targets: ["cli"],
    outDir: path.join(tempDir, "bundle"),
    appModule: "./src/app/page.tsx",
    appExport: "app",
  }), /headless Ageniti app module|Next\.js route modules|React component files/);
});

test("findDefaultAppModule prefers node-safe scaffold entries", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-discovery-"));
  await initProject({ cwd: tempDir, template: "react" });

  const discovery = await findDefaultAppModule({ cwd: tempDir });

  assert.equal(discovery.found, true);
  assert.equal(discovery.modulePath, "./src/ageniti/app.js");
});

test("loadProjectConfig reads ageniti config defaults", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-config-"));
  await initProject({ cwd: tempDir, template: "react" });

  const config = await loadProjectConfig({ cwd: tempDir });

  assert.equal(config?.build?.appModule, "./src/ageniti/app.js");
  assert.equal(config?.build?.outDir, "./dist/ageniti");
});

test("schema supports union, literal, records, and url validation", () => {
  const schema = s.object({
    kind: s.literal("link"),
    target: s.union([s.string().url(), s.literal("self")]),
    labels: s.record(s.string()),
  });

  assert.deepEqual(schema.parse({
    kind: "link",
    target: "https://example.com",
    labels: { env: "test" },
  }), {
    kind: "link",
    target: "https://example.com",
    labels: { env: "test" },
  });

  assert.throws(() => schema.parse({ kind: "link", target: "nope", labels: {} }));
});

test("cli reports malformed json input", async () => {
  const output = [];
  const errors = [];
  const cli = createCli({ name: "math", actions: [add] });
  const code = await cli.run(["add-numbers", "--json", "{nope"], {
    stdout: (value) => output.push(value),
    stderr: (value) => errors.push(value),
  });

  assert.equal(code, 2);
  assert.equal(output.length, 0);
  assert.match(errors[0], /Invalid JSON input/);
});

test("cli build reports missing app module for launcher targets", async () => {
  const output = [];
  const errors = [];
  const cli = createCli({ name: "math", actions: [add] });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-build-missing-"));
  const code = await cli.run(["build", "cli", "--cwd", tempDir], {
    stdout: (value) => output.push(value),
    stderr: (value) => errors.push(value),
  });

  assert.equal(code, 2);
  assert.equal(output.length, 0);
  assert.match(errors[0], /No default Ageniti app entry was found|--app-module/);
});

test("cli build reports React app entrypoint guidance", async () => {
  const output = [];
  const errors = [];
  const cli = createCli({ name: "math", actions: [add] });
  const code = await cli.run(["build", "cli", "--app-module", "./src/app/layout.tsx"], {
    stdout: (value) => output.push(value),
    stderr: (value) => errors.push(value),
  });

  assert.equal(code, 2);
  assert.equal(output.length, 0);
  assert.match(errors[0], /headless Ageniti app module/);
  assert.match(errors[0], /layout\.tsx/);
});

test("cli build defaults to bundle when no target is provided", async () => {
  const output = [];
  const errors = [];
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-build-default-"));
  await initProject({ cwd: tempDir, template: "react" });
  const cli = createCli({ name: "math", actions: [add] });
  const code = await cli.run(["build", "--cwd", tempDir, "--out-dir", "./dist/ageniti"], {
    stdout: (value) => output.push(value),
    stderr: (value) => errors.push(value),
  });

  assert.equal(code, 0);
  assert.equal(errors.length, 0);
  const result = JSON.parse(output[0]);
  assert.deepEqual(result.targets, ["bundle"]);
});

test("cli build reads app module from ageniti config", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-build-config-"));
  await initProject({ cwd: tempDir, template: "react" });
  const cli = createCli({ name: "math", actions: [add] });
  const output = [];
  const errors = [];
  const code = await cli.run(["build", "cli", "--cwd", tempDir], {
    stdout: (value) => output.push(value),
    stderr: (value) => errors.push(value),
  });

  assert.equal(code, 0);
  assert.equal(errors.length, 0);
  const result = JSON.parse(output[0]);
  assert.equal(result.files.some((file) => file.kind === "cli"), true);
});

test("cli docs prints or exports the unified guide", async () => {
  const output = [];
  const errors = [];
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-cli-docs-"));
  const cli = createCli({
    name: "math",
    description: "Math actions for agents.",
    docs: {
      summary: "Guide summary for math.",
    },
    actions: [add],
  });

  const stdoutCode = await cli.run(["docs"], {
    stdout: (value) => output.push(value),
    stderr: (value) => errors.push(value),
  });
  assert.equal(stdoutCode, 0);
  assert.equal(errors.length, 0);
  assert.match(output[0], /Guide summary for math/);

  output.length = 0;
  const fileCode = await cli.run(["docs", "--cwd", tempDir, "--out-dir", "./guide-out"], {
    stdout: (value) => output.push(value),
    stderr: (value) => errors.push(value),
  });
  assert.equal(fileCode, 0);
  const docsResult = JSON.parse(output[0]);
  assert.equal(docsResult.files[0].kind, "guide-doc");
  const guide = await readFile(path.join(tempDir, "guide-out", "GUIDE.md"), "utf8");
  assert.match(guide, /Guide summary for math/);
});

test("cli diff compares manifest files for release checks", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-cli-diff-"));
  const beforePath = path.join(tempDir, "before.json");
  const afterPath = path.join(tempDir, "after.json");
  const changed = defineAction({
    name: "add_numbers",
    description: "Add two numbers with a required label.",
    input: s.object({
      a: s.number(),
      b: s.number(),
      label: s.string(),
    }),
    output: s.object({
      sum: s.number(),
    }),
    run({ a, b }) {
      return { sum: a + b };
    },
  });

  await writeFile(beforePath, JSON.stringify(createAgenitiApp({ name: "math", actions: [add] }).manifest()));
  await writeFile(afterPath, JSON.stringify(createAgenitiApp({ name: "math", actions: [changed] }).manifest()));

  const output = [];
  const code = await createCli({ name: "math" }).run([
    "diff",
    "--previous",
    beforePath,
    "--next",
    afterPath,
  ], {
    stdout: (value) => output.push(value),
    stderr: () => {},
  });

  assert.equal(code, 1);
  assert.equal(JSON.parse(output[0]).summary.breaking, 1);
});

test("cli package creates a bundle tarball", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-cli-package-"));
  const output = [];
  const errors = [];
  const cli = createCli({ name: "math", actions: [add] });
  const code = await cli.run([
    "package",
    "--out-dir",
    path.join(tempDir, "bundle"),
    "--app-module",
    buildableAppModule,
    "--app-export",
    "app",
  ], {
    stdout: (value) => output.push(value),
    stderr: (value) => errors.push(value),
  });

  assert.equal(code, 0);
  assert.equal(errors.length, 0);
  const result = JSON.parse(output[0]);
  assert.match(result.packageFile, /math-ageniti-0\.0\.0\.tgz$/);
});

test("cli publish performs a dry-run by default", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-cli-publish-"));
  const output = [];
  const errors = [];
  const cli = createCli({ name: "math", actions: [add] });
  const code = await cli.run([
    "publish",
    "--out-dir",
    path.join(tempDir, "bundle"),
    "--app-module",
    buildableAppModule,
    "--app-export",
    "app",
    "--package-name",
    "math-cli-publish",
    "--package-version",
    "3.0.0",
    "--public",
    "--access",
    "public",
  ], {
    stdout: (value) => output.push(value),
    stderr: (value) => errors.push(value),
  });

  assert.equal(code, 0);
  assert.equal(errors.length, 0);
  const result = JSON.parse(output[0]);
  assert.equal(result.published, "dry-run");
  assert.match(result.packageFile, /math-cli-publish-3\.0\.0\.tgz$/);
});

test("initProject scaffolds react and expo templates", async () => {
  const reactDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-init-react-"));
  const expoDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-init-expo-"));
  const nextDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-init-next-"));

  const reactResult = await initProject({ cwd: reactDir, template: "react" });
  const expoResult = await initProject({ cwd: expoDir, template: "expo" });
  const nextResult = await initProject({ cwd: nextDir, template: "next" });

  assert.equal(reactResult.files.some((file) => file.endsWith(path.join("src", "ageniti", "app.js"))), true);
  assert.equal(expoResult.files.some((file) => file.endsWith(path.join("src", "ageniti", "app.js"))), true);
  assert.equal(nextResult.files.some((file) => file.endsWith(path.join("src", "ageniti", "app.js"))), true);

  const expoReadme = await readFile(path.join(expoDir, "src", "ageniti", "README.md"), "utf8");
  assert.match(expoReadme, /Expo/);
  const nextReadme = await readFile(path.join(nextDir, "src", "ageniti", "README.md"), "utf8");
  assert.match(nextReadme, /Next\.js/);
});

test("doctorProject reports React project readiness", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ageniti-doctor-"));
  await writeFile(path.join(tempDir, "package.json"), JSON.stringify({
    name: "demo",
    dependencies: {
      react: "^19.0.0",
    },
  }, null, 2));

  const before = await doctorProject({ cwd: tempDir });
  assert.equal(before.ok, false);
  assert.equal(before.kind, "react");

  await initProject({ cwd: tempDir, template: "react" });
  const after = await doctorProject({ cwd: tempDir });

  assert.equal(after.kind, "react");
  assert.match(after.configPath ?? "", /ageniti\.config\.json$/);
  assert.equal(after.defaultAppModule, "./src/ageniti/app.js");
  assert.equal(after.checks.some((item) => item.code === "DEFAULT_APP_MODULE"), true);
});

test("mcp manifest filters destructive actions by default", () => {
  const destroy = defineAction({
    name: "destroy_record",
    description: "Destroy a record.",
    sideEffects: "destructive",
    input: s.object({ id: s.string() }),
    run() {
      return { ok: true };
    },
  });

  assert.equal(createMcpManifest([add, destroy]).tools.length, 1);
  assert.equal(createMcpManifest([add, destroy], { includeDestructive: true }).tools.length, 2);
});

test("lint reports risky action contracts", () => {
  const risky = defineAction({
    name: "risky_write",
    description: "Risky write action.",
    sideEffects: "write",
    input: s.object({ id: s.string() }),
    run() {
      return { ok: true };
    },
  });

  const result = lintActions([risky]);
  assert.equal(result.ok, true);
  assert.equal(result.findings.some((item) => item.code === "UNSPECIFIED_IDEMPOTENCY"), true);
  assert.equal(result.findings.some((item) => item.code === "WRITE_WITHOUT_PERMISSION"), true);
});

test("dev server exposes action manifest and invocation API", async (t) => {
  const runtime = createRuntime({ actions: [add] });
  const dev = createDevServer({ name: "math", actions: [add], runtime });
  let listener;

  try {
    listener = await dev.listen(0);
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Local port binding is not permitted in this sandbox.");
      return;
    }

    throw error;
  }

  try {
    const actionsResponse = await fetch(`${listener.url}/api/actions`);
    const actionsPayload = await actionsResponse.json();
    assert.equal(actionsPayload.actions[0].name, "add_numbers");

    const invokeResponse = await fetch(`${listener.url}/api/actions/add_numbers/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { a: 5, b: 7 } }),
    });
    const invokePayload = await invokeResponse.json();
    assert.equal(invokePayload.ok, true);
    assert.equal(invokePayload.data.sum, 12);
  } finally {
    await listener.close();
  }
});

test("ai sdk adapters expose OpenAI-compatible tool specs", () => {
  const tools = createOpenAITools([add]);
  assert.equal(tools[0].type, "function");
  assert.equal(tools[0].function.name, "add_numbers");
  assert.equal(tools[0].function.parameters.type, "object");
  assert.equal(tools[0].function.strict, true);

  const responsesTools = createOpenAIResponsesTools([add], { strict: false });
  assert.equal(responsesTools[0].type, "function");
  assert.equal(responsesTools[0].name, "add_numbers");
  assert.equal(responsesTools[0].strict, false);
});

test("llm adapters respect supported surfaces by default", () => {
  const cliOnly = defineAction({
    name: "cli_only",
    description: "CLI-only action.",
    supportedSurfaces: ["cli"],
    input: s.object({}),
    run() {
      return { ok: true };
    },
  });

  assert.equal(createOpenAITools([cliOnly]).length, 0);
  assert.equal(createOpenAIResponsesTools([cliOnly]).length, 0);
  assert.deepEqual(Object.keys(createAISDKTools([cliOnly])), []);
});

test("ai sdk adapters filter destructive actions by default", () => {
  const destroy = defineAction({
    name: "destroy_file",
    description: "Destroy a file.",
    sideEffects: "destructive",
    input: s.object({ path: s.string() }),
    run() {
      return { ok: true };
    },
  });

  assert.equal(createOpenAITools([add, destroy]).length, 1);
  assert.equal(createOpenAITools([add, destroy], { includeDestructive: true }).length, 2);
});

test("ai sdk tools execute through the shared runtime when provided", async () => {
  const runtime = createRuntime({ actions: [add] });
  const tools = createAISDKTools([add], { runtime });
  const data = await tools.add_numbers.execute({ a: 6, b: 4 });

  assert.deepEqual(data, { sum: 10 });

  const envelopeTools = createAISDKTools([add], { runtime, returnEnvelope: true });
  const envelope = await envelopeTools.add_numbers.execute({ a: 6, b: 4 });

  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, { sum: 10 });
});

test("ai sdk tools use runtime validation even without an explicit runtime", async () => {
  const tools = createAISDKTools([add]);
  const invalid = await tools.add_numbers.execute({ a: "6", b: 4 });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "VALIDATION_ERROR");
});

test("app factory exposes ai sdk adapters", async () => {
  const app = createAgenitiApp({ name: "math", actions: [add] });

  assert.equal(app.createOpenAITools()[0].function.name, "add_numbers");
  assert.equal(app.createOpenAIResponsesTools()[0].name, "add_numbers");
  assert.equal(app.createFunctionCallingManifest().aiSdkTools[0], "add_numbers");

  const tools = app.createAISDKTools();
  assert.deepEqual(await tools.add_numbers.execute({ a: 2, b: 8 }), { sum: 10 });
});
