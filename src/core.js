import { randomUUID } from "node:crypto";
import { assertSchema, s } from "./schema.js";

export class AgenitiError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "AgenitiError";
    this.code = code;
    this.issues = options.issues ?? [];
    this.retryable = Boolean(options.retryable);
    this.cause = options.cause;
  }
}


export function defineAction(config) {
  if (!config || typeof config !== "object") {
    throw new TypeError("defineAction() requires a config object.");
  }

  if (!config.name || typeof config.name !== "string") {
    throw new TypeError("Action requires a string name.");
  }

  if (!/^[a-z][a-z0-9_]*$/.test(config.name)) {
    throw new TypeError(`Action name "${config.name}" must use lowercase snake_case.`);
  }

  if (!config.description || typeof config.description !== "string") {
    throw new TypeError(`Action "${config.name}" requires a description.`);
  }

  if (typeof config.run !== "function") {
    throw new TypeError(`Action "${config.name}" requires a run(input, context) function.`);
  }

  return Object.freeze({
    name: config.name,
    version: config.version ?? "1.0.0",
    title: config.title ?? humanizeActionName(config.name),
    description: config.description,
    input: config.input ? assertSchema(config.input) : s.object({}),
    output: config.output ? assertSchema(config.output) : undefined,
    visibility: config.visibility ?? "local",
    sideEffects: config.sideEffects ?? "read",
    idempotency: config.idempotency ?? "unspecified",
    permissions: config.permissions ?? [],
    supportedSurfaces: config.supportedSurfaces ?? ["cli", "json", "http", "mcp", "react", "dev", "ai-sdk"],
    timeoutMs: config.timeoutMs,
    retry: normalizeRetry(config.retry),
    requiresConfirmation: Boolean(config.requiresConfirmation ?? config.sideEffects === "destructive"),
    metadata: config.metadata ?? {},
    publicMetadata: config.publicMetadata ?? {},
    docs: config.docs ?? {},
    deprecated: Boolean(config.deprecated),
    deprecation: normalizeDeprecation(config),
    run: config.run,
  });
}

export function createRuntime(options = {}) {
  const registry = createActionRegistry(options.actions ?? []);
  const services = options.services ?? {};
  const permissionChecker = options.permissionChecker ?? defaultPermissionChecker;
  const middleware = options.middleware ?? [];

  return {
    registry,
    listActions({ surface } = {}) {
      const actions = [...registry.values()];
      if (!surface) {
        return actions;
      }

      return actions.filter((action) => action.supportedSurfaces.includes(surface));
    },
    async invoke(actionOrName, input = {}, invokeOptions = {}) {
      const action = typeof actionOrName === "string" ? registry.get(actionOrName) : actionOrName;
      const startedAt = Date.now();
      const invocationId = invokeOptions.invocationId ?? randomUUID();
      const surface = invokeOptions.surface ?? "unknown";
      const logs = [];
      const artifacts = [];

      if (!action) {
        return failureEnvelope({
          code: "ACTION_NOT_FOUND",
          message: `Action "${actionOrName}" was not found.`,
          action: typeof actionOrName === "string" ? actionOrName : undefined,
          invocationId,
          surface,
          startedAt,
          logs,
          artifacts,
        });
      }

      if (!action.supportedSurfaces.includes(surface) && surface !== "unknown") {
        return failureEnvelope({
          code: "UNSUPPORTED_SURFACE",
          message: `Action "${action.name}" does not support surface "${surface}".`,
          action: action.name,
          invocationId,
          surface,
          startedAt,
          logs,
          artifacts,
        });
      }

      const inputResult = action.input.validate(input);
      if (!inputResult.ok) {
        return failureEnvelope({
          code: "VALIDATION_ERROR",
          message: "Invalid action input.",
          issues: inputResult.issues,
          action: action.name,
          invocationId,
          surface,
          startedAt,
          logs,
          artifacts,
        });
      }

      const controller = new AbortController();
      const context = {
        invocationId,
        surface,
        user: invokeOptions.user,
        auth: invokeOptions.auth,
        env: invokeOptions.env ?? "development",
        services: invokeOptions.services ?? services,
        metadata: invokeOptions.metadata ?? {},
        signal: invokeOptions.signal ?? controller.signal,
        logger: createLogger(logs),
        artifacts: createArtifactCollector(artifacts),
        progress: createProgressReporter(logs),
      };

      if (action.requiresConfirmation && invokeOptions.confirm !== true && surface !== "react" && surface !== "dev") {
        return failureEnvelope({
          code: "CONFIRMATION_REQUIRED",
          message: `Action "${action.name}" requires explicit confirmation.`,
          action: action.name,
          invocationId,
          surface,
          startedAt,
          logs,
          artifacts,
        });
      }

      const permission = await permissionChecker({
        action,
        input: inputResult.value,
        context,
      });

      if (permission !== true) {
        return failureEnvelope({
          code: "AUTHORIZATION_ERROR",
          message: typeof permission === "string" ? permission : "Action is not authorized.",
          action: action.name,
          invocationId,
          surface,
          startedAt,
          logs,
          artifacts,
        });
      }

      try {
        const data = await runWithRetry({
          retry: invokeOptions.retry ?? action.retry,
          run: () => runWithTimeout({
            run: () => runActionWithMiddleware({
              action,
              input: inputResult.value,
              context,
              middleware,
            }),
            timeoutMs: invokeOptions.timeoutMs ?? action.timeoutMs,
            controller,
          }),
          logger: context.logger,
        });

        if (!isJsonSerializable(data)) {
          return failureEnvelope({
            code: "OUTPUT_SERIALIZATION_ERROR",
            message: "Action returned a value that cannot be safely serialized as JSON.",
            action: action.name,
            invocationId,
            surface,
            startedAt,
            logs,
            artifacts,
          });
        }

        const serializedData = data === undefined ? null : data;

        if (action.output) {
          const outputResult = action.output.validate(serializedData);
          if (!outputResult.ok) {
            return failureEnvelope({
              code: "OUTPUT_VALIDATION_ERROR",
              message: "Action returned invalid output.",
              issues: outputResult.issues,
              action: action.name,
              invocationId,
              surface,
              startedAt,
              logs,
              artifacts,
            });
          }

          return successEnvelope({
            data: outputResult.value,
            action: action.name,
            invocationId,
            surface,
            startedAt,
            logs,
            artifacts,
          });
        }

        return successEnvelope({
          data: serializedData,
          timeoutMs: invokeOptions.timeoutMs ?? action.timeoutMs,
          action: action.name,
          invocationId,
          surface,
          startedAt,
          logs,
          artifacts,
        });
      } catch (error) {
        const normalized = normalizeError(error);
        return failureEnvelope({
          ...normalized,
          action: action.name,
          invocationId,
          surface,
          startedAt,
          logs,
          artifacts,
        });
      }
    },
  };
}

export function createActionRegistry(actions) {
  const registry = new Map();

  for (const action of actions) {
    if (registry.has(action.name)) {
      throw new Error(`Duplicate action name "${action.name}".`);
    }

    registry.set(action.name, action);
  }

  return registry;
}

export function createActionManifest(actions) {
  return actions.map((action) => ({
    name: action.name,
    version: action.version,
    title: action.title,
    description: action.description,
    inputSchema: action.input.toJSONSchema(),
    outputSchema: action.output?.toJSONSchema(),
    visibility: action.visibility,
    sideEffects: action.sideEffects,
    idempotency: action.idempotency,
    permissions: action.permissions,
    supportedSurfaces: action.supportedSurfaces,
    timeoutMs: action.timeoutMs,
    retry: action.retry,
    requiresConfirmation: action.requiresConfirmation,
    metadata: action.metadata,
    publicMetadata: action.publicMetadata,
    docs: action.docs,
    deprecated: action.deprecated,
    deprecation: action.deprecation,
  }));
}

function normalizeDeprecation(config) {
  if (!config.deprecated && !config.deprecation) {
    return undefined;
  }

  if (typeof config.deprecation === "string") {
    return { message: config.deprecation };
  }

  return {
    message: config.deprecation?.message ?? config.deprecationMessage,
    since: config.deprecation?.since,
    removeAfter: config.deprecation?.removeAfter,
    replacement: config.deprecation?.replacement ?? config.replacement,
  };
}

function createLogger(logs) {
  const push = (level, message, fields) => {
    logs.push({
      level,
      message,
      time: new Date().toISOString(),
      fields: fields ?? {},
    });
  };

  return {
    debug: (message, fields) => push("debug", message, fields),
    info: (message, fields) => push("info", message, fields),
    warn: (message, fields) => push("warn", message, fields),
    error: (message, fields) => push("error", message, fields),
  };
}

function createArtifactCollector(artifacts) {
  return {
    add(artifact) {
      const normalized = {
        id: artifact.id ?? randomUUID(),
        type: artifact.type ?? "file",
        name: artifact.name,
        mimeType: artifact.mimeType,
        uri: artifact.uri,
        sizeBytes: artifact.sizeBytes,
        metadata: artifact.metadata ?? {},
      };
      artifacts.push(normalized);
      return normalized;
    },
  };
}

function createProgressReporter(logs) {
  return {
    report(event) {
      logs.push({
        level: "info",
        message: event.message ?? "Progress update.",
        time: new Date().toISOString(),
        fields: {
          type: "progress",
          percent: event.percent,
          ...event.fields,
        },
      });
    },
  };
}

async function runWithTimeout({ run, timeoutMs, controller }) {
  if (!timeoutMs) {
    return run();
  }

  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new AgenitiError("TIMEOUT", `Action timed out after ${timeoutMs}ms.`, { retryable: true }));
    }, timeoutMs);
  });

  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runWithRetry({ run, retry, logger }) {
  const policy = normalizeRetry(retry);
  let attempt = 0;

  while (true) {
    try {
      return await run();
    } catch (error) {
      const normalized = normalizeError(error);
      const canRetry = normalized.retryable && attempt < policy.retries;

      if (!canRetry) {
        throw error;
      }

      attempt += 1;
      const delayMs = policy.delayMs * attempt;
      logger.warn("Retrying action after retryable failure.", {
        attempt,
        code: normalized.code,
        delayMs,
      });
      await delay(delayMs);
    }
  }
}

async function runActionWithMiddleware({ action, input, context, middleware }) {
  let index = -1;

  async function dispatch(nextIndex) {
    if (nextIndex <= index) {
      throw new AgenitiError("INTERNAL_ERROR", "Middleware called next() more than once.");
    }

    index = nextIndex;
    const layer = middleware[nextIndex];

    if (!layer) {
      return action.run(input, context);
    }

    return layer({ action, input, context, next: () => dispatch(nextIndex + 1) });
  }

  return dispatch(0);
}

function normalizeError(error) {
  if (error instanceof AgenitiError) {
    return {
      code: error.code,
      message: error.message,
      issues: error.issues,
      retryable: error.retryable,
    };
  }

  if (error?.name === "AbortError") {
    return {
      code: "CANCELLED",
      message: "Action was cancelled.",
      retryable: false,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Unknown internal error.",
    retryable: false,
  };
}

function successEnvelope({ data, action, invocationId, surface, startedAt, logs, artifacts }) {
  return {
    ok: true,
    data,
    artifacts,
    logs,
    meta: {
      action,
      invocationId,
      surface,
      durationMs: Date.now() - startedAt,
    },
  };
}

function failureEnvelope({ code, message, issues = [], retryable = false, action, invocationId, surface, startedAt, logs, artifacts }) {
  return {
    ok: false,
    error: {
      code,
      message,
      issues,
      retryable,
    },
    artifacts,
    logs,
    meta: {
      action,
      invocationId,
      surface,
      durationMs: Date.now() - startedAt,
    },
  };
}

function humanizeActionName(name) {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function defaultPermissionChecker() {
  return true;
}

function normalizeRetry(retry) {
  if (retry === true) {
    return { retries: 2, delayMs: 100 };
  }

  if (!retry) {
    return { retries: 0, delayMs: 0 };
  }

  return {
    retries: retry.retries ?? 0,
    delayMs: retry.delayMs ?? 100,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isJsonSerializable(value) {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}
