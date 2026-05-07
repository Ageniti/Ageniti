import { createRuntime } from "./runtime/core.js";
import { canExposeAction } from "./runtime/exposure.js";
import { normalizeAttribution } from "./runtime/attribution.js";

export function createOpenAITools(actions, options = {}) {
  return actions
    .filter((action) => canExposeToLlm(action, options))
    .map((action) => ({
      type: "function",
      metadata: mergeToolMetadata(action.publicMetadata, options.attribution),
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
      metadata: mergeToolMetadata(action.publicMetadata, options.attribution),
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
      metadata: mergeToolMetadata(action.publicMetadata, options.attribution),
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
    attribution: normalizeAttribution(options.attribution),
    openaiChatTools: createOpenAITools(actions, options),
    openaiResponsesTools: createOpenAIResponsesTools(actions, options),
    aiSdkTools: Object.keys(createAISDKTools(actions, options)),
  };
}

function mergeToolMetadata(publicMetadata, attribution) {
  const normalizedAttribution = normalizeAttribution(attribution);
  if (!normalizedAttribution) {
    return publicMetadata;
  }

  return {
    ...(publicMetadata ?? {}),
    attribution: normalizedAttribution,
  };
}

function canExposeToLlm(action, options) {
  return canExposeAction(action, llmSurface(options), options);
}

function llmSurface(options) {
  return options.surface ?? "ai-sdk";
}
