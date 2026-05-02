import { createRuntime } from "./core.js";

export function createMcpManifest(actions, options = {}) {
  return {
    tools: actions
      .filter((action) => canExposeToMcp(action, options))
      .map((action) => ({
        name: action.name,
        title: action.title,
        description: action.description,
        inputSchema: action.input.toJSONSchema(),
        metadata: {
          ...action.publicMetadata,
          visibility: action.visibility,
          sideEffects: action.sideEffects,
          idempotency: action.idempotency,
          permissions: action.permissions,
        },
      })),
  };
}

export function createMcpHandler(options) {
  const actions = options.actions ?? [];
  const runtime = options.runtime ?? createRuntime({ actions, ...options.runtimeOptions });

  return async function handleMcpRequest(request) {
    if (request?.jsonrpc !== "2.0") {
      return jsonRpcError(request?.id ?? null, -32600, "Invalid JSON-RPC request.");
    }

    if (request.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: createMcpManifest(actions, options),
      };
    }

    if (request.method === "tools/call") {
      const name = request.params?.name;
      const input = request.params?.arguments ?? {};
      const action = actions.find((candidate) => candidate.name === name && canExposeToMcp(candidate, options));
      if (!action) {
        return jsonRpcError(request.id, -32601, `Tool "${name}" is not available.`);
      }

      const result = await runtime.invoke(name, input, {
        surface: "mcp",
      });

      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError: !result.ok,
          structuredContent: result,
        },
      };
    }

    return jsonRpcError(request.id, -32601, `Unsupported method "${request.method}".`);
  };
}

export function createMcpStdioServer(options) {
  const handle = createMcpHandler(options);

  return {
    async start({ input = process.stdin, output = process.stdout } = {}) {
      let buffer = "";
      input.setEncoding("utf8");

      for await (const chunk of input) {
        buffer += chunk;
        let newlineIndex;

        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (!line) {
            continue;
          }

          const response = await handle(parseJsonRpcLine(line));
          output.write(`${JSON.stringify(response)}\n`);
        }
      }
    },
  };
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function parseJsonRpcLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return {
      jsonrpc: "2.0",
      id: null,
      method: undefined,
    };
  }
}

function canExposeToMcp(action, options) {
  if (!action.supportedSurfaces.includes("mcp")) {
    return false;
  }

  if (options.includePrivate !== true && action.visibility === "private") {
    return false;
  }

  if (options.includeDestructive !== true && action.sideEffects === "destructive") {
    return false;
  }

  return true;
}
