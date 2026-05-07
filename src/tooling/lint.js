export function lintActions(actions) {
  const findings = [];
  const names = new Set();

  for (const action of actions) {
    if (names.has(action.name)) {
      findings.push(finding("error", action.name, "DUPLICATE_ACTION", `Duplicate action name "${action.name}".`));
    }
    names.add(action.name);

    if (!/^[a-z][a-z0-9_]*$/.test(action.name)) {
      findings.push(finding("error", action.name, "INVALID_NAME", "Action name must be lowercase snake_case."));
    }

    if (!action.description || action.description.length < 12) {
      findings.push(finding("warning", action.name, "WEAK_DESCRIPTION", "Action description should explain when to use the action."));
    }

    if (action.sideEffects === "destructive" && action.supportedSurfaces.includes("mcp")) {
      findings.push(finding("warning", action.name, "DESTRUCTIVE_MCP", "Destructive actions should not be exposed to MCP unless explicitly required."));
    }

    if (action.sideEffects !== "read" && action.idempotency === "unspecified") {
      findings.push(finding("warning", action.name, "UNSPECIFIED_IDEMPOTENCY", "Write/destructive actions should declare idempotency."));
    }

    const inputSchema = action.input.toJSONSchema();
    if (inputSchema.type !== "object") {
      findings.push(finding("warning", action.name, "NON_OBJECT_INPUT", "Action input should usually be an object for CLI and MCP compatibility."));
    }

    if (action.permissions.length === 0 && action.sideEffects !== "read") {
      findings.push(finding("warning", action.name, "WRITE_WITHOUT_PERMISSION", "Write/destructive actions should usually declare permissions."));
    }
  }

  return {
    ok: findings.every((item) => item.level !== "error"),
    findings,
  };
}

function finding(level, action, code, message) {
  return {
    level,
    action,
    code,
    message,
  };
}
