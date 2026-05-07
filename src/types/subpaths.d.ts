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
  export { createSurfaceManifest, describeAction, diffActionManifests } from "../index.js";
}

declare module "@ageniti/core/json-runner" {
  export { createJsonRunner } from "../index.js";
}

declare module "@ageniti/core/lint" {
  export { lintActions } from "../index.js";
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
