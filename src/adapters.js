import { canExposeAction } from "./runtime/exposure.js";

export function defineSurfaceAdapter(adapter) {
  if (!adapter?.name) {
    throw new TypeError("Surface adapter requires a name.");
  }

  return Object.freeze({
    description: "",
    capabilities: {},
    canExpose: () => true,
    describe: (action) => action,
    ...adapter,
  });
}

export const cliAdapter = defineSurfaceAdapter({
  name: "cli",
  description: "Command-line invocation surface.",
  capabilities: {
    jsonInput: true,
    jsonOutput: true,
    streaming: false,
    cancellation: true,
    binaryArtifacts: false,
    interactiveConfirmation: true,
  },
  canExpose(action) {
    return action.supportedSurfaces.includes("cli");
  },
});

export const jsonAdapter = defineSurfaceAdapter({
  name: "json",
  description: "Structured JSON runner surface.",
  capabilities: {
    jsonInput: true,
    jsonOutput: true,
    streaming: false,
    cancellation: true,
    binaryArtifacts: false,
    interactiveConfirmation: false,
  },
  canExpose(action) {
    return action.supportedSurfaces.includes("json");
  },
});

export const httpAdapter = defineSurfaceAdapter({
  name: "http",
  description: "HTTP JSON invocation surface.",
  capabilities: {
    jsonInput: true,
    jsonOutput: true,
    streaming: false,
    cancellation: true,
    binaryArtifacts: false,
    interactiveConfirmation: false,
  },
  canExpose(action) {
    return canExposeAction(action, "http");
  },
});

export const mcpAdapter = defineSurfaceAdapter({
  name: "mcp",
  description: "MCP-compatible tool surface.",
  capabilities: {
    jsonInput: true,
    jsonOutput: true,
    streaming: false,
    cancellation: false,
    binaryArtifacts: false,
    interactiveConfirmation: false,
  },
  canExpose(action) {
    return canExposeAction(action, "mcp");
  },
});

export const reactAdapter = defineSurfaceAdapter({
  name: "react",
  description: "React-friendly UI invocation surface.",
  capabilities: {
    jsonInput: true,
    jsonOutput: true,
    streaming: false,
    cancellation: true,
    binaryArtifacts: true,
    interactiveConfirmation: true,
  },
  canExpose(action) {
    return action.supportedSurfaces.includes("react");
  },
});

export const devAdapter = defineSurfaceAdapter({
  name: "dev",
  description: "Local developer console surface.",
  capabilities: {
    jsonInput: true,
    jsonOutput: true,
    streaming: false,
    cancellation: true,
    binaryArtifacts: true,
    interactiveConfirmation: true,
  },
  canExpose(action) {
    return action.supportedSurfaces.includes("dev");
  },
});

export const aiSdkAdapter = defineSurfaceAdapter({
  name: "ai-sdk",
  description: "LLM tool-calling adapter surface for OpenAI and Vercel AI SDK-style tools.",
  capabilities: {
    jsonInput: true,
    jsonOutput: true,
    streaming: false,
    cancellation: true,
    binaryArtifacts: false,
    interactiveConfirmation: false,
  },
  canExpose(action) {
    return canExposeAction(action, "ai-sdk");
  },
});

export function defaultSurfaceAdapters() {
  return [cliAdapter, jsonAdapter, httpAdapter, mcpAdapter, reactAdapter, devAdapter, aiSdkAdapter];
}

export function findAdapter(adapters, name) {
  return adapters.find((adapter) => adapter.name === name);
}
