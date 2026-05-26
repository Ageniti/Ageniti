declare module "@ageniti/core/ai-sdk" {
  export { createAISDKTools, createFunctionCallingManifest, createOpenAIResponsesTools, createOpenAITools } from "../index.js";
}

declare module "@ageniti/core/adapters" {
  export { aiSdkAdapter, cliAdapter, defaultSurfaceAdapters, defineSurfaceAdapter, devAdapter, findAdapter, httpAdapter, jsonAdapter, mcpAdapter, reactAdapter } from "../index.js";
}

declare module "@ageniti/core/app" {
  export { createAgenitiApp } from "../index.js";
  export type { AgenitiApp, CreateAgenitiAppOptions } from "../index.js";
}

declare module "@ageniti/core/cli" {
  export { createCli } from "../index.js";
}

declare module "@ageniti/core/core" {
  export { AgenitiError, ERROR_CODES, createActionManifest, createActionRegistry, createRuntime, defineAction } from "../index.js";
}

declare module "@ageniti/core/dev" {
  export { createDevServer } from "../index.js";
}

declare module "@ageniti/core/http" {
  import type { HttpHandlerOptions, HttpRequestShape, HttpResponse } from "../index.js";

  export type { HttpHandlerOptions, HttpRequestShape, HttpResponse } from "../index.js";

  export function createHttpHandler(options?: HttpHandlerOptions): (request: HttpRequestShape) => Promise<HttpResponse>;
  export function createHttpServer(options?: HttpHandlerOptions): {
    server: unknown;
    listen(port?: number, host?: string): Promise<{ port: number; host: string; url: string; close(): Promise<void> }>;
  };
  export function parseRequestBody(request: AsyncIterable<Uint8Array>, options?: { maxBodyBytes?: number }): Promise<unknown>;
  export function sendJson(response: { writeHead(statusCode: number, headers: Record<string, unknown>): void; end(body: string): void }, payload: unknown, statusCode?: number, headers?: Record<string, unknown>): void;
  export function sendText(response: { writeHead(statusCode: number, headers: Record<string, unknown>): void; end(body: string): void }, body: string, contentType?: string, statusCode?: number, headers?: Record<string, unknown>): void;
}

declare module "@ageniti/core/manifest" {
  import type { Action, ActionDescription, AppAttribution, SurfaceAdapter, ManifestDiff, SurfaceManifest, ManifestOptions } from "../index.js";

  export function describeAction(action: Action): ActionDescription;
  export function diffActionManifests(
    previous: ActionDescription[] | { actions: ActionDescription[] },
    next: ActionDescription[] | { actions: ActionDescription[] },
  ): ManifestDiff;
  export function createSurfaceManifest(
    options: { appName: string; actions: Action[]; adapters?: SurfaceAdapter[]; attribution?: AppAttribution } & ManifestOptions,
  ): SurfaceManifest;
}

declare module "@ageniti/core/json-runner" {
  export { createJsonRunner } from "../index.js";
}

declare module "@ageniti/core/lint" {
  import type { Action, LintResult } from "../index.js";

  export function lintActions(actions: Action[]): LintResult;
}

declare module "@ageniti/core/mcp" {
  export { createMcpHandler, createMcpManifest, createMcpStdioServer } from "../index.js";
}

declare module "@ageniti/core/react" {
  export { createReactActionAdapter, makeInvoker, streamAction } from "../index.js";
}

declare module "@ageniti/core/react-hooks" {
  import type { Action, ActionRuntime, RuntimeInvokeOptions, RuntimeResult, UseActionState } from "../index.js";

  export type { UseActionState } from "../index.js";

  export function useAction<I = unknown, O = unknown>(
    action: Action<I, O>,
    options: { runtime: ActionRuntime },
  ): UseActionState<O> & {
    invoke(input: I, options?: RuntimeInvokeOptions): Promise<RuntimeResult<O>>;
  };
}

declare module "@ageniti/core/schema" {
  import type { Schema } from "../index.js";

  export { SchemaValidationError, s } from "../index.js";

  export function isSchema(value: unknown): value is Schema;
  export function assertSchema<T extends Schema = Schema>(value: unknown, message?: string): T;
  export function toJSONSchema(schema: unknown): Record<string, unknown>;
}

declare module "@ageniti/core/schema-adapter" {
  import type { Schema, WrapSchemaOptions } from "../index.js";

  export type { WrapSchemaOptions } from "../index.js";

  export function wrapSchema(schema: unknown, options?: WrapSchemaOptions): Schema;
  export function isZodLike(value: unknown): boolean;
  export function isStandardSchemaV1(value: unknown): boolean;
  export function zodToJsonSchema(zod: unknown): Record<string, unknown>;
}

declare module "@ageniti/core/client" {
  export { AgenitiClientError, createClient } from "../index.js";
}

declare module "@ageniti/core/client-gen" {
  export { generateClientTypes, jsonSchemaToTs } from "../index.js";
}

declare module "@ageniti/core/test-utils" {
  export { collectStream, createTestRuntime, expectError, expectLog, expectOk, stubAction } from "../index.js";
}

declare module "@ageniti/core/handlers" {
  export { actionFromHandler, actionsFromHandlers, defineActions } from "../index.js";
}

declare module "@ageniti/core/build" {
  import type {
    Action,
    AppAttribution,
    AppDocs,
    BuildOptions,
    BuildResult,
    PackageMetadata,
    PackageResult,
    PublishOptions,
    PublishResult,
    SurfaceAdapter,
  } from "../index.js";

  export type {
    BuildOptions,
    BuildResult,
    PackageMetadata,
    PackageResult,
    PublishOptions,
    PublishResult,
  } from "../index.js";

  export function buildArtifacts(
    options: BuildOptions & { appName: string; actions: Action[]; adapters?: SurfaceAdapter[] },
  ): Promise<BuildResult>;
  export function packageArtifacts(
    options: BuildOptions & { appName: string; actions: Action[]; adapters?: SurfaceAdapter[]; dryRun?: boolean },
  ): Promise<PackageResult>;
  export function publishArtifacts(
    options: PublishOptions & { appName: string; actions: Action[]; adapters?: SurfaceAdapter[] },
  ): Promise<PublishResult>;
}

declare module "@ageniti/core/docs" {
  import type { Action, AppAttribution, AppDocs, ExportDocsResult } from "../index.js";

  export type { ExportDocsResult } from "../index.js";

  export function createGuideDoc(options: {
    appName: string;
    appDescription?: string;
    docs?: AppDocs;
    actions?: Action[];
    attribution?: AppAttribution;
  }): string;

  export function exportDocs(options: {
    appName: string;
    appDescription?: string;
    docs?: AppDocs;
    actions?: Action[];
    attribution?: AppAttribution;
    cwd?: string;
    outDir?: string;
    filename?: string;
  }): Promise<ExportDocsResult>;
}

declare module "@ageniti/core/project" {
  import type {
    AppAttribution,
    BuildOptions,
    InitProjectResult,
    PackageMetadata,
    ProjectDoctorResult,
  } from "../index.js";

  export type { InitProjectResult, ProjectDoctorResult } from "../index.js";

  export function loadProjectConfig(options?: { cwd?: string }): Promise<
    | {
        attribution?: AppAttribution;
        build?: BuildOptions;
        mcp?: { transport?: string; env?: Record<string, string> };
        package?: PackageMetadata;
        configPath: string;
      }
    | undefined
  >;
  export function findDefaultAppModule(options?: {
    cwd?: string;
    config?: { build?: BuildOptions };
  }): Promise<{
    found: boolean;
    modulePath?: string;
    reason: "configured" | "node-safe-default" | "typescript-only-entry" | "missing";
  }>;
  export function detectTypeScriptRuntime(options?: {
    packageJson?: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    config?: { build?: BuildOptions };
  }): string | undefined;
  export function supportsTypeScriptEntrypoints(options?: {
    packageJson?: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    config?: { build?: BuildOptions };
  }): boolean;
  export function doctorProject(options?: { cwd?: string }): Promise<ProjectDoctorResult>;
  export function initProject(options?: {
    cwd?: string;
    template?: "react" | "expo" | "next" | "host-openai" | "host-ai-sdk" | "host-mcp" | "host-http";
    force?: boolean;
  }): Promise<InitProjectResult>;
}
