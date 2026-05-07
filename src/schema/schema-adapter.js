// Adapt foreign schema systems (Zod, Valibot, anything with safeParse/parse)
// into the same Schema interface the runtime understands. Best-effort
// JSON Schema conversion for the common Zod shapes; for anything exotic the
// user can supply { jsonSchema } explicitly via `wrapSchema(zod, { jsonSchema })`.

const TYPE_SYMBOL = Symbol.for("ageniti.schema");

export function isZodLike(value) {
  if (!value || typeof value !== "object") return false;
  return typeof value.safeParse === "function" || typeof value.parse === "function";
}

export function isStandardSchemaV1(value) {
  // https://standardschema.dev — Valibot, ArkType, etc. follow this.
  return Boolean(value && typeof value === "object" && value["~standard"]?.validate);
}

export function wrapSchema(foreign, options = {}) {
  if (foreign?.[TYPE_SYMBOL]) return foreign;

  if (isStandardSchemaV1(foreign)) {
    return wrapStandardSchema(foreign, options);
  }

  if (isZodLike(foreign)) {
    return wrapZodLike(foreign, options);
  }

  throw new TypeError("wrapSchema(): value is not a recognized schema (expected Zod, Standard Schema v1, or Ageniti schema).");
}

function unwrapZodWrappers(zod) {
  // Walk through Optional/Nullable/Default/Effects/Pipe wrappers to reach
  // the concrete schema underneath. Used so introspection of shape/items
  // works on `z.object({...}).optional()` and similar nestings.
  let current = zod;
  let guard = 0;
  while (current && guard < 16) {
    const t = getZodTypeName(current);
    if (t === "ZodOptional" || t === "ZodNullable" || t === "ZodDefault" ||
        t === "ZodReadonly" || t === "ZodCatch" || t === "ZodBranded") {
      current = current._def?.innerType ?? current;
    } else if (t === "ZodEffects") {
      current = current._def?.schema ?? current;
    } else if (t === "ZodPipe" || t === "ZodPipeline") {
      current = current._def?.in ?? current._def?.schema ?? current;
    } else {
      break;
    }
    guard += 1;
  }
  return current;
}

function wrapZodLike(zod, options) {
  const introspectedKind = inferZodKind(zod);
  const concrete = unwrapZodWrappers(zod);
  const introspectedShape = introspectedKind === "object" ? introspectZodShape(concrete) : undefined;
  const introspectedItem = introspectedKind === "array" ? introspectZodArrayItem(concrete) : undefined;

  const validate = (value, path = []) => {
    let result;
    if (typeof zod.safeParse === "function") {
      result = zod.safeParse(value);
      if (result.success) return { ok: true, value: result.data };
      const issues = (result.error?.issues ?? []).map((issue) => ({
        path: [...path, ...(issue.path ?? [])],
        message: issue.message ?? "Invalid value.",
      }));
      return { ok: false, issues: issues.length > 0 ? issues : [{ path, message: "Validation failed." }] };
    }
    try {
      const value2 = zod.parse(value);
      return { ok: true, value: value2 };
    } catch (error) {
      return { ok: false, issues: [{ path, message: error?.message ?? "Validation failed." }] };
    }
  };

  const toJSONSchema = () => {
    if (options.jsonSchema) return options.jsonSchema;
    if (typeof zod.toJSONSchema === "function") {
      try {
        return zod.toJSONSchema();
      } catch {
        // fall through to introspection
      }
    }
    return zodToJsonSchema(zod);
  };

  return Object.freeze({
    [TYPE_SYMBOL]: true,
    kind: introspectedKind,
    description: options.description,
    defaultValue: undefined,
    isOptional: Boolean(zod.isOptional?.() ?? introspectedKind === "optional"),
    isNullable: Boolean(zod.isNullable?.() ?? introspectedKind === "nullable"),
    shape: introspectedShape,
    itemSchema: introspectedItem,
    validate,
    parse(value) {
      const result = validate(value);
      if (!result.ok) {
        const error = new Error("Schema validation failed.");
        error.name = "SchemaValidationError";
        error.issues = result.issues;
        throw error;
      }
      return result.value;
    },
    toJSONSchema,
    describe(d) {
      return wrapZodLike(zod, { ...options, description: d });
    },
    optional() {
      if (typeof zod.optional === "function") return wrapZodLike(zod.optional(), options);
      return wrapZodLike(zod, options);
    },
    nullable() {
      if (typeof zod.nullable === "function") return wrapZodLike(zod.nullable(), options);
      return wrapZodLike(zod, options);
    },
    default(value) {
      if (typeof zod.default === "function") return wrapZodLike(zod.default(value), options);
      return wrapZodLike(zod, options);
    },
    meta(metadata) {
      return wrapZodLike(zod, { ...options, metadata: { ...(options.metadata ?? {}), ...metadata } });
    },
  });
}

function wrapStandardSchema(schema, options) {
  const validate = (value, path = []) => {
    const result = schema["~standard"].validate(value);
    // Standard Schema validate may return a Promise for async schemas; we
    // require sync for runtime input validation.
    if (result && typeof result.then === "function") {
      throw new Error("Async Standard Schema validators are not supported here.");
    }
    if ("value" in result) return { ok: true, value: result.value };
    const issues = (result.issues ?? []).map((issue) => ({
      path: [...path, ...(issue.path?.map((p) => p.key ?? p) ?? [])],
      message: issue.message ?? "Invalid value.",
    }));
    return { ok: false, issues: issues.length > 0 ? issues : [{ path, message: "Validation failed." }] };
  };

  return Object.freeze({
    [TYPE_SYMBOL]: true,
    kind: "external",
    description: options.description,
    defaultValue: undefined,
    isOptional: false,
    isNullable: false,
    validate,
    parse(value) {
      const result = validate(value);
      if (!result.ok) {
        const error = new Error("Schema validation failed.");
        error.name = "SchemaValidationError";
        error.issues = result.issues;
        throw error;
      }
      return result.value;
    },
    toJSONSchema() {
      return options.jsonSchema ?? { type: "object" };
    },
    describe(d) {
      return wrapStandardSchema(schema, { ...options, description: d });
    },
    optional() { return wrapStandardSchema(schema, options); },
    nullable() { return wrapStandardSchema(schema, options); },
    default() { return wrapStandardSchema(schema, options); },
    meta(metadata) {
      return wrapStandardSchema(schema, { ...options, metadata: { ...(options.metadata ?? {}), ...metadata } });
    },
  });
}

// ---------- Zod introspection (best-effort) ----------

function getZodTypeName(zod) {
  return zod?._def?.typeName ?? zod?.constructor?.name ?? "Unknown";
}

function inferZodKind(zod) {
  const typeName = getZodTypeName(zod);
  switch (typeName) {
    case "ZodString": return "string";
    case "ZodNumber": return "number";
    case "ZodBigInt": return "bigint";
    case "ZodBoolean": return "boolean";
    case "ZodDate": return "string";
    case "ZodArray": return "array";
    case "ZodObject": return "object";
    case "ZodEnum":
    case "ZodNativeEnum": return "enum";
    case "ZodLiteral": return "literal";
    case "ZodUnion":
    case "ZodDiscriminatedUnion": return "union";
    case "ZodRecord": return "record";
    case "ZodOptional": return inferZodKind(zod._def.innerType);
    case "ZodNullable": return inferZodKind(zod._def.innerType);
    case "ZodDefault": return inferZodKind(zod._def.innerType);
    case "ZodEffects": return inferZodKind(zod._def.schema);
    case "ZodPipe":
    case "ZodPipeline": return inferZodKind(zod._def.in ?? zod._def.schema);
    case "ZodAny":
    case "ZodUnknown": return "any";
    default: return "external";
  }
}

function introspectZodShape(zod) {
  const shape = typeof zod._def?.shape === "function" ? zod._def.shape() : zod.shape;
  if (!shape || typeof shape !== "object") return undefined;
  const out = {};
  for (const [key, child] of Object.entries(shape)) {
    out[key] = wrapZodLike(child, {});
  }
  return out;
}

function introspectZodArrayItem(zod) {
  const inner = zod._def?.type ?? zod._def?.element;
  if (!inner) return undefined;
  return wrapZodLike(inner, {});
}

export function zodToJsonSchema(zod) {
  const seen = new WeakSet();
  return convert(zod, seen) ?? {};

  function convert(node, s) {
    if (!node || typeof node !== "object") return {};
    if (s.has(node)) return {};
    s.add(node);
    const typeName = getZodTypeName(node);
    const def = node._def ?? {};

    switch (typeName) {
      case "ZodString": {
        const out = { type: "string" };
        for (const check of def.checks ?? []) {
          if (check.kind === "min") out.minLength = check.value;
          if (check.kind === "max") out.maxLength = check.value;
          if (check.kind === "regex") out.pattern = check.regex?.source;
          if (check.kind === "email") out.format = "email";
          if (check.kind === "url") out.format = "uri";
          if (check.kind === "uuid") out.format = "uuid";
          if (check.kind === "datetime") out.format = "date-time";
        }
        return out;
      }
      case "ZodNumber": {
        const out = { type: "number" };
        for (const check of def.checks ?? []) {
          if (check.kind === "int") out.type = "integer";
          if (check.kind === "min") out.minimum = check.value;
          if (check.kind === "max") out.maximum = check.value;
        }
        return out;
      }
      case "ZodBoolean": return { type: "boolean" };
      case "ZodBigInt": return { type: "integer" };
      case "ZodDate": return { type: "string", format: "date-time" };
      case "ZodLiteral": return { const: def.value };
      case "ZodEnum": return { enum: def.values ?? def.entries ?? [] };
      case "ZodNativeEnum": return { enum: Object.values(def.values ?? {}) };
      case "ZodArray": {
        const item = def.type ?? def.element;
        const out = { type: "array", items: item ? convert(item, s) : {} };
        if (def.minLength?.value !== undefined) out.minItems = def.minLength.value;
        if (def.maxLength?.value !== undefined) out.maxItems = def.maxLength.value;
        return out;
      }
      case "ZodObject": {
        const shape = typeof def.shape === "function" ? def.shape() : node.shape;
        const properties = {};
        const required = [];
        for (const [k, v] of Object.entries(shape ?? {})) {
          const childTypeName = getZodTypeName(v);
          properties[k] = convert(v, s);
          if (childTypeName !== "ZodOptional" && childTypeName !== "ZodDefault") {
            required.push(k);
          }
        }
        return {
          type: "object",
          properties,
          required,
          additionalProperties: def.unknownKeys === "passthrough",
        };
      }
      case "ZodOptional":
      case "ZodNullable":
      case "ZodReadonly":
      case "ZodCatch":
      case "ZodBranded": {
        return convert(def.innerType, s);
      }
      case "ZodDefault": {
        return { ...convert(def.innerType, s), default: typeof def.defaultValue === "function" ? def.defaultValue() : def.defaultValue };
      }
      case "ZodEffects": {
        return convert(def.schema, s);
      }
      case "ZodPipeline":
      case "ZodPipe": {
        return convert(def.in ?? def.schema, s);
      }
      case "ZodUnion":
      case "ZodDiscriminatedUnion": {
        return { anyOf: (def.options ?? []).map((opt) => convert(opt, s)) };
      }
      case "ZodIntersection": {
        return { allOf: [convert(def.left, s), convert(def.right, s)] };
      }
      case "ZodRecord": {
        return { type: "object", additionalProperties: def.valueType ? convert(def.valueType, s) : true };
      }
      case "ZodTuple": {
        return { type: "array", items: (def.items ?? []).map((it) => convert(it, s)) };
      }
      case "ZodNull": return { type: "null" };
      case "ZodUndefined": return {};
      case "ZodAny":
      case "ZodUnknown": return {};
      default: return {};
    }
  }
}
