import { wrapSchema as wrapForeignSchema } from "./schema-adapter.js";

const TYPE_SYMBOL = Symbol.for("ageniti.schema");

export class SchemaValidationError extends Error {
  constructor(issues) {
    super("Schema validation failed.");
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

class BaseSchema {
  constructor(kind) {
    this[TYPE_SYMBOL] = true;
    this.kind = kind;
    this.description = undefined;
    this.defaultValue = undefined;
    this.isOptional = false;
    this.isNullable = false;
  }

  describe(description) {
    return cloneSchema(this, { description });
  }

  default(value) {
    return cloneSchema(this, { defaultValue: value, isOptional: true });
  }

  optional() {
    return cloneSchema(this, { isOptional: true });
  }

  nullable() {
    return cloneSchema(this, { isNullable: true });
  }

  meta(metadata) {
    return cloneSchema(this, { metadata: { ...(this.metadata ?? {}), ...metadata } });
  }

  validate(value, path = []) {
    if (value === undefined) {
      if (this.defaultValue !== undefined) {
        return { ok: true, value: this.defaultValue };
      }

      if (this.isOptional) {
        return { ok: true, value: undefined };
      }

      return {
        ok: false,
        issues: [{ path, message: "Required value is missing." }],
      };
    }

    if (value === null) {
      if (this.isNullable) {
        return { ok: true, value: null };
      }

      return {
        ok: false,
        issues: [{ path, message: "Expected non-null value." }],
      };
    }

    return this._validate(value, path);
  }

  parse(value) {
    const result = this.validate(value);
    if (!result.ok) {
      throw new SchemaValidationError(result.issues);
    }

    return result.value;
  }

  toJSONSchema() {
    const base = this._toJSONSchema();

    if (this.description) {
      base.description = this.description;
    }

    if (this.defaultValue !== undefined) {
      base.default = this.defaultValue;
    }

    if (this.metadata) {
      base["x-ageniti"] = this.metadata;
    }

    if (this.isNullable) {
      return {
        anyOf: [base, { type: "null" }],
      };
    }

    return base;
  }
}

class StringSchema extends BaseSchema {
  constructor(options = {}) {
    super("string");
    this.minLength = options.minLength;
    this.maxLength = options.maxLength;
    this.patternValue = options.patternValue;
    this.formatValue = options.formatValue;
  }

  min(length) {
    return cloneSchema(this, { minLength: length });
  }

  max(length) {
    return cloneSchema(this, { maxLength: length });
  }

  pattern(pattern) {
    return cloneSchema(this, { patternValue: pattern });
  }

  url() {
    return cloneSchema(this, { formatValue: "uri" });
  }

  datetime() {
    return cloneSchema(this, { formatValue: "date-time" });
  }

  _validate(value, path) {
    if (typeof value !== "string") {
      return { ok: false, issues: [{ path, message: "Expected string." }] };
    }

    if (this.minLength !== undefined && value.length < this.minLength) {
      return {
        ok: false,
        issues: [{ path, message: `Expected at least ${this.minLength} characters.` }],
      };
    }

    if (this.maxLength !== undefined && value.length > this.maxLength) {
      return {
        ok: false,
        issues: [{ path, message: `Expected at most ${this.maxLength} characters.` }],
      };
    }

    if (this.patternValue && !this.patternValue.test(value)) {
      return {
        ok: false,
        issues: [{ path, message: `Expected string to match ${this.patternValue}.` }],
      };
    }

    if (this.formatValue === "uri") {
      try {
        new URL(value);
      } catch {
        return { ok: false, issues: [{ path, message: "Expected valid URL." }] };
      }
    }

    if (this.formatValue === "date-time" && Number.isNaN(Date.parse(value))) {
      return { ok: false, issues: [{ path, message: "Expected valid date-time string." }] };
    }

    return { ok: true, value };
  }

  _toJSONSchema() {
    const schema = { type: "string" };
    if (this.minLength !== undefined) schema.minLength = this.minLength;
    if (this.maxLength !== undefined) schema.maxLength = this.maxLength;
    if (this.patternValue !== undefined) schema.pattern = this.patternValue.source;
    if (this.formatValue !== undefined) schema.format = this.formatValue;
    return schema;
  }
}

class NumberSchema extends BaseSchema {
  constructor(options = {}) {
    super("number");
    this.minValue = options.minValue;
    this.maxValue = options.maxValue;
    this.integerOnly = Boolean(options.integerOnly);
  }

  min(value) {
    return cloneSchema(this, { minValue: value });
  }

  max(value) {
    return cloneSchema(this, { maxValue: value });
  }

  int() {
    return cloneSchema(this, { integerOnly: true });
  }

  _validate(value, path) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return { ok: false, issues: [{ path, message: "Expected number." }] };
    }

    if (this.integerOnly && !Number.isInteger(value)) {
      return { ok: false, issues: [{ path, message: "Expected integer." }] };
    }

    if (this.minValue !== undefined && value < this.minValue) {
      return { ok: false, issues: [{ path, message: `Expected value >= ${this.minValue}.` }] };
    }

    if (this.maxValue !== undefined && value > this.maxValue) {
      return { ok: false, issues: [{ path, message: `Expected value <= ${this.maxValue}.` }] };
    }

    return { ok: true, value };
  }

  _toJSONSchema() {
    const schema = { type: this.integerOnly ? "integer" : "number" };
    if (this.minValue !== undefined) schema.minimum = this.minValue;
    if (this.maxValue !== undefined) schema.maximum = this.maxValue;
    return schema;
  }
}

class BooleanSchema extends BaseSchema {
  constructor() {
    super("boolean");
  }

  _validate(value, path) {
    if (typeof value !== "boolean") {
      return { ok: false, issues: [{ path, message: "Expected boolean." }] };
    }

    return { ok: true, value };
  }

  _toJSONSchema() {
    return { type: "boolean" };
  }
}

class EnumSchema extends BaseSchema {
  constructor(values) {
    super("enum");
    this.values = values;
  }

  _validate(value, path) {
    if (!this.values.includes(value)) {
      return {
        ok: false,
        issues: [{ path, message: `Expected one of: ${this.values.join(", ")}.` }],
      };
    }

    return { ok: true, value };
  }

  _toJSONSchema() {
    return { enum: [...this.values] };
  }
}

class ArraySchema extends BaseSchema {
  constructor(itemSchema) {
    super("array");
    this.itemSchema = itemSchema;
  }

  _validate(value, path) {
    if (!Array.isArray(value)) {
      return { ok: false, issues: [{ path, message: "Expected array." }] };
    }

    const output = [];
    const issues = [];

    for (let index = 0; index < value.length; index += 1) {
      const result = this.itemSchema.validate(value[index], [...path, index]);
      if (result.ok) {
        output.push(result.value);
      } else {
        issues.push(...result.issues);
      }
    }

    if (issues.length > 0) {
      return { ok: false, issues };
    }

    return { ok: true, value: output };
  }

  _toJSONSchema() {
    return {
      type: "array",
      items: this.itemSchema.toJSONSchema(),
    };
  }
}

class ObjectSchema extends BaseSchema {
  constructor(shape, options = {}) {
    super("object");
    this.shape = shape;
    this.allowAdditionalProperties = Boolean(options.allowAdditionalProperties);
    this.strictMode = Boolean(options.strictMode);
  }

  passthrough() {
    return cloneSchema(this, { allowAdditionalProperties: true, strictMode: false });
  }

  strict() {
    return cloneSchema(this, { strictMode: true, allowAdditionalProperties: false });
  }

  _validate(value, path) {
    if (!isPlainObject(value)) {
      return { ok: false, issues: [{ path, message: "Expected object." }] };
    }

    const output = {};
    const issues = [];

    for (const [key, schema] of Object.entries(this.shape)) {
      const result = schema.validate(value[key], [...path, key]);
      if (result.ok) {
        if (result.value !== undefined) {
          output[key] = result.value;
        }
      } else {
        issues.push(...result.issues);
      }
    }

    if (this.strictMode) {
      for (const key of Object.keys(value)) {
        if (!(key in this.shape)) {
          issues.push({ path: [...path, key], message: `Unexpected property "${key}".` });
        }
      }
    }

    if (issues.length > 0) {
      return { ok: false, issues };
    }

    if (this.allowAdditionalProperties) {
      for (const [key, unknownValue] of Object.entries(value)) {
        if (!(key in this.shape)) {
          output[key] = unknownValue;
        }
      }
    }

    return { ok: true, value: output };
  }

  _toJSONSchema() {
    const properties = {};
    const required = [];

    for (const [key, schema] of Object.entries(this.shape)) {
      properties[key] = schema.toJSONSchema();

      if (!schema.isOptional && schema.defaultValue === undefined) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required,
      additionalProperties: this.allowAdditionalProperties,
    };
  }
}

class LiteralSchema extends BaseSchema {
  constructor(literal) {
    super("literal");
    this.literal = literal;
    // A literal whose value is `null` or `undefined` must accept that value
    // through the BaseSchema null/undefined gates. Without this, the gates
    // reject before _validate runs.
    if (literal === null) this.isNullable = true;
    if (literal === undefined) this.isOptional = true;
  }

  _validate(value, path) {
    if (value !== this.literal) {
      return { ok: false, issues: [{ path, message: `Expected literal ${JSON.stringify(this.literal)}.` }] };
    }

    return { ok: true, value };
  }

  _toJSONSchema() {
    return { const: this.literal };
  }
}

class UnionSchema extends BaseSchema {
  constructor(options) {
    super("union");
    this.options = options;
  }

  _validate(value, path) {
    const collectedIssues = [];

    for (const schema of this.options) {
      const result = schema.validate(value, path);
      if (result.ok) {
        return result;
      }

      collectedIssues.push(...result.issues);
    }

    return {
      ok: false,
      issues: collectedIssues.length > 0 ? collectedIssues : [{ path, message: "Value did not match any union option." }],
    };
  }

  _toJSONSchema() {
    return {
      anyOf: this.options.map((schema) => schema.toJSONSchema()),
    };
  }
}

class RecordSchema extends BaseSchema {
  constructor(valueSchema) {
    super("record");
    this.valueSchema = valueSchema;
  }

  _validate(value, path) {
    if (!isPlainObject(value)) {
      return { ok: false, issues: [{ path, message: "Expected object record." }] };
    }

    const output = {};
    const issues = [];

    for (const [key, item] of Object.entries(value)) {
      const result = this.valueSchema.validate(item, [...path, key]);
      if (result.ok) {
        output[key] = result.value;
      } else {
        issues.push(...result.issues);
      }
    }

    if (issues.length > 0) {
      return { ok: false, issues };
    }

    return { ok: true, value: output };
  }

  _toJSONSchema() {
    return {
      type: "object",
      additionalProperties: this.valueSchema.toJSONSchema(),
    };
  }
}

class AnySchema extends BaseSchema {
  constructor() {
    super("any");
  }

  _validate(value) {
    return { ok: true, value };
  }

  _toJSONSchema() {
    return {};
  }
}

export const s = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BooleanSchema(),
  enum: (values) => new EnumSchema(values),
  array: (itemSchema) => new ArraySchema(assertSchema(itemSchema)),
  literal: (value) => new LiteralSchema(value),
  union: (options) => new UnionSchema(options.map((schema) => assertSchema(schema))),
  record: (valueSchema) => new RecordSchema(assertSchema(valueSchema)),
  object: (shape) => {
    for (const [key, schema] of Object.entries(shape)) {
      assertSchema(schema, `Object field "${key}" must be a schema.`);
    }

    return new ObjectSchema(shape);
  },
  any: () => new AnySchema(),
};

export function isSchema(value) {
  return Boolean(value?.[TYPE_SYMBOL]);
}

export function assertSchema(value, message = "Expected schema.") {
  if (isSchema(value)) return value;

  // Foreign schemas (Zod, Standard Schema v1) are wrapped so users keep
  // whatever schema system they already have.
  if (value && typeof value === "object") {
    if (
      typeof value.safeParse === "function" ||
      typeof value.parse === "function" ||
      value["~standard"]?.validate
    ) {
      return wrapForeignSchema(value);
    }
  }

  throw new TypeError(message);
}

export function toJSONSchema(schema) {
  return assertSchema(schema).toJSONSchema();
}

function cloneSchema(schema, overrides) {
  const clone = Object.create(Object.getPrototypeOf(schema));
  Object.assign(clone, schema, overrides);
  return clone;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
