import nodeHttp from "node:http";
import { createRuntime } from "./core.js";
import { createActionManifest } from "./manifest.js";

export function createHttpHandler(options = {}) {
  const actions = options.actions ?? [];
  const runtime = options.runtime ?? createRuntime({ actions, ...options.runtimeOptions });
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
        }).filter((action) => options.includeDestructive || action.sideEffects !== "destructive"),
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
      const result = await runtime.invoke(actionName, body.input ?? body.arguments ?? {}, {
        surface: "http",
        confirm: body.confirm === true,
        user: body.user,
        auth: body.auth,
        metadata: body.metadata,
      });

      return jsonResponse(result, result.ok ? 200 : 400);
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

  const server = nodeHttp.createServer(async (request, response) => {
    try {
      const body = request.method === "POST" || request.method === "PUT" || request.method === "PATCH"
        ? await parseRequestBody(request)
        : {};
      const result = await handle({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body,
      });
      sendJson(response, result.body, result.status);
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

export async function parseRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function canExposeHttpAction(action, options) {
  if (!action) {
    return false;
  }

  if (!action.supportedSurfaces.includes("http")) {
    return false;
  }

  if (!options.includePrivate && action.visibility === "private") {
    return false;
  }

  if (!options.includeDestructive && action.sideEffects === "destructive") {
    return false;
  }

  return true;
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

export function sendJson(response, payload, statusCode = 200) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

export function sendText(response, body, contentType = "text/plain; charset=utf-8", statusCode = 200) {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}
