import { createHash, randomUUID } from "node:crypto";
import { assertSchema, s } from "../schema/schema.js";

export const ERROR_CODES = Object.freeze({
  ACTION_NOT_FOUND: "ACTION_NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  OUTPUT_VALIDATION_ERROR: "OUTPUT_VALIDATION_ERROR",
  OUTPUT_SERIALIZATION_ERROR: "OUTPUT_SERIALIZATION_ERROR",
  AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
  AUTHORIZATION_ERROR: "AUTHORIZATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  TIMEOUT: "TIMEOUT",
  CANCELLED: "CANCELLED",
  CONFLICT: "CONFLICT",
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  UNSUPPORTED_SURFACE: "UNSUPPORTED_SURFACE",
  UNSAFE_ACTION: "UNSAFE_ACTION",
  CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
  CONCURRENCY_LIMIT: "CONCURRENCY_LIMIT",
});

const RESERVED_ACTION_NAMES = new Set([
  "actions", "manifest", "diff", "docs", "build", "package", "publish",
  "doctor", "init", "lint", "mcp", "dev", "help", "schema", "json",
]);

const DEFAULT_REDACT_KEYS = [
  "password", "passwd", "secret", "token", "apikey", "api_key",
  "authorization", "cookie", "session", "x-api-key", "access_token",
  "refresh_token", "private_key", "client_secret",
];

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

  if (RESERVED_ACTION_NAMES.has(config.name)) {
    throw new TypeError(
      `Action name "${config.name}" is reserved and would conflict with a CLI command. ` +
      `Reserved: ${[...RESERVED_ACTION_NAMES].join(", ")}.`
    );
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
    visibility: config.visibility ?? "public",
    sideEffects: config.sideEffects ?? "read",
    idempotency: config.idempotency ?? "unspecified",
    permissions: config.permissions ?? [],
    supportedSurfaces: config.supportedSurfaces ?? ["cli", "json", "http", "mcp", "react", "dev", "ai-sdk"],
    timeoutMs: config.timeoutMs,
    retry: normalizeRetry(config.retry),
    concurrency: normalizeConcurrency(config.concurrency),
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
  const hooks = options.hooks ?? {};
  const idempotencyCache = options.idempotencyCache ?? new Map();
  const inFlightIdempotency = new Map();
  const idempotencyTtlMs = options.idempotencyTtlMs ?? 5 * 60 * 1000;
  const idempotencyMaxEntries = options.idempotencyMaxEntries ?? 1000;
  const concurrencyState = new Map();
  const redactor = createRedactor(options.redact);

  return {
    registry,
    listActions({ surface } = {}) {
      const actions = [...registry.values()];
      if (!surface) {
        return actions;
      }

      return actions.filter((action) => action.supportedSurfaces.includes(surface));
    },
    stream(actionOrName, input = {}, invokeOptions = {}) {
      // Returns an async iterable of events. The runtime invocation runs
      // concurrently and pushes events through this queue. The final event
      // is always { type: "result", envelope } so consumers know when to stop.
      const queue = [];
      const waiters = [];
      let done = false;
      const streamController = new AbortController();
      const externalSignal = invokeOptions.signal;
      const abortFromExternal = () => streamController.abort(externalSignal?.reason);
      if (externalSignal) {
        if (externalSignal.aborted) {
          abortFromExternal();
        } else {
          externalSignal.addEventListener("abort", abortFromExternal, { once: true });
        }
      }
      const cleanup = () => {
        externalSignal?.removeEventListener?.("abort", abortFromExternal);
      };

      const emit = (event) => {
        if (done) return;
        if (waiters.length > 0) {
          const resolve = waiters.shift();
          resolve({ value: event, done: false });
        } else {
          queue.push(event);
        }
      };

      const finish = (event) => {
        emit(event);
        done = true;
        cleanup();
        // Resolve any waiters with done.
        while (waiters.length > 0) {
          const resolve = waiters.shift();
          resolve({ value: undefined, done: true });
        }
      };

      // Kick off invocation; collect events via emit.
      this.invoke(actionOrName, input, {
        ...invokeOptions,
        signal: streamController.signal,
        _streamEmit: emit,
      })
        .then((envelope) => finish({ type: "result", envelope }))
        .catch((error) => finish({ type: "result", envelope: failureEnvelope({
          code: ERROR_CODES.INTERNAL_ERROR,
          message: error?.message ?? String(error),
          startedAt: Date.now(),
          logs: [],
          artifacts: [],
        }) }));

      const next = () => {
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift(), done: false });
        }
        if (done) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => waiters.push(resolve));
      };

      return {
        [Symbol.asyncIterator]() { return this; },
        next,
        return: () => {
          done = true;
          streamController.abort("stream-consumer-returned");
          cleanup();
          while (waiters.length > 0) {
            const resolve = waiters.shift();
            resolve({ value: undefined, done: true });
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
    async invoke(actionOrName, input = {}, invokeOptions = {}) {
      const action = typeof actionOrName === "string" ? registry.get(actionOrName) : actionOrName;
      const startedAt = Date.now();
      const invocationId = invokeOptions.invocationId ?? randomUUID();
      const surface = invokeOptions.surface ?? "unknown";
      const logs = [];
      const artifacts = [];
      const streamEmit = typeof invokeOptions._streamEmit === "function" ? invokeOptions._streamEmit : undefined;
      let finalEnvelope;

      const finalize = (envelope) => {
        applyRedactionToEnvelope(envelope, redactor);
        if (typeof hooks.onInvocationEnd === "function") {
          try {
            hooks.onInvocationEnd({ action, surface, invocationId, envelope });
          } catch {
            // hook errors must never break invocation
          }
        }
        return envelope;
      };
      const settle = (envelope) => {
        finalEnvelope = finalize(envelope);
        return finalEnvelope;
      };

      if (!action) {
        return settle(failureEnvelope({
          code: ERROR_CODES.ACTION_NOT_FOUND,
          message: `Action "${actionOrName}" was not found.`,
          action: typeof actionOrName === "string" ? actionOrName : undefined,
          invocationId,
          surface,
          startedAt,
          logs,
          artifacts,
        }));
      }

      if (typeof hooks.onInvocationStart === "function") {
        try {
          hooks.onInvocationStart({ action, surface, invocationId, input });
        } catch {
          // hook errors must never break invocation
        }
      }

      if (!action.supportedSurfaces.includes(surface) && surface !== "unknown") {
        return settle(failureEnvelope({
          code: ERROR_CODES.UNSUPPORTED_SURFACE,
          message: `Action "${action.name}" does not support surface "${surface}".`,
          action: action.name,
          invocationId,
          surface,
          startedAt,
          logs,
          artifacts,
        }));
      }

      const inputResult = action.input.validate(input);
      if (!inputResult.ok) {
        return settle(failureEnvelope({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "Invalid action input.",
          issues: inputResult.issues,
          action: action.name,
          invocationId,
          surface,
          startedAt,
          logs,
          artifacts,
        }));
      }

      // External signal handling: chain user-provided signal so we can abort the
      // active attempt without permanently aborting future retries.
      const externalSignal = invokeOptions.signal;
      if (externalSignal?.aborted) {
        return finalize(failureEnvelope({
          code: ERROR_CODES.CANCELLED,
          message: "Action was cancelled before execution.",
          action: action.name,
          invocationId,
          surface,
          startedAt,
          logs,
          artifacts,
        }));
      }

      const baseSignal = externalSignal;

      const context = {
        invocationId,
        surface,
        user: invokeOptions.user,
        auth: invokeOptions.auth,
        env: invokeOptions.env ?? "development",
        services: invokeOptions.services ?? services,
        metadata: invokeOptions.metadata ?? {},
        signal: undefined, // populated per-attempt in runWithTimeout
        logger: createLogger(logs, redactor, streamEmit),
        artifacts: createArtifactCollector(artifacts, redactor, streamEmit),
        progress: createProgressReporter(logs, redactor, streamEmit),
        idempotencyKey: invokeOptions.idempotencyKey,
      };

      if (action.requiresConfirmation && invokeOptions.confirm !== true && surface !== "react" && surface !== "dev") {
        return settle(failureEnvelope({
          code: ERROR_CODES.CONFIRMATION_REQUIRED,
          message: `Action "${action.name}" requires explicit confirmation.`,
          action: action.name,
          invocationId,
          surface,
          startedAt,
          logs,
          artifacts,
        }));
      }

      const permission = await permissionChecker({
        action,
        input: inputResult.value,
        context,
      });

      if (permission !== true) {
        return settle(failureEnvelope({
          code: ERROR_CODES.AUTHORIZATION_ERROR,
          message: typeof permission === "string" ? permission : "Action is not authorized.",
          action: action.name,
          invocationId,
          surface,
          startedAt,
          logs,
          artifacts,
        }));
      }

      // Idempotency cache lookup (only for write/destructive + key + non-stream).
      const idempotencyScope = invokeOptions.idempotencyKey && action.sideEffects !== "read"
        ? createIdempotencyScope({
            action: action.name,
            idempotencyKey: invokeOptions.idempotencyKey,
            surface,
            input: inputResult.value,
            user: invokeOptions.user,
            auth: invokeOptions.auth,
            metadata: invokeOptions.metadata,
          })
        : undefined;

      if (idempotencyScope) {
        const cacheKey = idempotencyScope.cacheKey;
        const cached = idempotencyCache.get(cacheKey);
        if (cached) {
          if (cached.expiresAt > Date.now()) {
            // Refresh recency by re-inserting (Map iteration is insertion-order).
            idempotencyCache.delete(cacheKey);
            idempotencyCache.set(cacheKey, cached);
            return settle(createReplayEnvelope({
              envelope: cached.envelope,
              invocationId,
              surface,
              startedAt,
            }));
          }
          idempotencyCache.delete(cacheKey);
        }

        const pending = inFlightIdempotency.get(cacheKey);
        if (pending) {
          const sharedEnvelope = await pending.promise;
          return settle(createReplayEnvelope({
            envelope: sharedEnvelope,
            invocationId,
            surface,
            startedAt,
          }));
        }
      }

      const idempotencyExecution = idempotencyScope
        ? createIdempotencyExecution(idempotencyScope.cacheKey, inFlightIdempotency)
        : undefined;

      // Deprecated runtime warning.
      if (action.deprecated) {
        context.logger.warn("Action is deprecated.", {
          replacement: action.deprecation?.replacement,
          since: action.deprecation?.since,
          message: action.deprecation?.message,
        });
      }

      // Concurrency gate.
      const concurrency = action.concurrency;
      if (concurrency.max > 0) {
        const slot = concurrencyState.get(action.name) ?? { active: 0 };
        concurrencyState.set(action.name, slot);
        if (slot.active >= concurrency.max) {
          return settle(failureEnvelope({
            code: ERROR_CODES.CONCURRENCY_LIMIT,
            message: `Action "${action.name}" reached concurrency limit (${concurrency.max}).`,
            retryable: true,
            action: action.name,
            invocationId,
            surface,
            startedAt,
            logs,
            artifacts,
          }));
        }
        slot.active += 1;
      }

      try {
        const data = await runWithRetry({
          retry: invokeOptions.retry ?? action.retry,
          run: () => runWithTimeout({
            run: (signal) => {
              context.signal = signal;
              return runActionWithMiddleware({
                action,
                input: inputResult.value,
                context,
                middleware,
              });
            },
            timeoutMs: invokeOptions.timeoutMs ?? action.timeoutMs,
            externalSignal: baseSignal,
          }),
          logger: context.logger,
          signal: baseSignal,
        });

        const serializableCheck = checkJsonSerializable(data);
        if (!serializableCheck.ok) {
          return settle(failureEnvelope({
            code: ERROR_CODES.OUTPUT_SERIALIZATION_ERROR,
            message: `Action returned a value that cannot be safely serialized as JSON: ${serializableCheck.reason}`,
            action: action.name,
            invocationId,
            surface,
            startedAt,
            logs,
            artifacts,
          }));
        }

        const serializedData = data === undefined ? null : data;

        let envelope;
        if (action.output) {
          const outputResult = action.output.validate(serializedData);
          if (!outputResult.ok) {
            envelope = failureEnvelope({
              code: ERROR_CODES.OUTPUT_VALIDATION_ERROR,
              message: "Action returned invalid output.",
              issues: outputResult.issues,
              action: action.name,
              invocationId,
              surface,
              startedAt,
              logs,
              artifacts,
            });
          } else {
            envelope = successEnvelope({
              data: outputResult.value,
              action: action.name,
              invocationId,
              surface,
              startedAt,
              logs,
              artifacts,
            });
          }
        } else {
          envelope = successEnvelope({
            data: serializedData,
            action: action.name,
            invocationId,
            surface,
            startedAt,
            logs,
            artifacts,
          });
        }

        const finalizedEnvelope = settle(envelope);

        if (finalizedEnvelope.ok && idempotencyScope) {
          const cacheKey = idempotencyScope.cacheKey;
          idempotencyCache.set(cacheKey, {
            envelope: cloneRuntimeEnvelope(finalizedEnvelope),
            expiresAt: Date.now() + idempotencyTtlMs,
          });
          // Evict oldest entries past LRU cap. Map iterates in insertion order,
          // and we re-insert on hit, so the first key is the least-recently-used.
          while (idempotencyCache.size > idempotencyMaxEntries) {
            const oldest = idempotencyCache.keys().next().value;
            if (oldest === undefined) break;
            idempotencyCache.delete(oldest);
          }
        }

        return finalizedEnvelope;
      } catch (error) {
        const normalized = normalizeError(error);
        return settle(failureEnvelope({
          ...normalized,
          action: action.name,
          invocationId,
          surface,
          startedAt,
          logs,
          artifacts,
        }));
      } finally {
        if (idempotencyExecution) {
          finishIdempotencyExecution(idempotencyExecution, finalEnvelope);
        }
        if (concurrency.max > 0) {
          const slot = concurrencyState.get(action.name);
          if (slot) {
            slot.active = Math.max(0, slot.active - 1);
          }
        }
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
    commandName: action.name.replaceAll("_", "-"),
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

function createLogger(logs, redactor, emit) {
  const push = (level, message, fields) => {
    const entry = {
      level,
      message,
      time: new Date().toISOString(),
      fields: redactor(fields ?? {}),
    };
    logs.push(entry);
    emit?.({ type: "log", ...entry });
  };

  return {
    debug: (message, fields) => push("debug", message, fields),
    info: (message, fields) => push("info", message, fields),
    warn: (message, fields) => push("warn", message, fields),
    error: (message, fields) => push("error", message, fields),
  };
}

function createArtifactCollector(artifacts, redactor, emit) {
  return {
    add(artifact) {
      const normalized = {
        id: artifact.id ?? randomUUID(),
        type: artifact.type ?? "file",
        name: artifact.name,
        mimeType: artifact.mimeType,
        uri: artifact.uri,
        sizeBytes: artifact.sizeBytes,
        metadata: redactor(artifact.metadata ?? {}),
      };
      artifacts.push(normalized);
      emit?.({ type: "artifact", artifact: normalized });
      return normalized;
    },
  };
}

function createProgressReporter(logs, redactor, emit) {
  return {
    report(event) {
      const entry = {
        level: "info",
        message: event.message ?? "Progress update.",
        time: new Date().toISOString(),
        fields: redactor({
          type: "progress",
          percent: event.percent,
          ...event.fields,
        }),
      };
      logs.push(entry);
      emit?.({ type: "progress", message: entry.message, percent: event.percent, fields: entry.fields, time: entry.time });
    },
  };
}

async function runWithTimeout({ run, timeoutMs, externalSignal }) {
  // Each attempt gets its own controller so a previous timeout/external abort
  // does not poison subsequent retries.
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(externalSignal?.reason);

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  let timeoutId;
  let timedOut = false;

  try {
    if (!timeoutMs) {
      return await run(controller.signal);
    }

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new AgenitiError(ERROR_CODES.TIMEOUT, `Action timed out after ${timeoutMs}ms.`, { retryable: true }));
      }, timeoutMs);
    });

    return await Promise.race([run(controller.signal), timeoutPromise]);
  } catch (error) {
    if (controller.signal.aborted && !timedOut) {
      throw new AgenitiError(ERROR_CODES.CANCELLED, "Action was cancelled.", { retryable: false, cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener?.("abort", onExternalAbort);
    }
  }
}

async function runWithRetry({ run, retry, logger, signal }) {
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
      await delay(delayMs, signal);
    }
  }
}

async function runActionWithMiddleware({ action, input, context, middleware }) {
  let index = -1;

  async function dispatch(nextIndex) {
    if (nextIndex <= index) {
      throw new AgenitiError(ERROR_CODES.INTERNAL_ERROR, "Middleware called next() more than once.");
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

  if (error?.name === "AbortError" || error?.code === "ABORT_ERR") {
    return {
      code: ERROR_CODES.CANCELLED,
      message: "Action was cancelled.",
      retryable: false,
    };
  }

  return {
    code: ERROR_CODES.INTERNAL_ERROR,
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

function normalizeConcurrency(concurrency) {
  if (!concurrency) {
    return { max: 0 };
  }

  if (typeof concurrency === "number") {
    return { max: Math.max(0, Math.floor(concurrency)) };
  }

  return { max: Math.max(0, Math.floor(concurrency.max ?? 0)) };
}

function delay(ms, signal) {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  if (signal.aborted) {
    return Promise.reject(new AgenitiError(ERROR_CODES.CANCELLED, "Action was cancelled.", { retryable: false }));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new AgenitiError(ERROR_CODES.CANCELLED, "Action was cancelled.", { retryable: false }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createIdempotencyScope({ action, idempotencyKey, surface, input, user, auth, metadata }) {
  const fingerprint = stableHash({
    action,
    surface,
    input,
    caller: {
      user,
      auth,
    },
    metadata,
  });
  return {
    cacheKey: `${action}::${idempotencyKey}::${fingerprint}`,
  };
}

function createIdempotencyExecution(cacheKey, inFlightIdempotency) {
  const deferred = createDeferred();
  const entry = { cacheKey, inFlightIdempotency, deferred, promise: deferred.promise };
  inFlightIdempotency.set(cacheKey, entry);
  return entry;
}

function finishIdempotencyExecution(entry, envelope) {
  if (!entry) return;
  if (entry.inFlightIdempotency.get(entry.cacheKey) === entry) {
    entry.inFlightIdempotency.delete(entry.cacheKey);
  }
  entry.deferred.resolve(envelope ?? failureEnvelope({
    code: ERROR_CODES.CANCELLED,
    message: "Invocation was cancelled before completion.",
    startedAt: Date.now(),
    logs: [],
    artifacts: [],
  }));
}

function createReplayEnvelope({ envelope, invocationId, surface, startedAt }) {
  const replayed = cloneRuntimeEnvelope(envelope);
  replayed.meta = {
    ...replayed.meta,
    invocationId,
    surface,
    durationMs: Date.now() - startedAt,
    ...(replayed.ok ? { idempotent: "replayed" } : {}),
  };
  return replayed;
}

function cloneRuntimeEnvelope(envelope) {
  return structuredClone(envelope);
}

function createDeferred() {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function stableHash(value) {
  return createHash("sha256")
    .update(stableStringify(value))
    .digest("hex");
}

function stableStringify(value) {
  return JSON.stringify(normalizeForStableStringify(value));
}

function normalizeForStableStringify(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (t === "bigint") return value.toString();
  if (t === "symbol") return value.toString();
  if (t === "function") return "[Function]";

  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => normalizeForStableStringify(item, seen));
  }

  if (t === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeForStableStringify(value[key], seen);
    }
    return out;
  }

  return String(value);
}

function checkJsonSerializable(value) {
  if (value === undefined || value === null) {
    return { ok: true };
  }

  try {
    const seen = new WeakSet();
    const reason = walkSerializable(value, seen);
    if (reason) {
      return { ok: false, reason };
    }
    JSON.stringify(value);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "non-serializable value" };
  }
}

function walkSerializable(value, seen) {
  if (value === null || value === undefined) {
    return null;
  }

  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    return null;
  }

  if (t === "bigint") return "BigInt is not JSON-serializable";
  if (t === "symbol") return "Symbol is not JSON-serializable";
  if (t === "function") return "function values are not JSON-serializable";

  if (value instanceof Map) return "Map values are not JSON-serializable";
  if (value instanceof Set) return "Set values are not JSON-serializable";

  if (Array.isArray(value)) {
    if (seen.has(value)) return "circular reference detected";
    seen.add(value);
    for (const item of value) {
      const reason = walkSerializable(item, seen);
      if (reason) return reason;
    }
    return null;
  }

  if (t === "object") {
    if (seen.has(value)) return "circular reference detected";
    // Allow Date — it serializes as ISO string via JSON.stringify and round-trips
    // back as string. We accept this as the documented behavior.
    if (value instanceof Date) return null;
    seen.add(value);
    for (const [, v] of Object.entries(value)) {
      const reason = walkSerializable(v, seen);
      if (reason) return reason;
    }
  }

  return null;
}

function createRedactor(redact) {
  if (typeof redact === "function") {
    return redact;
  }

  const keys = new Set(
    [...DEFAULT_REDACT_KEYS, ...(redact?.keys ?? [])].map((key) => key.toLowerCase())
  );
  const placeholder = redact?.placeholder ?? "[REDACTED]";

  const visit = (value, seen) => {
    if (value === null || value === undefined) return value;
    if (typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => visit(item, seen));
    }

    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (keys.has(k.toLowerCase())) {
        out[k] = placeholder;
      } else if (v && typeof v === "object") {
        out[k] = visit(v, seen);
      } else {
        out[k] = v;
      }
    }
    return out;
  };

  return (value) => visit(value, new WeakSet());
}

function applyRedactionToEnvelope(envelope, redactor) {
  // Logs and artifact metadata are already redacted at write time.
  // Re-redact final-pass to be defensive against direct envelope mutations.
  if (Array.isArray(envelope.logs)) {
    for (const log of envelope.logs) {
      if (log.fields) {
        log.fields = redactor(log.fields);
      }
    }
  }
  if (Array.isArray(envelope.artifacts)) {
    for (const artifact of envelope.artifacts) {
      if (artifact.metadata) {
        artifact.metadata = redactor(artifact.metadata);
      }
    }
  }
  if (envelope.error) {
    if (typeof envelope.error.message === "string") {
      envelope.error.message = redactSecretsInString(envelope.error.message);
    }
    if (Array.isArray(envelope.error.issues)) {
      for (const issue of envelope.error.issues) {
        if (typeof issue.message === "string") {
          issue.message = redactSecretsInString(issue.message);
        }
      }
    }
  }
}

// Best-effort secret redactor for free-form strings. Targets the most common
// shapes (Bearer/JWT, sk-/pk-/ghp_-style tokens, key=value pairs). It is
// intentionally conservative — it cannot catch every case, but it should
// prevent the most obvious leaks from action error messages.
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._\-]+/gi,
  /\beyJ[A-Za-z0-9._-]{20,}\b/g, // JWT
  /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|xoxb|xoxp|xoxa)[_-][A-Za-z0-9_-]{12,}\b/g,
];

const SECRET_KV_KEYS = "(?:password|passwd|secret|token|apikey|api[_-]?key|authorization|cookie|session|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret)";
const SECRET_KV_PATTERN = new RegExp(`(${SECRET_KV_KEYS})\\s*[:=]\\s*"?([^"\\s,;]+)"?`, "gi");

function redactSecretsInString(input) {
  if (!input || typeof input !== "string") return input;
  let out = input.replace(SECRET_KV_PATTERN, (_, key) => `${key}=[REDACTED]`);
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}
