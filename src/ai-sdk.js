import { createRuntime } from "./core.js";

export function createOpenAITools(actions, options = {}) {
  return actions
    .filter((action) => canExposeToLlm(action, options))
    .map((action) => ({
      type: "function",
      metadata: action.publicMetadata,
      function: {
        name: action.name,
        description: action.description,
        parameters: action.input.toJSONSchema(),
        strict: options.strict ?? true,
      },
    }));
}

export function createOpenAIResponsesTools(actions, options = {}) {
  return actions
    .filter((action) => canExposeToLlm(action, options))
    .map((action) => ({
      type: "function",
      name: action.name,
      description: action.description,
      parameters: action.input.toJSONSchema(),
      strict: options.strict ?? true,
      metadata: action.publicMetadata,
    }));
}

export function createAISDKTools(actions, options = {}) {
  const runtime = options.runtime ?? createRuntime({ actions });
  const tools = {};

  for (const action of actions) {
    if (!canExposeToLlm(action, options)) {
      continue;
    }

    tools[action.name] = {
      description: action.description,
      metadata: action.publicMetadata,
      parameters: action.input,
      inputSchema: action.input.toJSONSchema(),
      execute: async (input, executeOptions = {}) => {
        const result = await runtime.invoke(action, input, {
          invocationId: executeOptions.invocationId,
          surface: llmSurface(options),
          user: executeOptions.user,
          auth: executeOptions.auth,
          env: executeOptions.env,
          services: executeOptions.services,
          metadata: executeOptions.metadata,
          signal: executeOptions.signal,
          confirm: executeOptions.confirm,
        });

        if (!options.returnEnvelope && result.ok) {
          return result.data;
        }

        return result;
      },
    };
  }

  return tools;
}

export function createFunctionCallingManifest(actions, options = {}) {
  return {
    openaiChatTools: createOpenAITools(actions, options),
    openaiResponsesTools: createOpenAIResponsesTools(actions, options),
    aiSdkTools: Object.keys(createAISDKTools(actions, options)),
  };
}

function canExposeToLlm(action, options) {
  const surface = llmSurface(options);

  if (options.includePrivate !== true && action.visibility === "private") {
    return false;
  }

  if (options.includeDestructive !== true && action.sideEffects === "destructive") {
    return false;
  }

  if (!action.supportedSurfaces.includes(surface)) {
    return false;
  }

  if (typeof options.filter === "function") {
    return Boolean(options.filter(action));
  }

  return true;
}

function llmSurface(options) {
  return options.surface ?? "ai-sdk";
}
