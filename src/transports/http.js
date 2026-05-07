import nodeHttp from "node:http";
import { canExposeAction } from "../runtime/exposure.js";
import { createActionManifest } from "../runtime/manifest.js";
import { pickInvocationInput, resolveRuntimeAndActions } from "./surface-utils.js";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

const ERROR_STATUS_MAP = {
  VALIDATION_ERROR: 400,
  OUTPUT_VALIDATION_ERROR: 502,
  OUTPUT_SERIALIZATION_ERROR: 502,
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_ERROR: 403,
  CONFIRMATION_REQUIRED: 409,
  ACTION_NOT_FOUND: 404,
  UNSUPPORTED_SURFACE: 405,
  RATE_LIMITED: 429,
  CONCURRENCY_LIMIT: 429,
  CONFLICT: 409,
  EXTERNAL_SERVICE_ERROR: 502,
  TIMEOUT: 504,
  CANCELLED: 499,
  UNSAFE_ACTION: 403,
  INTERNAL_ERROR: 500,
};

export function createHttpHandler(options = {}) {
  const { runtime, actions } = resolveRuntimeAndActions(options);
  const basePath = normalizeBasePath(options.basePath ?? "/ageniti");

  return async function handleHttpRequest(request) {
    const method = request.method ?? "GET";
    const pathname = normalizePath(request.path ?? request.url ?? "/");

    if (method === "GET" && pathname === `${basePath}/actions`) {
      return jsonResponse({
        ok: true,
        actions: createActionManifest(actions, {
          surface: "http",
          includePrivate: options.includePrivate,
          includeLocal: options.includeLocal,
          includeDestructive: options.includeDestructive,
        }),
      });
    }

    if (method === "POST" && pathname.startsWith(`${basePath}/actions/`) && pathname.endsWith("/invoke")) {
      const actionName = decodeURIComponent(pathname.slice(`${basePath}/actions/`.length, -"/invoke".length));
      const action = actions.find((candidate) => candidate.name === actionName);

      if (!canExposeHttpAction(action, options)) {
        return jsonResponse({
          ok: false,
          error: {
            code: "ACTION_NOT_FOUND",
            message: `Action "${actionName}" is not exposed on the HTTP surface.`,
          },
        }, 404);
      }

      const body = request.body ?? {};
      const rawInput = pickInvocationInput(body, ["input", "arguments"]);
      const trustedContext = await resolveHttpInvocationContext({ request, body, options });
      const result = await runtime.invoke(actionName, rawInput, {
        surface: "http",
        confirm: body.confirm === true,
        user: trustedContext.user,
        auth: trustedContext.auth,
        metadata: mergeMetadata(body?.metadata, trustedContext.metadata),
        idempotencyKey: body.idempotencyKey ?? request.headers?.["idempotency-key"],
      });

      return jsonResponse(result, result.ok ? 200 : errorCodeToStatus(result.error.code));
    }

    return jsonResponse({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
      },
    }, 404);
  };
}

export function createHttpServer(options = {}) {
  const handle = createHttpHandler(options);
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const requireJsonContentType = options.requireJsonContentType !== false;

  const server = nodeHttp.createServer(async (request, response) => {
    const hasBody = request.method === "POST" || request.method === "PUT" || request.method === "PATCH";
    try {
      let body = {};
      if (hasBody) {
        if (requireJsonContentType) {
          const contentType = (request.headers["content-type"] ?? "").toLowerCase();
          if (!contentType.startsWith("application/json")) {
            sendJson(response, {
              ok: false,
              error: {
                code: "UNSUPPORTED_MEDIA_TYPE",
                message: "Request body must be application/json.",
              },
            }, 415);
            return;
          }
        }

        const declaredLength = Number(request.headers["content-length"]);
        if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
          sendJson(response, {
            ok: false,
            error: {
              code: "PAYLOAD_TOO_LARGE",
              message: `Request body exceeds limit of ${maxBodyBytes} bytes.`,
            },
          }, 413);
          return;
        }

        try {
          body = await parseRequestBody(request, { maxBodyBytes });
        } catch (error) {
          if (error?.code === "PAYLOAD_TOO_LARGE") {
            sendJson(response, {
              ok: false,
              error: {
                code: "PAYLOAD_TOO_LARGE",
                message: error.message,
              },
            }, 413);
            return;
          }
          if (error?.code === "INVALID_JSON_BODY") {
            sendJson(response, {
              ok: false,
              error: {
                code: "INVALID_JSON_BODY",
                message: error.message,
              },
            }, 400);
            return;
          }
          throw error;
        }
      }

      const result = await handle({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body,
      });
      sendJson(response, result.body, result.status, result.headers);
    } catch (error) {
      sendJson(response, {
        ok: false,
        error: {
          code: "HTTP_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Unknown HTTP server error.",
        },
      }, 500);
    }
  });

  return {
    server,
    listen(port = 4322, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          const address = server.address();
          const resolvedPort = typeof address === "object" && address ? address.port : port;
          resolve({
            port: resolvedPort,
            host,
            url: `http://${host}:${resolvedPort}`,
            close: () => new Promise((closeResolve) => server.close(closeResolve)),
          });
        });
      });
    },
  };
}

export async function parseRequestBody(request, { maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      const error = new Error(`Request body exceeds limit of ${maxBodyBytes} bytes.`);
      error.code = "PAYLOAD_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const wrapped = new Error(`Invalid JSON body: ${error.message}`);
    wrapped.code = "INVALID_JSON_BODY";
    throw wrapped;
  }
}

function canExposeHttpAction(action, options) {
  return canExposeAction(action, "http", options);
}

async function resolveHttpInvocationContext({ request, body, options }) {
  const base = {
    user: request?.user,
    auth: request?.auth,
    metadata: request?.metadata,
  };

  if (typeof options.resolveContext !== "function") {
    return base;
  }

  const resolved = await options.resolveContext({ request, body });
  if (!resolved || typeof resolved !== "object") {
    return base;
  }

  return {
    user: resolved.user ?? base.user,
    auth: resolved.auth ?? base.auth,
    metadata: mergeMetadata(base.metadata, resolved.metadata),
  };
}

function mergeMetadata(...values) {
  const objects = values.filter((value) => value && typeof value === "object" && !Array.isArray(value));
  if (objects.length === 0) return undefined;
  return Object.assign({}, ...objects);
}

function errorCodeToStatus(code) {
  return ERROR_STATUS_MAP[code] ?? 400;
}

function jsonResponse(body, status = 200) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body,
  };
}

function normalizeBasePath(basePath) {
  const normalized = normalizePath(basePath);
  return normalized === "/" ? "" : normalized;
}

function normalizePath(value) {
  const url = new URL(value, "http://localhost");
  const pathname = url.pathname.replace(/\/+$/, "");
  return pathname || "/";
}

export function sendJson(response, payload, statusCode = 200, headers = {}) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

export function sendText(response, body, contentType = "text/plain; charset=utf-8", statusCode = 200, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}
