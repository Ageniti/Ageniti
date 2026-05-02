import { defaultSurfaceAdapters } from "./adapters.js";
import {
  createAISDKTools,
  createFunctionCallingManifest,
  createOpenAIResponsesTools,
  createOpenAITools,
} from "./ai-sdk.js";
import { buildArtifacts, packageArtifacts, publishArtifacts } from "./build.js";
import { createCli } from "./cli.js";
import { createRuntime } from "./core.js";
import { createDevServer } from "./dev-server.js";
import { createGuideDoc, exportDocs } from "./docs-export.js";
import { createHttpHandler, createHttpServer } from "./http.js";
import { createJsonRunner } from "./json-runner.js";
import { lintActions } from "./lint.js";
import { createSurfaceManifest } from "./manifest.js";
import { createMcpHandler, createMcpManifest } from "./mcp.js";
import { createReactActionAdapter } from "./react.js";

export function createAgenitiApp(options) {
  if (!options?.name) {
    throw new TypeError("createAgenitiApp() requires an app name.");
  }

  const actions = options.actions ?? [];
  const adapters = options.adapters ?? defaultSurfaceAdapters();
  const buildOptions = options.build ?? {};
  const appDescription = options.description;
  const appDocs = options.docs ?? {};
  const runtime = options.runtime ?? createRuntime({
    actions,
    services: options.services,
    permissionChecker: options.permissionChecker,
    middleware: options.middleware,
  });

  return {
    name: options.name,
    actions,
    adapters,
    runtime,
    manifest() {
      return createSurfaceManifest({
        appName: options.name,
        actions,
        adapters,
      });
    },
    lint() {
      return lintActions(actions);
    },
    actionManifest(manifestOptions) {
      return createSurfaceManifest({
        appName: options.name,
        actions,
        adapters,
        ...manifestOptions,
      }).actions;
    },
    createCli(cliOptions = {}) {
      return createCli({
        name: options.name,
        actions,
        runtime,
        adapters,
        buildOptions,
        description: appDescription,
        docs: appDocs,
        ...cliOptions,
      });
    },
    createMcpHandler(mcpOptions = {}) {
      return createMcpHandler({
        actions,
        runtime,
        ...mcpOptions,
      });
    },
    createMcpManifest() {
      return createMcpManifest(actions);
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
      return createOpenAITools(actions, aiOptions);
    },
    createOpenAIResponsesTools(aiOptions = {}) {
      return createOpenAIResponsesTools(actions, aiOptions);
    },
    createAISDKTools(aiOptions = {}) {
      return createAISDKTools(actions, {
        runtime,
        ...aiOptions,
      });
    },
    createFunctionCallingManifest(aiOptions = {}) {
      return createFunctionCallingManifest(actions, {
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
        appName: options.name,
        appDescription,
        docs: appDocs,
        actions,
        ...docOptions,
      });
    },
    exportDocs(docOptions = {}) {
      return exportDocs({
        appName: options.name,
        appDescription,
        docs: appDocs,
        actions,
        ...docOptions,
      });
    },
    build(artifactOptions = {}) {
      return buildArtifacts({
        appName: options.name,
        appDescription,
        docs: appDocs,
        actions,
        adapters,
        ...buildOptions,
        ...artifactOptions,
      });
    },
    package(packageOptions = {}) {
      return packageArtifacts({
        appName: options.name,
        appDescription,
        docs: appDocs,
        actions,
        adapters,
        ...buildOptions,
        ...packageOptions,
      });
    },
    publish(publishOptions = {}) {
      return publishArtifacts({
        appName: options.name,
        appDescription,
        docs: appDocs,
        actions,
        adapters,
        ...buildOptions,
        ...publishOptions,
      });
    },
  };
}
