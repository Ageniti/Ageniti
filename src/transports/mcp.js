import { normalizeAttribution } from "../runtime/attribution.js";
import { canExposeAction } from "../runtime/exposure.js";
import { pickInvocationInput, resolveRuntimeAndActions } from "./surface-utils.js";

const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024; // 1 MiB

export function createMcpManifest(actions, options = {}) {
  return {
    attribution: normalizeAttribution(options.attribution),
    tools: actions
      .filter((action) => canExposeToMcp(action, options))
      .map((action) => ({
        name: action.name,
        title: action.title,
        description: action.description,
        inputSchema: action.input.toJSONSchema(),
        metadata: {
          ...action.publicMetadata,
          ...(options.attribution ? { attribution: normalizeAttribution(options.attribution) } : {}),
          visibility: action.visibility,
          sideEffects: action.sideEffects,
          requiresConfirmation: action.requiresConfirmation,
          idempotency: action.idempotency,
          permissions: action.permissions,
        },
      })),
  };
}

export function createMcpHandler(options) {
  const { runtime, actions } = resolveRuntimeAndActions(options);

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
      const params = request.params ?? {};
      const input = pickInvocationInput(params, ["arguments"]);
      const action = actions.find((candidate) => candidate.name === name && canExposeToMcp(candidate, options));
      if (!action) {
        return jsonRpcError(request.id, -32601, `Tool "${name}" is not available.`);
      }

      const result = await runtime.invoke(name, input, {
        surface: "mcp",
        confirm: params.confirm === true,
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
  const framing = options.framing ?? "auto"; // "auto" | "content-length" | "newline"
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  const onError = typeof options.onError === "function"
    ? options.onError
    : (error) => {
        try {
          process.stderr.write(`[ageniti mcp] ${error?.message ?? error}\n`);
        } catch {
          /* ignore */
        }
      };

  return {
    async start({ input = process.stdin, output = process.stdout } = {}) {
      let buffer = Buffer.alloc(0);
      let mode = framing === "auto" ? null : framing;
      let discardBytes = 0;

      const writeResponse = (response) => {
        const payload = JSON.stringify(response);
        if (mode === "content-length") {
          const body = Buffer.from(payload, "utf8");
          output.write(`Content-Length: ${body.length}\r\n\r\n`);
          output.write(body);
        } else {
          output.write(`${payload}\n`);
        }
      };

      const frameTooLarge = () => jsonRpcError(null, -32600, `MCP frame exceeds limit of ${maxFrameBytes} bytes.`);

      const safeHandle = async (request) => {
        try {
          return await handle(request);
        } catch (error) {
          onError(error);
          return jsonRpcError(request?.id ?? null, -32603, "Internal MCP handler error.");
        }
      };

      const tryDecode = async () => {
        if (mode === null) {
          const detected = detectFramingMode(buffer);
          buffer = detected.buffer;
          mode = detected.mode;
          if (mode === null) {
            return false; // need more bytes
          }
        }

        if (mode === "content-length") {
          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd < 0) {
            if (buffer.length > maxFrameBytes) {
              buffer = Buffer.alloc(0);
              writeResponse(frameTooLarge());
              return true;
            }
            return false;
          }
          const headerText = buffer.slice(0, headerEnd).toString("utf8");
          const match = /Content-Length:\s*(\d+)/i.exec(headerText);
          if (!match) {
            // malformed header; drop bytes up to end and continue
            buffer = buffer.slice(headerEnd + 4);
            return true;
          }
          const length = Number(match[1]);
          if (!Number.isFinite(length) || length < 0) {
            buffer = buffer.slice(headerEnd + 4);
            writeResponse(jsonRpcError(null, -32600, "Invalid MCP Content-Length header."));
            return true;
          }
          if (length > maxFrameBytes) {
            const bodyStart = headerEnd + 4;
            const bufferedBodyBytes = buffer.length - bodyStart;
            if (bufferedBodyBytes >= length) {
              buffer = buffer.slice(bodyStart + length);
            } else {
              discardBytes = length - bufferedBodyBytes;
              buffer = Buffer.alloc(0);
            }
            writeResponse(frameTooLarge());
            return true;
          }
          const totalNeeded = headerEnd + 4 + length;
          if (buffer.length < totalNeeded) return false;
          const body = buffer.slice(headerEnd + 4, totalNeeded).toString("utf8");
          buffer = buffer.slice(totalNeeded);
          const parsed = parseJsonRpcLine(body);
          const response = parsed.ok
            ? await safeHandle(parsed.value)
            : jsonRpcError(null, -32700, "Invalid JSON was received by the server.");
          writeResponse(response);
          return true;
        }

        // newline framing
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) {
          if (buffer.length > maxFrameBytes) {
            buffer = Buffer.alloc(0);
            writeResponse(frameTooLarge());
            return true;
          }
          return false;
        }
        if (newlineIndex > maxFrameBytes) {
          buffer = buffer.slice(newlineIndex + 1);
          writeResponse(frameTooLarge());
          return true;
        }
        const line = buffer.slice(0, newlineIndex).toString("utf8").trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) return true;
        const parsed = parseJsonRpcLine(line);
        const response = parsed.ok
          ? await safeHandle(parsed.value)
          : jsonRpcError(null, -32700, "Invalid JSON was received by the server.");
        writeResponse(response);
        return true;
      };

      for await (const chunk of input) {
        let chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (discardBytes > 0) {
          if (chunkBuf.length <= discardBytes) {
            discardBytes -= chunkBuf.length;
            continue;
          }
          chunkBuf = chunkBuf.slice(discardBytes);
          discardBytes = 0;
        }
        buffer = Buffer.concat([buffer, chunkBuf]);

        // drain as many frames as available
        // eslint-disable-next-line no-await-in-loop
        while (await tryDecode()) {
          // keep draining
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
    return {
      ok: true,
      value: JSON.parse(line),
    };
  } catch {
    return { ok: false };
  }
}

function detectFramingMode(buffer) {
  let start = 0;
  while (start < buffer.length && isAsciiWhitespace(buffer[start])) {
    start += 1;
  }

  const trimmed = start > 0 ? buffer.slice(start) : buffer;
  if (trimmed.length === 0) {
    return { buffer: trimmed, mode: null };
  }

  if (looksLikeContentLengthPrefix(trimmed)) {
    const mode = trimmed.indexOf("\r\n\r\n") >= 0 ? "content-length" : null;
    return { buffer: trimmed, mode };
  }

  const firstByte = trimmed[0];
  if (firstByte === 0x7b || firstByte === 0x5b) { // { or [
    return { buffer: trimmed, mode: "newline" };
  }

  const newlineIndex = trimmed.indexOf("\n");
  if (newlineIndex >= 0) {
    const firstLine = trimmed.slice(0, newlineIndex).toString("utf8").trim();
    if (looksLikeContentLengthPrefix(Buffer.from(firstLine, "utf8"))) {
      return { buffer: trimmed, mode: null };
    }
    return { buffer: trimmed, mode: "newline" };
  }

  return { buffer: trimmed, mode: null };
}

function looksLikeContentLengthPrefix(buffer) {
  const prefix = "content-length:";
  const probe = buffer
    .slice(0, Math.min(buffer.length, prefix.length))
    .toString("utf8")
    .toLowerCase();
  return prefix.startsWith(probe);
}

function isAsciiWhitespace(byte) {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function canExposeToMcp(action, options) {
  return canExposeAction(action, "mcp", options);
}
