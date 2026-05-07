import { normalizeAttribution } from "./attribution.js";
import { canExposeVisibility } from "./exposure.js";

export function createActionManifest(actions, options = {}) {
  const surface = options.surface;

  return actions
    .filter((action) => !surface || action.supportedSurfaces.includes(surface))
    .filter((action) => shouldExpose(action, options))
    .map((action) => describeAction(action));
}

export function describeAction(action) {
  return {
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
  };
}

export function createSurfaceManifest({
  appName,
  actions,
  adapters = [],
  attribution,
  surface,
  includePrivate,
  includeLocal,
  includeDestructive,
}) {
  return {
    name: appName,
    generatedAt: new Date().toISOString(),
    attribution: normalizeAttribution(attribution),
    actions: createActionManifest(actions, {
      surface,
      includePrivate,
      includeLocal,
      includeDestructive,
    }),
    surfaces: adapters.map((adapter) => ({
      name: adapter.name,
      description: adapter.description,
      capabilities: adapter.capabilities ?? {},
    })),
  };
}

export function diffActionManifests(previous, next) {
  const previousActions = normalizeActionList(previous);
  const nextActions = normalizeActionList(next);
  const previousByName = new Map(previousActions.map((action) => [action.name, action]));
  const nextByName = new Map(nextActions.map((action) => [action.name, action]));
  const changes = [];

  for (const [name, previousAction] of previousByName) {
    const nextAction = nextByName.get(name);

    if (!nextAction) {
      changes.push({
        type: "removed",
        severity: "breaking",
        action: name,
        message: `Action "${name}" was removed.`,
      });
      continue;
    }

    compareField(changes, name, "inputSchema", previousAction.inputSchema, nextAction.inputSchema, "breaking");
    compareField(changes, name, "outputSchema", previousAction.outputSchema, nextAction.outputSchema, "breaking");
    compareField(changes, name, "permissions", previousAction.permissions, nextAction.permissions, "breaking");
    compareField(changes, name, "sideEffects", previousAction.sideEffects, nextAction.sideEffects, "warning");
    compareField(changes, name, "supportedSurfaces", previousAction.supportedSurfaces, nextAction.supportedSurfaces, "warning");

    if (!previousAction.deprecated && nextAction.deprecated) {
      changes.push({
        type: "deprecated",
        severity: "warning",
        action: name,
        message: `Action "${name}" is now deprecated.`,
      });
    }

    if (previousAction.version !== nextAction.version) {
      changes.push({
        type: "changed",
        severity: "info",
        action: name,
        field: "version",
        before: previousAction.version,
        after: nextAction.version,
        message: `Action "${name}" version changed from "${previousAction.version ?? "unknown"}" to "${nextAction.version ?? "unknown"}".`,
      });
    }
  }

  for (const [name, nextAction] of nextByName) {
    if (!previousByName.has(name)) {
      changes.push({
        type: "added",
        severity: "info",
        action: name,
        message: `Action "${name}" was added.`,
        after: nextAction.version,
      });
    }
  }

  return {
    ok: !changes.some((change) => change.severity === "breaking"),
    summary: {
      breaking: changes.filter((change) => change.severity === "breaking").length,
      warnings: changes.filter((change) => change.severity === "warning").length,
      info: changes.filter((change) => change.severity === "info").length,
    },
    changes,
  };
}

function shouldExpose(action, options) {
  if (!canExposeVisibility(action, options)) {
    return false;
  }

  if (
    Object.hasOwn(options, "includeDestructive")
    && options.includeDestructive !== true
    && action.sideEffects === "destructive"
  ) {
    return false;
  }

  return true;
}

function normalizeActionList(manifestOrActions) {
  if (Array.isArray(manifestOrActions)) {
    return manifestOrActions;
  }

  if (Array.isArray(manifestOrActions?.actions)) {
    return manifestOrActions.actions;
  }

  throw new TypeError("diffActionManifests() expects action manifests or surface manifests.");
}

function compareField(changes, action, field, before, after, severity) {
  if (stableStringify(before) === stableStringify(after)) {
    return;
  }

  changes.push({
    type: "changed",
    severity,
    action,
    field,
    before,
    after,
    message: `Action "${action}" changed "${field}".`,
  });
}

function stableStringify(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }

  return value;
}
