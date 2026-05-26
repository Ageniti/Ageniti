export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface ValidationIssue {
  path: Array<string | number>;
  message: string;
}

export interface ValidationResult<T = unknown> {
  ok: boolean;
  value?: T;
  issues?: ValidationIssue[];
}

export interface Schema<T = unknown> {
  kind: string;
  description?: string;
  defaultValue?: T;
  isOptional: boolean;
  isNullable: boolean;
  describe(description: string): this;
  default(value: T): this;
  optional(): this;
  nullable(): this;
  meta(metadata: Record<string, unknown>): this;
  validate(value: unknown, path?: Array<string | number>): ValidationResult<T>;
  parse(value: unknown): T;
  toJSONSchema(): JsonObject;
}

export interface StringSchema extends Schema<string> {
  min(length: number): this;
  max(length: number): this;
  pattern(pattern: RegExp): this;
  url(): this;
  datetime(): this;
}

export interface NumberSchema extends Schema<number> {
  min(value: number): this;
  max(value: number): this;
  int(): this;
}

export interface BooleanSchema extends Schema<boolean> {}
export interface EnumSchema<T extends readonly JsonPrimitive[]> extends Schema<T[number]> {}
export interface ArraySchema<T> extends Schema<T[]> {}
export interface ObjectSchema<T extends Record<string, unknown>> extends Schema<T> {
  shape: { [K in keyof T]: Schema<T[K]> };
  passthrough(): this;
  strict(): this;
}
export interface LiteralSchema<T extends JsonPrimitive> extends Schema<T> {}
export interface UnionSchema<T> extends Schema<T> {}
export interface RecordSchema<T> extends Schema<Record<string, T>> {}

// Extract the static type carried by a Schema.
export type Infer<S> =
  S extends Schema<infer T> ? T :
  // Zod-style schema duck-typing
  S extends { _output: infer T } ? T :
  S extends { _type: infer T } ? T :
  // Standard Schema v1
  S extends { "~standard": { types: { output: infer T } } } ? T :
  unknown;

export const s: {
  string(): StringSchema;
  number(): NumberSchema;
  boolean(): BooleanSchema;
  enum<T extends readonly JsonPrimitive[]>(values: T): EnumSchema<T>;
  array<T>(itemSchema: Schema<T>): ArraySchema<T>;
  literal<T extends JsonPrimitive>(value: T): LiteralSchema<T>;
  union<T extends readonly Schema[]>(options: T): UnionSchema<unknown>;
  record<T>(valueSchema: Schema<T>): RecordSchema<T>;
  // Infer field types from each property's schema so `defineAction({ input: s.object({ a: s.string() }) }).run`
  // gets `{ a: string }` for free.
  object<T extends Record<string, Schema<any>>>(shape: T): ObjectSchema<{ [K in keyof T]: T[K] extends Schema<infer U> ? U : never }>;
  any(): Schema<unknown>;
};

export class SchemaValidationError extends Error {
  issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]);
}

export function toJSONSchema(schema: Schema): JsonObject;

export type SurfaceName = "cli" | "json" | "http" | "mcp" | "react" | "dev" | "ai-sdk" | string;
export type Visibility = "private" | "local" | "public" | string;
export type SideEffects = "read" | "write" | "destructive" | string;
export type Idempotency = "idempotent" | "non_idempotent" | "conditional" | "unspecified" | string;

export interface Artifact {
  id?: string;
  type?: string;
  name?: string;
  mimeType?: string;
  uri?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface LogEntry {
  level: "debug" | "info" | "warn" | "error" | string;
  message: string;
  time: string;
  fields: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface ArtifactCollector {
  add(artifact: Artifact): Required<Pick<Artifact, "id" | "type" | "metadata">> & Artifact;
}

export interface ProgressReporter {
  report(event: { message?: string; percent?: number; fields?: Record<string, unknown> }): void;
}

export interface ActionContext {
  invocationId: string;
  surface: SurfaceName;
  user?: unknown;
  auth?: { permissions?: string[]; [key: string]: unknown };
  env: string;
  services: Record<string, unknown>;
  metadata: Record<string, unknown>;
  signal: AbortSignal;
  logger: Logger;
  artifacts: ArtifactCollector;
  progress: ProgressReporter;
}

export interface RetryPolicy {
  retries?: number;
  delayMs?: number;
}

export interface ActionDocs {
  whenToUse?: string;
  whenNotToUse?: string;
  usageNotes?: string[];
  inputExample?: JsonValue;
  outputExample?: JsonValue;
}

export interface AppDocs {
  summary?: string;
  audience?: string;
  whenToUse?: string[];
  quickStart?: string[];
  setup?: string[];
  operationalNotes?: string[];
  sections?: Array<{ title: string; content: string }>;
  examples?: Array<{ title: string; description?: string; action?: string; input?: JsonValue }>;
}

export interface AppAttribution {
  text: string;
  url?: string;
  vendor?: string;
  product?: string;
  docsUrl?: string;
  licenseNotice?: string;
}

export interface ExportDocsResult {
  ok: true;
  outDir: string;
  files: Array<{ kind: "guide-doc"; path: string }>;
}

export interface ActionConfig<I = unknown, O = unknown> {
  name: string;
  version?: string;
  title?: string;
  description: string;
  input?: Schema<I>;
  output?: Schema<O>;
  visibility?: Visibility;
  sideEffects?: SideEffects;
  idempotency?: Idempotency;
  permissions?: string[];
  supportedSurfaces?: SurfaceName[];
  timeoutMs?: number;
  retry?: boolean | RetryPolicy;
  concurrency?: number | { max?: number };
  requiresConfirmation?: boolean;
  metadata?: Record<string, unknown>;
  publicMetadata?: Record<string, unknown>;
  docs?: ActionDocs;
  deprecated?: boolean;
  deprecation?: string | { message?: string; since?: string; removeAfter?: string; replacement?: string };
  deprecationMessage?: string;
  replacement?: string;
  run(input: I, context: ActionContext): O | Promise<O>;
}

export interface Action<I = unknown, O = unknown> extends Required<Omit<ActionConfig<I, O>, "input" | "output" | "timeoutMs" | "retry" | "concurrency" | "run" | "deprecation" | "deprecationMessage" | "replacement">> {
  input: Schema<I>;
  output?: Schema<O>;
  timeoutMs?: number;
  retry: Required<RetryPolicy>;
  concurrency: { max: number };
  deprecation?: { message?: string; since?: string; removeAfter?: string; replacement?: string };
  run(input: I, context: ActionContext): O | Promise<O>;
}

// Two overloads: pass schemas to get full inference, or pass generics manually.
export function defineAction<S, OS = undefined, O = OS extends undefined ? unknown : Infer<OS>>(
  config: Omit<ActionConfig<Infer<S>, O>, "input" | "output"> & {
    input?: S;
    output?: OS;
    run(input: Infer<S>, context: ActionContext): O | Promise<O>;
    concurrency?: number | { max?: number };
  },
): Action<Infer<S>, O>;
export function defineAction<I = unknown, O = unknown>(config: ActionConfig<I, O>): Action<I, O>;

// ---------- Bulk-registration helpers ----------

export function actionFromHandler<I = unknown, O = unknown>(
  handler: (input: I, context?: ActionContext) => O | Promise<O>,
  config: Omit<ActionConfig<I, O>, "run">,
): Action<I, O>;

export function defineActions(
  map: Record<string, ActionConfig<any, any> | ((input: any, ctx?: ActionContext) => any)>,
  options?: {
    defaults?: Partial<Omit<ActionConfig, "name" | "run">>;
    rename?: (key: string) => string;
  },
): Action[];

export function actionsFromHandlers(
  handlers: Record<string, (input: any, ctx?: ActionContext) => any>,
  metadata?: Record<string, Partial<Omit<ActionConfig, "name" | "run">>>,
): Action[];

// ---------- Foreign schema interop ----------

export interface WrapSchemaOptions {
  jsonSchema?: JsonObject;
  description?: string;
}

export function wrapSchema(schema: unknown, options?: WrapSchemaOptions): Schema;
export function isZodLike(value: unknown): boolean;
export function isStandardSchemaV1(value: unknown): boolean;
export function zodToJsonSchema(schema: unknown): JsonObject;

export class AgenitiError extends Error {
  code: string;
  issues: ValidationIssue[];
  retryable: boolean;
  constructor(code: string, message: string, options?: { issues?: ValidationIssue[]; retryable?: boolean; cause?: unknown });
}


export interface RuntimeSuccess<T = unknown> {
  ok: true;
  data: T;
  artifacts: Artifact[];
  logs: LogEntry[];
  meta: {
    action?: string;
    invocationId: string;
    surface: SurfaceName;
    durationMs: number;
    idempotent?: "replayed";
  };
}

export interface RuntimeFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    issues: ValidationIssue[];
    retryable: boolean;
  };
  artifacts: Artifact[];
  logs: LogEntry[];
  meta: {
    action?: string;
    invocationId?: string;
    surface?: SurfaceName;
    durationMs: number;
    idempotent?: "replayed";
  };
}

export type RuntimeResult<T = unknown> = RuntimeSuccess<T> | RuntimeFailure;

export type RuntimeStreamEvent<T = unknown> =
  | { type: "log"; level: string; message: string; time: string; fields: Record<string, unknown> }
  | { type: "artifact"; artifact: Artifact }
  | { type: "progress"; message?: string; percent?: number; fields?: Record<string, unknown>; time: string }
  | { type: "result"; envelope: RuntimeResult<T> };

export interface RuntimeInvokeOptions {
  invocationId?: string;
  surface?: SurfaceName;
  user?: unknown;
  auth?: unknown;
  env?: string;
  services?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  retry?: RetryPolicy;
  confirm?: boolean;
  idempotencyKey?: string;
}

export interface ActionRuntime {
  registry: Map<string, Action>;
  listActions(options?: { surface?: SurfaceName }): Action[];
  invoke<T = unknown>(actionOrName: string | Action, input?: unknown, options?: RuntimeInvokeOptions): Promise<RuntimeResult<T>>;
  stream<T = unknown>(actionOrName: string | Action, input?: unknown, options?: RuntimeInvokeOptions): AsyncIterableIterator<RuntimeStreamEvent<T>>;
}

export interface RuntimeOptions {
  actions?: Action[];
  services?: Record<string, unknown>;
  permissionChecker?: (request: { action: Action; input: unknown; context: ActionContext }) => boolean | string | Promise<boolean | string>;
  middleware?: Array<(request: { action: Action; input: unknown; context: ActionContext; next: () => Promise<unknown> }) => Promise<unknown>>;
  hooks?: {
    onInvocationStart?: (event: { action: Action; surface: SurfaceName; invocationId: string; input: unknown }) => void;
    onInvocationEnd?: (event: { action: Action; surface: SurfaceName; invocationId: string; envelope: RuntimeResult }) => void;
  };
  redact?: ((value: unknown) => unknown) | { keys?: string[]; placeholder?: string };
  idempotencyCache?: Map<string, unknown>;
  idempotencyTtlMs?: number;
  idempotencyMaxEntries?: number;
}

export function createRuntime(options?: RuntimeOptions): ActionRuntime;
export function createActionRegistry(actions: Action[]): Map<string, Action>;
export function createActionManifest(actions: Action[]): ActionDescription[];

export interface ActionDescription {
  name: string;
  version: string;
  commandName: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  visibility: Visibility;
  sideEffects: SideEffects;
  idempotency: Idempotency;
  permissions: string[];
  supportedSurfaces: SurfaceName[];
  timeoutMs?: number;
  retry: Required<RetryPolicy>;
  requiresConfirmation: boolean;
  publicMetadata: Record<string, unknown>;
  docs: ActionDocs;
  deprecated: boolean;
  deprecation?: { message?: string; since?: string; removeAfter?: string; replacement?: string };
}

export interface SurfaceAdapter {
  name: string;
  description: string;
  capabilities: Record<string, unknown>;
  canExpose(action: Action): boolean;
  describe(action: Action): unknown;
}

export function defineSurfaceAdapter(adapter: Partial<SurfaceAdapter> & Pick<SurfaceAdapter, "name">): SurfaceAdapter;
export function defaultSurfaceAdapters(): SurfaceAdapter[];
export function findAdapter(adapters: SurfaceAdapter[], name: string): SurfaceAdapter | undefined;
export const cliAdapter: SurfaceAdapter;
export const aiSdkAdapter: SurfaceAdapter;
export const jsonAdapter: SurfaceAdapter;
export const httpAdapter: SurfaceAdapter;
export const mcpAdapter: SurfaceAdapter;
export const reactAdapter: SurfaceAdapter;
export const devAdapter: SurfaceAdapter;

export interface Cli {
  name: string;
  actions: Action[];
  runtime: ActionRuntime;
  run(argv?: string[], io?: { stdout(value: string): void; stderr(value: string): void }): Promise<number>;
  main(argv?: string[], io?: { stdout(value: string): void; stderr(value: string): void }): Promise<number>;
}

export function createCli(options: { name?: string; description?: string; docs?: AppDocs; attribution?: AppAttribution; actions?: Action[]; runtime?: ActionRuntime; runtimeOptions?: RuntimeOptions; env?: string; adapters?: SurfaceAdapter[]; buildOptions?: Omit<BuildOptions, "targets" | "cwd"> }): Cli;

export type BuildTarget = "manifest" | "cli" | "mcp" | "docs" | "bundle";

export interface PackageMetadata {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  private?: boolean;
  license?: string;
  keywords?: string[];
  binName?: string;
  mcpServerName?: string;
}

export interface BuildOptions {
  targets?: BuildTarget[];
  appDescription?: string;
  attribution?: AppAttribution;
  docs?: AppDocs;
  outDir?: string;
  appModule?: string;
  appExport?: string;
  filename?: string;
  includePackageJson?: boolean;
  typescriptRuntime?: "tsx" | string;
  cwd?: string;
  package?: PackageMetadata;
}

export interface BuiltArtifactFile {
  kind: "manifest" | "cli" | "mcp" | "mcp-descriptor" | "package-json" | "actions" | "bundle-report" | "readme" | "guide-doc";
  path: string;
  executable: boolean;
}

export interface BuildResult {
  ok: true;
  name: string;
  outDir: string;
  targets: BuildTarget[];
  files: BuiltArtifactFile[];
  report: {
    schemaVersion: 1;
    name: string;
    generatedAt: string;
    outDir: string;
    targets: BuildTarget[];
    source?: { appModule: string; appExport: string };
    files: Array<{ kind: string; filename: string; relativePath: string; executable: boolean }>;
    commands: { cli?: string; mcp?: string; pack?: string };
  };
}

// Moved to "@ageniti/core/build" — see src/types/subpaths.d.ts

export interface PackageResult {
  ok: true;
  outDir: string;
  packageDir: string;
  packageFile?: string;
  build: BuildResult;
}

// packageArtifacts moved to "@ageniti/core/build"
// createGuideDoc, exportDocs moved to "@ageniti/core/docs"

export interface PublishOptions extends BuildOptions {
  dryRun?: boolean;
  access?: "public" | "restricted" | string;
  tag?: string;
  registry?: string;
}

export interface PublishResult {
  ok: true;
  outDir: string;
  packageDir: string;
  packageFile?: string;
  published: "dry-run" | "live";
  stdout: string;
  stderr: string;
  build: BuildResult;
}

// publishArtifacts moved to "@ageniti/core/build"

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface HttpRequestShape {
  method?: string;
  path?: string;
  url?: string;
  headers?: Record<string, unknown>;
  body?: unknown;
  user?: unknown;
  auth?: unknown;
  metadata?: Record<string, unknown>;
}

export interface HttpHandlerOptions {
  actions?: Action[];
  runtime?: ActionRuntime;
  runtimeOptions?: RuntimeOptions;
  basePath?: string;
  maxBodyBytes?: number;
  requireJsonContentType?: boolean;
  includePrivate?: boolean;
  includeLocal?: boolean;
  includeDestructive?: boolean;
  resolveContext?: (request: { request: HttpRequestShape; body: unknown }) => {
    user?: unknown;
    auth?: unknown;
    metadata?: Record<string, unknown>;
  } | Promise<{
    user?: unknown;
    auth?: unknown;
    metadata?: Record<string, unknown>;
  }>;
}

export interface ManifestOptions {
  surface?: SurfaceName;
  includePrivate?: boolean;
  includeLocal?: boolean;
  includeDestructive?: boolean;
}

export function createHttpHandler(options?: HttpHandlerOptions): (request: HttpRequestShape) => Promise<HttpResponse>;

export function createHttpServer(options?: HttpHandlerOptions): {
  server: unknown;
  listen(port?: number, host?: string): Promise<{ port: number; host: string; url: string; close(): Promise<void> }>;
};

export interface ProjectDoctorResult {
  ok: boolean;
  kind: "expo" | "next" | "react" | "node";
  cwd: string;
  configPath?: string;
  defaultAppModule?: string;
  typescriptRuntime?: string;
  checks: Array<{ level: "info" | "warning"; code: string; message: string }>;
  recommendations: string[];
}

export interface InitProjectResult {
  ok: true;
  template: "react" | "expo" | "next" | "host-openai" | "host-ai-sdk" | "host-mcp" | "host-http";
  cwd: string;
  files: string[];
  appModule: string;
  nextSteps: string[];
}

// loadProjectConfig, findDefaultAppModule, detectTypeScriptRuntime,
// supportsTypeScriptEntrypoints, doctorProject, initProject all moved to
// "@ageniti/core/project" — see src/types/subpaths.d.ts

export function createJsonRunner(options: { actions?: Action[]; runtime?: ActionRuntime; runtimeOptions?: RuntimeOptions }): {
  runtime: ActionRuntime;
  invoke(payload: { action: string; input?: unknown; confirm?: boolean; user?: unknown; auth?: unknown; metadata?: Record<string, unknown> }): Promise<RuntimeResult>;
};

export function createMcpManifest(actions: Action[], options?: { attribution?: AppAttribution; includePrivate?: boolean; includeLocal?: boolean; includeDestructive?: boolean }): { attribution?: AppAttribution; tools: unknown[] };
export function createMcpHandler(options: { actions?: Action[]; attribution?: AppAttribution; runtime?: ActionRuntime; runtimeOptions?: RuntimeOptions; includePrivate?: boolean; includeLocal?: boolean; includeDestructive?: boolean }): (request: unknown) => Promise<unknown>;
export function createMcpStdioServer(options: { actions?: Action[]; attribution?: AppAttribution; runtime?: ActionRuntime; runtimeOptions?: RuntimeOptions; framing?: "auto" | "content-length" | "newline"; maxFrameBytes?: number; onError?: (error: unknown) => void }): {
  start(options?: { input?: any; output?: any }): Promise<void>;
};

export interface LlmToolAdapterOptions {
  runtime?: ActionRuntime;
  attribution?: AppAttribution;
  strict?: boolean;
  includePrivate?: boolean;
  includeLocal?: boolean;
  includeDestructive?: boolean;
  surface?: SurfaceName;
  returnEnvelope?: boolean;
  filter?: (action: Action) => boolean;
}

export interface OpenAIChatTool {
  type: "function";
  metadata?: Record<string, unknown>;
  function: {
    name: string;
    description: string;
    parameters: JsonObject;
    strict: boolean;
  };
}

export interface OpenAIResponsesTool {
  type: "function";
  name: string;
  description: string;
  parameters: JsonObject;
  strict: boolean;
  metadata?: Record<string, unknown>;
}

export interface AISDKTool {
  description: string;
  metadata?: Record<string, unknown>;
  parameters: Schema;
  inputSchema: JsonObject;
  execute(input: unknown, options?: RuntimeInvokeOptions): Promise<unknown>;
}

export function createOpenAITools(actions: Action[], options?: LlmToolAdapterOptions): OpenAIChatTool[];
export function createOpenAIResponsesTools(actions: Action[], options?: LlmToolAdapterOptions): OpenAIResponsesTool[];
export function createAISDKTools(actions: Action[], options?: LlmToolAdapterOptions): Record<string, AISDKTool>;
export function createFunctionCallingManifest(actions: Action[], options?: LlmToolAdapterOptions): {
  attribution?: AppAttribution;
  openaiChatTools: OpenAIChatTool[];
  openaiResponsesTools: OpenAIResponsesTool[];
  aiSdkTools: string[];
};

export function createReactActionAdapter(options?: { actions?: Action[]; runtime?: ActionRuntime }): {
  runtime: ActionRuntime;
  useAction<I = unknown, O = unknown>(action: Action<I, O>): (input: I, options?: RuntimeInvokeOptions) => Promise<RuntimeResult<O>>;
};
export function makeInvoker<I = unknown, O = unknown>(action: Action<I, O>, options?: { actions?: Action[]; runtime?: ActionRuntime }): (input: I, options?: RuntimeInvokeOptions) => Promise<RuntimeResult<O>>;
export function streamAction<T = unknown>(runtime: ActionRuntime, action: Action | string, input: unknown, options?: RuntimeInvokeOptions): AsyncIterableIterator<RuntimeStreamEvent<T>>;

// React hook with full streaming state machine. Imported via the
// `@ageniti/core/react-hooks` subpath, which has React as a peer dep.
export interface UseActionState<O = unknown> {
  status: "idle" | "loading" | "success" | "error" | "cancelled";
  data: O | null;
  error: { code: string; message: string; issues: ValidationIssue[]; retryable: boolean } | null;
  logs: LogEntry[];
  artifacts: Artifact[];
  progress: { percent?: number; message?: string } | null;
  invoke(input: unknown, options?: RuntimeInvokeOptions): Promise<RuntimeResult<O>>;
  cancel(): void;
  reset(): void;
}

export function createDevServer(options: { name?: string; actions?: Action[]; runtime: ActionRuntime }): {
  server: unknown;
  listen(port?: number, host?: string): Promise<{ port: number; host: string; url: string; close(): Promise<void> }>;
};

// describeAction, diffActionManifests, createSurfaceManifest moved to "@ageniti/core/manifest"
// lintActions moved to "@ageniti/core/lint"
// See src/types/subpaths.d.ts for declarations.
export type ManifestDiff = {
  ok: boolean;
  summary: { breaking: number; warnings: number; info: number };
  changes: Array<{
    type: "added" | "removed" | "changed" | "deprecated";
    severity: "breaking" | "warning" | "info";
    action: string;
    field?: string;
    before?: unknown;
    after?: unknown;
    message: string;
  }>;
};

export type SurfaceManifest = {
  name: string;
  generatedAt: string;
  attribution?: AppAttribution;
  actions: ActionDescription[];
  surfaces: Array<{ name: string; description: string; capabilities: Record<string, unknown> }>;
};

export type LintResult = {
  ok: boolean;
  findings: Array<{ level: "error" | "warning"; action: string; code: string; message: string }>;
};

export interface AgenitiApp {
  name: string;
  actions: Action[];
  adapters: SurfaceAdapter[];
  runtime: ActionRuntime;
  manifest(options?: ManifestOptions): ReturnType<typeof createSurfaceManifest>;
  actionManifest(options?: ManifestOptions): ActionDescription[];
  lint(): ReturnType<typeof lintActions>;
  createCli(options?: Partial<Parameters<typeof createCli>[0]>): Cli;
  createMcpHandler(options?: Partial<Parameters<typeof createMcpHandler>[0]>): ReturnType<typeof createMcpHandler>;
  createMcpManifest(options?: Parameters<typeof createMcpManifest>[1]): ReturnType<typeof createMcpManifest>;
  createJsonRunner(options?: Partial<Parameters<typeof createJsonRunner>[0]>): ReturnType<typeof createJsonRunner>;
  createHttpHandler(options?: HttpHandlerOptions): ReturnType<typeof createHttpHandler>;
  createHttpServer(options?: HttpHandlerOptions): ReturnType<typeof createHttpServer>;
  createOpenAITools(options?: LlmToolAdapterOptions): OpenAIChatTool[];
  createOpenAIResponsesTools(options?: LlmToolAdapterOptions): OpenAIResponsesTool[];
  createAISDKTools(options?: LlmToolAdapterOptions): Record<string, AISDKTool>;
  createFunctionCallingManifest(options?: LlmToolAdapterOptions): ReturnType<typeof createFunctionCallingManifest>;
  createReactAdapter(options?: Parameters<typeof createReactActionAdapter>[0]): ReturnType<typeof createReactActionAdapter>;
  createDevServer(options?: Partial<Parameters<typeof createDevServer>[0]>): ReturnType<typeof createDevServer>;
  createGuideDoc(options?: Partial<Parameters<typeof createGuideDoc>[0]>): string;
  exportDocs(options?: Partial<Parameters<typeof exportDocs>[0]>): Promise<ExportDocsResult>;
  build(options?: BuildOptions): Promise<BuildResult>;
  package(options?: BuildOptions & { dryRun?: boolean }): Promise<PackageResult>;
  publish(options?: PublishOptions): Promise<PublishResult>;
}

export interface CreateAgenitiAppOptions extends RuntimeOptions {
  name: string;
  description?: string;
  docs?: AppDocs;
  attribution?: AppAttribution;
  adapters?: SurfaceAdapter[];
  build?: Omit<BuildOptions, "targets" | "cwd">;
  runtime?: ActionRuntime;
}

export function createAgenitiApp(options: CreateAgenitiAppOptions): AgenitiApp;

// ---------- Error code constants ----------

export const ERROR_CODES: {
  readonly ACTION_NOT_FOUND: "ACTION_NOT_FOUND";
  readonly VALIDATION_ERROR: "VALIDATION_ERROR";
  readonly OUTPUT_VALIDATION_ERROR: "OUTPUT_VALIDATION_ERROR";
  readonly OUTPUT_SERIALIZATION_ERROR: "OUTPUT_SERIALIZATION_ERROR";
  readonly AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR";
  readonly AUTHORIZATION_ERROR: "AUTHORIZATION_ERROR";
  readonly RATE_LIMITED: "RATE_LIMITED";
  readonly TIMEOUT: "TIMEOUT";
  readonly CANCELLED: "CANCELLED";
  readonly CONFLICT: "CONFLICT";
  readonly EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR";
  readonly INTERNAL_ERROR: "INTERNAL_ERROR";
  readonly UNSUPPORTED_SURFACE: "UNSUPPORTED_SURFACE";
  readonly UNSAFE_ACTION: "UNSAFE_ACTION";
  readonly CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED";
  readonly CONCURRENCY_LIMIT: "CONCURRENCY_LIMIT";
};

// ---------- Typed client ----------

export class AgenitiClientError extends Error {
  code?: string;
  issues: ValidationIssue[];
  retryable: boolean;
  envelope?: RuntimeFailure;
  cause?: unknown;
  constructor(envelope?: RuntimeFailure, details?: { code?: string; message?: string; retryable?: boolean; cause?: unknown });
}

export interface ClientTransport {
  invoke(name: string, input: unknown, options?: RuntimeInvokeOptions & { raw?: boolean }): Promise<RuntimeResult>;
  stream?(name: string, input: unknown, options?: RuntimeInvokeOptions): AsyncIterable<RuntimeStreamEvent>;
}

export interface CreateClientOptions {
  runtime?: ActionRuntime;
  url?: string;
  transport?: ClientTransport;
  surface?: SurfaceName;
  basePath?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export type AgenitiClient = {
  $invoke<T = unknown>(name: string, input: unknown, options?: RuntimeInvokeOptions & { raw?: boolean }): Promise<T | RuntimeResult<T>>;
  $stream<T = unknown>(name: string, input: unknown, options?: RuntimeInvokeOptions): AsyncIterable<RuntimeStreamEvent<T>>;
  $transport: ClientTransport;
} & Record<string, (input?: unknown, options?: RuntimeInvokeOptions & { raw?: boolean }) => Promise<unknown>>;

export function createClient(options: CreateClientOptions): AgenitiClient;
export function generateClientTypes(actions: Action[], options?: { interfaceName?: string; importFrom?: string }): string;
export function jsonSchemaToTs(schema: unknown, indent?: number): string;

// ---------- Test utilities ----------

export interface TestRuntime {
  runtime: ActionRuntime;
  invoke(name: string, input?: unknown, options?: RuntimeInvokeOptions): Promise<RuntimeResult>;
  stream(name: string, input?: unknown, options?: RuntimeInvokeOptions): AsyncIterableIterator<RuntimeStreamEvent>;
}

export function createTestRuntime(actions: Action[], options?: {
  services?: Record<string, unknown>;
  middleware?: RuntimeOptions["middleware"];
  hooks?: RuntimeOptions["hooks"];
  allow?: boolean | string | RuntimeOptions["permissionChecker"];
  redact?: RuntimeOptions["redact"];
  idempotencyCache?: Map<string, unknown>;
}): TestRuntime;
export function expectOk<T = unknown>(envelope: RuntimeResult<T>): T;
export function expectError(envelope: RuntimeResult, expectedCode?: string): RuntimeFailure["error"];
export function expectLog(envelope: RuntimeResult, predicate: string | RegExp | ((log: LogEntry) => boolean)): LogEntry;
export function collectStream<T = unknown>(stream: AsyncIterable<RuntimeStreamEvent<T>>): Promise<RuntimeStreamEvent<T>[]>;
export function stubAction(name: string, options?: Partial<Action>): Action;
