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
  shape: Record<string, Schema>;
  passthrough(): this;
}
export interface LiteralSchema<T extends JsonPrimitive> extends Schema<T> {}
export interface UnionSchema<T> extends Schema<T> {}
export interface RecordSchema<T> extends Schema<Record<string, T>> {}

export const s: {
  string(): StringSchema;
  number(): NumberSchema;
  boolean(): BooleanSchema;
  enum<T extends readonly JsonPrimitive[]>(values: T): EnumSchema<T>;
  array<T>(itemSchema: Schema<T>): ArraySchema<T>;
  literal<T extends JsonPrimitive>(value: T): LiteralSchema<T>;
  union<T extends readonly Schema[]>(options: T): UnionSchema<unknown>;
  record<T>(valueSchema: Schema<T>): RecordSchema<T>;
  object<T extends Record<string, Schema>>(shape: T): ObjectSchema<{ [K in keyof T]: unknown }>;
  any(): Schema<unknown>;
};

export class SchemaValidationError extends Error {
  issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]);
}

export function toJSONSchema(schema: Schema): JsonObject;

export type SurfaceName = "cli" | "json" | "mcp" | "react" | "dev" | string;
export type Visibility = "private" | "local" | "agent" | "public" | string;
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

export interface Action<I = unknown, O = unknown> extends Required<Omit<ActionConfig<I, O>, "input" | "output" | "timeoutMs" | "retry" | "run" | "deprecation" | "deprecationMessage" | "replacement">> {
  input: Schema<I>;
  output?: Schema<O>;
  timeoutMs?: number;
  retry: Required<RetryPolicy>;
  deprecation?: { message?: string; since?: string; removeAfter?: string; replacement?: string };
  run(input: I, context: ActionContext): O | Promise<O>;
}

export function defineAction<I = unknown, O = unknown>(config: ActionConfig<I, O>): Action<I, O>;

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
  };
}

export type RuntimeResult<T = unknown> = RuntimeSuccess<T> | RuntimeFailure;

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
}

export interface ActionRuntime {
  registry: Map<string, Action>;
  listActions(options?: { surface?: SurfaceName }): Action[];
  invoke<T = unknown>(actionOrName: string | Action, input?: unknown, options?: RuntimeInvokeOptions): Promise<RuntimeResult<T>>;
}

export interface RuntimeOptions {
  actions?: Action[];
  services?: Record<string, unknown>;
  permissionChecker?: (request: { action: Action; input: unknown; context: ActionContext }) => boolean | string | Promise<boolean | string>;
  middleware?: Array<(request: { action: Action; input: unknown; context: ActionContext; next: () => Promise<unknown> }) => Promise<unknown>>;
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
  metadata: Record<string, unknown>;
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

export function createCli(options: { name?: string; description?: string; docs?: AppDocs; actions?: Action[]; runtime?: ActionRuntime; runtimeOptions?: RuntimeOptions; env?: string; adapters?: SurfaceAdapter[]; buildOptions?: Omit<BuildOptions, "targets" | "cwd"> }): Cli;

export type BuildTarget = "manifest" | "cli" | "mcp" | "docs" | "bundle";

export interface PackageMetadata {
  name?: string;
  version?: string;
  description?: string;
  private?: boolean;
  license?: string;
  keywords?: string[];
  binName?: string;
  mcpServerName?: string;
}

export interface BuildOptions {
  targets?: BuildTarget[];
  appDescription?: string;
  docs?: AppDocs;
  outDir?: string;
  appModule?: string;
  appExport?: string;
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

export function buildArtifacts(options: BuildOptions & { appName: string; actions: Action[]; adapters?: SurfaceAdapter[] }): Promise<BuildResult>;

export interface PackageResult {
  ok: true;
  outDir: string;
  packageDir: string;
  packageFile?: string;
  build: BuildResult;
}

export function packageArtifacts(options: BuildOptions & { appName: string; actions: Action[]; adapters?: SurfaceAdapter[]; dryRun?: boolean }): Promise<PackageResult>;
export function createGuideDoc(options: { appName: string; appDescription?: string; docs?: AppDocs; actions?: Action[] }): string;
export function exportDocs(options: { appName: string; appDescription?: string; docs?: AppDocs; actions?: Action[]; cwd?: string; outDir?: string; filename?: string }): Promise<ExportDocsResult>;

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

export function publishArtifacts(options: PublishOptions & { appName: string; actions: Action[]; adapters?: SurfaceAdapter[] }): Promise<PublishResult>;

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface HttpHandlerOptions {
  actions?: Action[];
  runtime?: ActionRuntime;
  runtimeOptions?: RuntimeOptions;
  basePath?: string;
  includePrivate?: boolean;
  includeDestructive?: boolean;
}

export function createHttpHandler(options?: HttpHandlerOptions): (request: {
  method?: string;
  path?: string;
  url?: string;
  headers?: Record<string, unknown>;
  body?: Record<string, unknown>;
}) => Promise<HttpResponse>;

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
  template: "react" | "expo" | "next";
  cwd: string;
  files: string[];
  appModule: string;
  nextSteps: string[];
}

export function loadProjectConfig(options?: { cwd?: string }): Promise<{ build?: BuildOptions; mcp?: { transport?: string; env?: Record<string, string> }; package?: PackageMetadata; configPath: string } | undefined>;
export function findDefaultAppModule(options?: { cwd?: string; config?: { build?: BuildOptions } }): Promise<{ found: boolean; modulePath?: string; reason: "configured" | "node-safe-default" | "typescript-only-entry" | "missing" }>;
export function detectTypeScriptRuntime(options?: { packageJson?: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }; config?: { build?: BuildOptions } }): string | undefined;
export function supportsTypeScriptEntrypoints(options?: { packageJson?: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }; config?: { build?: BuildOptions } }): boolean;
export function doctorProject(options?: { cwd?: string }): Promise<ProjectDoctorResult>;
export function initProject(options?: { cwd?: string; template?: "react" | "expo" | "next"; force?: boolean }): Promise<InitProjectResult>;

export function createJsonRunner(options: { actions?: Action[]; runtime?: ActionRuntime; runtimeOptions?: RuntimeOptions }): {
  runtime: ActionRuntime;
  invoke(payload: { action: string; input?: unknown; confirm?: boolean; user?: unknown; auth?: unknown; metadata?: Record<string, unknown> }): Promise<RuntimeResult>;
};

export function createMcpManifest(actions: Action[], options?: { includePrivate?: boolean; includeDestructive?: boolean }): { tools: unknown[] };
export function createMcpHandler(options: { actions?: Action[]; runtime?: ActionRuntime; runtimeOptions?: RuntimeOptions; includePrivate?: boolean; includeDestructive?: boolean }): (request: unknown) => Promise<unknown>;
export function createMcpStdioServer(options: { actions?: Action[]; runtime?: ActionRuntime; runtimeOptions?: RuntimeOptions }): {
  start(options?: { input?: any; output?: any }): Promise<void>;
};

export interface LlmToolAdapterOptions {
  runtime?: ActionRuntime;
  strict?: boolean;
  includePrivate?: boolean;
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
  openaiChatTools: OpenAIChatTool[];
  openaiResponsesTools: OpenAIResponsesTool[];
  aiSdkTools: string[];
};

export function createReactActionAdapter(options?: { actions?: Action[]; runtime?: ActionRuntime }): {
  runtime: ActionRuntime;
  useAction<I = unknown, O = unknown>(action: Action<I, O>): (input: I, options?: RuntimeInvokeOptions) => Promise<RuntimeResult<O>>;
};

export function createDevServer(options: { name?: string; actions?: Action[]; runtime: ActionRuntime }): {
  server: unknown;
  listen(port?: number, host?: string): Promise<{ port: number; host: string; url: string; close(): Promise<void> }>;
};

export function describeAction(action: Action): ActionDescription;
export function diffActionManifests(previous: ActionDescription[] | { actions: ActionDescription[] }, next: ActionDescription[] | { actions: ActionDescription[] }): {
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
export function createSurfaceManifest(options: { appName: string; actions: Action[]; adapters?: SurfaceAdapter[] }): {
  name: string;
  generatedAt: string;
  actions: ActionDescription[];
  surfaces: Array<{ name: string; description: string; capabilities: Record<string, unknown> }>;
};

export function lintActions(actions: Action[]): {
  ok: boolean;
  findings: Array<{ level: "error" | "warning"; action: string; code: string; message: string }>;
};

export interface AgenitiApp {
  name: string;
  actions: Action[];
  adapters: SurfaceAdapter[];
  runtime: ActionRuntime;
  manifest(): ReturnType<typeof createSurfaceManifest>;
  actionManifest(): ActionDescription[];
  lint(): ReturnType<typeof lintActions>;
  createCli(options?: Partial<Parameters<typeof createCli>[0]>): Cli;
  createMcpHandler(options?: Partial<Parameters<typeof createMcpHandler>[0]>): ReturnType<typeof createMcpHandler>;
  createMcpManifest(): ReturnType<typeof createMcpManifest>;
  createJsonRunner(options?: Partial<Parameters<typeof createJsonRunner>[0]>): ReturnType<typeof createJsonRunner>;
  createHttpHandler(options?: HttpHandlerOptions): ReturnType<typeof createHttpHandler>;
  createHttpServer(options?: HttpHandlerOptions): ReturnType<typeof createHttpServer>;
  createOpenAITools(options?: LlmToolAdapterOptions): OpenAIChatTool[];
  createOpenAIResponsesTools(options?: LlmToolAdapterOptions): OpenAIResponsesTool[];
  createAISDKTools(options?: LlmToolAdapterOptions): Record<string, AISDKTool>;
  createFunctionCallingManifest(options?: LlmToolAdapterOptions): ReturnType<typeof createFunctionCallingManifest>;
  createReactAdapter(options?: Parameters<typeof createReactActionAdapter>[0]): ReturnType<typeof createReactActionAdapter>;
  createDevServer(options?: Partial<Parameters<typeof createDevServer>[0]>): ReturnType<typeof createDevServer>;
  createGuideDoc(options?: { docs?: AppDocs }): string;
  exportDocs(options?: { cwd?: string; outDir?: string; filename?: string }): Promise<ExportDocsResult>;
  build(options?: BuildOptions): Promise<BuildResult>;
  package(options?: BuildOptions & { dryRun?: boolean }): Promise<PackageResult>;
  publish(options?: PublishOptions): Promise<PublishResult>;
}

export function createAgenitiApp(options: RuntimeOptions & { name: string; description?: string; docs?: AppDocs; adapters?: SurfaceAdapter[]; build?: Omit<BuildOptions, "targets" | "cwd"> }): AgenitiApp;
