// Typed client for Ageniti actions. Three transports out of the box:
//   - in-process runtime
//   - HTTP (fetch a remote /ageniti server)
//   - any user-supplied transport with the shape: invoke(name, input, options) => envelope
//
// The client returns a Proxy where `client.action_name(input, options?)` resolves
// to the action's `data` (success) or throws an AgenitiClientError (failure).
// For the raw envelope, use `client.$invoke(name, input, options?)` or
// `{ raw: true }` option.

export class AgenitiClientError extends Error {
  constructor(envelope, details = {}) {
    super(envelope?.error?.message ?? details.message ?? "Action failed.");
    this.name = "AgenitiClientError";
    this.code = envelope?.error?.code ?? details.code;
    this.issues = envelope?.error?.issues ?? [];
    this.retryable = Boolean(envelope?.error?.retryable ?? details.retryable);
    this.envelope = envelope;
    if (details.cause) {
      this.cause = details.cause;
    }
  }
}

export function createClient(options = {}) {
  const transport = resolveTransport(options);

  // Pass `input` through verbatim. The runtime handles `undefined` by
  // defaulting to `{}`, but `null` and other primitives must reach the action
  // unchanged so root-level schemas like `s.literal(null)` validate correctly.
  const callAction = async (name, input, callOptions = {}) => {
    const envelope = await transport.invoke(name, input, callOptions);
    if (callOptions.raw) return envelope;
    if (!envelope.ok) {
      throw new AgenitiClientError(envelope);
    }
    return envelope.data;
  };

  const stream = async function* (name, input, callOptions = {}) {
    if (typeof transport.stream === "function") {
      yield* transport.stream(name, input, callOptions);
    } else {
      const envelope = await transport.invoke(name, input, callOptions);
      yield { type: "result", envelope };
    }
  };

  const proxy = new Proxy(Object.create(null), {
    get(_, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "$invoke") return callAction;
      if (prop === "$stream") return stream;
      if (prop === "$transport") return transport;
      if (prop === "then") return undefined; // do not look like a thenable
      return (input, callOptions) => callAction(prop, input, callOptions);
    },
  });

  return proxy;
}

function resolveTransport(options) {
  if (options.transport) return options.transport;
  if (options.runtime) return runtimeTransport(options.runtime, options);
  if (options.url) return httpTransport(options);
  throw new TypeError("createClient(): provide one of { runtime, url, transport }.");
}

function runtimeTransport(runtime, options) {
  const surface = options.surface ?? "json";
  return {
    invoke(name, input, callOptions = {}) {
      return runtime.invoke(name, input, { surface, ...callOptions });
    },
    stream(name, input, callOptions = {}) {
      if (typeof runtime.stream !== "function") {
        return (async function* () {
          const envelope = await runtime.invoke(name, input, { surface, ...callOptions });
          yield { type: "result", envelope };
        })();
      }
      return runtime.stream(name, input, { surface, ...callOptions });
    },
  };
}

function httpTransport(options) {
  const baseUrl = options.url.replace(/\/+$/, "");
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new Error("createClient(): no fetch implementation available; pass { fetch } explicitly.");
  }
  const basePath = options.basePath ?? "/ageniti";

  return {
    async invoke(name, input, callOptions = {}) {
      if (callOptions.user !== undefined || callOptions.auth !== undefined) {
        throw new AgenitiClientError(undefined, {
          code: "UNTRUSTED_REMOTE_IDENTITY",
          message: "Remote HTTP clients cannot send trusted `user` or `auth` in the request body. Inject identity through headers/custom fetch and resolve it with `resolveContext` on the server.",
        });
      }
      const headers = {
        "content-type": "application/json",
        ...(callOptions.idempotencyKey ? { "idempotency-key": callOptions.idempotencyKey } : {}),
        ...(options.headers ?? {}),
      };
      // The HTTP body still uses `{ input }` so the server can distinguish
      // input from auth / metadata. `input` is serialized as-is — null and
      // other primitive root inputs survive the JSON round-trip.
      const body = {
        input,
        confirm: callOptions.confirm,
        metadata: callOptions.metadata,
        idempotencyKey: callOptions.idempotencyKey,
      };
      let response;
      try {
        response = await fetcher(
          `${baseUrl}${basePath}/actions/${encodeURIComponent(name)}/invoke`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: callOptions.signal,
          },
        );
      } catch (error) {
        throw new AgenitiClientError(undefined, {
          code: "TRANSPORT_ERROR",
          message: error?.message ?? "Remote Ageniti request failed before a response was received.",
          cause: error,
        });
      }

      const rawText = await response.text();
      let envelope;
      try {
        envelope = rawText ? JSON.parse(rawText) : null;
      } catch (error) {
        throw new AgenitiClientError(undefined, {
          code: "INVALID_RESPONSE",
          message: `Remote Ageniti server returned a non-JSON response (HTTP ${response.status}).`,
          cause: error,
        });
      }

      if (!envelope || typeof envelope !== "object" || typeof envelope.ok !== "boolean") {
        throw new AgenitiClientError(undefined, {
          code: "INVALID_RESPONSE",
          message: `Remote Ageniti server returned an invalid response envelope (HTTP ${response.status}).`,
        });
      }
      return envelope;
    },
  };
}
