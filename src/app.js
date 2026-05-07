import { defaultSurfaceAdapters } from "./adapters.js";
import {
  createAISDKTools,
  createFunctionCallingManifest,
  createOpenAIResponsesTools,
  createOpenAITools,
} from "./ai-sdk.js";
import { buildArtifacts, packageArtifacts, publishArtifacts } from "./tooling/build.js";
import { createCli } from "./tooling/cli.js";
import { createRuntime } from "./runtime/core.js";
import { createDevServer } from "./dev-server.js";
import { createGuideDoc, exportDocs } from "./tooling/docs-export.js";
import { createHttpHandler, createHttpServer } from "./transports/http.js";
import { createJsonRunner } from "./json-runner.js";
import { lintActions } from "./tooling/lint.js";
import { createActionManifest, createSurfaceManifest } from "./runtime/manifest.js";
import { createMcpHandler, createMcpManifest } from "./transports/mcp.js";
import { createReactActionAdapter } from "./react.js";

export function createAgenitiApp(options) {
  if (!options?.name) {
    throw new TypeError("createAgenitiApp() requires an app name.");
  }

  const {
    name,
    description: appDescription,
    docs: appDocs = {},
    attribution,
    adapters = defaultSurfaceAdapters(),
    build: buildOptions = {},
    actions: providedActions,
    runtime: providedRuntime,
    services,
    permissionChecker,
    middleware,
    hooks,
    redact,
    idempotencyCache,
    idempotencyTtlMs,
    idempotencyMaxEntries,
  } = options;
  const runtime = providedRuntime ?? createRuntime({
    actions: providedActions ?? [],
    services,
    permissionChecker,
    middleware,
    hooks,
    redact,
    idempotencyCache,
    idempotencyTtlMs,
    idempotencyMaxEntries,
  });
  const actions = providedActions ?? Array.from(runtime.registry.values());

  return {
    name,
    actions,
    adapters,
    runtime,
    manifest(manifestOptions = {}) {
      return createSurfaceManifest({
        appName: name,
        actions,
        adapters,
        attribution,
        ...manifestOptions,
      });
    },
    lint() {
      return lintActions(actions);
    },
    actionManifest(manifestOptions) {
      return createActionManifest(actions, manifestOptions);
    },
    createCli(cliOptions = {}) {
      return createCli({
        name,
        actions,
        runtime,
        adapters,
        buildOptions,
        description: appDescription,
        docs: appDocs,
        attribution,
        ...cliOptions,
      });
    },
    createMcpHandler(mcpOptions = {}) {
      return createMcpHandler({
        actions,
        runtime,
        attribution,
        ...mcpOptions,
      });
    },
    createMcpManifest(manifestOptions = {}) {
      return createMcpManifest(actions, {
        attribution,
        ...manifestOptions,
      });
    },
    createJsonRunner(jsonOptions = {}) {
      return createJsonRunner({
        actions,
        runtime,
        ...jsonOptions,
      });
    },
    createHttpHandler(httpOptions = {}) {
      return createHttpHandler({
        actions,
        runtime,
        ...httpOptions,
      });
    },
    createHttpServer(httpOptions = {}) {
      return createHttpServer({
        actions,
        runtime,
        ...httpOptions,
      });
    },
    createOpenAITools(aiOptions = {}) {
      return createOpenAITools(actions, {
        attribution,
        ...aiOptions,
      });
    },
    createOpenAIResponsesTools(aiOptions = {}) {
      return createOpenAIResponsesTools(actions, {
        attribution,
        ...aiOptions,
      });
    },
    createAISDKTools(aiOptions = {}) {
      return createAISDKTools(actions, {
        attribution,
        runtime,
        ...aiOptions,
      });
    },
    createFunctionCallingManifest(aiOptions = {}) {
      return createFunctionCallingManifest(actions, {
        attribution,
        runtime,
        ...aiOptions,
      });
    },
    createReactAdapter(reactOptions = {}) {
      return createReactActionAdapter({
        actions,
        runtime,
        ...reactOptions,
      });
    },
    createDevServer(devOptions = {}) {
      return createDevServer({
        name: options.name,
        actions,
        runtime,
        ...devOptions,
      });
    },
    createGuideDoc(docOptions = {}) {
      return createGuideDoc({
        appName: name,
        appDescription,
        docs: appDocs,
        actions,
        attribution,
        ...docOptions,
      });
    },
    exportDocs(docOptions = {}) {
      return exportDocs({
        appName: name,
        appDescription,
        docs: appDocs,
        actions,
        attribution,
        ...docOptions,
      });
    },
    build(artifactOptions = {}) {
      return buildArtifacts({
        appName: name,
        appDescription,
        docs: appDocs,
        actions,
        adapters,
        attribution,
        ...buildOptions,
        ...artifactOptions,
      });
    },
    package(packageOptions = {}) {
      return packageArtifacts({
        appName: name,
        appDescription,
        docs: appDocs,
        actions,
        adapters,
        attribution,
        ...buildOptions,
        ...packageOptions,
      });
    },
    publish(publishOptions = {}) {
      return publishArtifacts({
        appName: name,
        appDescription,
        docs: appDocs,
        actions,
        adapters,
        attribution,
        ...buildOptions,
        ...publishOptions,
      });
    },
  };
}
