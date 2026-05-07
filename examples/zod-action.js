// Use any Zod-style schema directly with defineAction. Ageniti detects
// foreign schemas (.safeParse / .parse) and wraps them so the runtime,
// CLI, MCP, and tool adapters all see the same contract.
//
// This example uses a tiny mock that quacks like Zod so the example can
// run without Zod as a dev dependency. In real apps, just `import { z } from "zod"`.
//
// Run with: node examples/zod-action.js

import { createRuntime, defineAction } from "../src/index.js";

// --- Tiny Zod-shaped mock (replace with `import { z } from "zod"` IRL) ---
const z = {
  object: (shape) => ({
    _def: { typeName: "ZodObject", shape: () => shape },
    safeParse(value) {
      if (!value || typeof value !== "object") {
        return { success: false, error: { issues: [{ path: [], message: "Expected object." }] } };
      }
      const out = {};
      const issues = [];
      for (const [k, v] of Object.entries(shape)) {
        const r = v.safeParse(value[k]);
        if (r.success) out[k] = r.data;
        else for (const i of r.error.issues) issues.push({ path: [k, ...(i.path ?? [])], message: i.message });
      }
      return issues.length === 0 ? { success: true, data: out } : { success: false, error: { issues } };
    },
  }),
  string: () => ({
    _def: { typeName: "ZodString", checks: [] },
    safeParse: (v) => typeof v === "string"
      ? { success: true, data: v }
      : { success: false, error: { issues: [{ path: [], message: "Expected string." }] } },
  }),
  number: () => ({
    _def: { typeName: "ZodNumber", checks: [] },
    safeParse: (v) => typeof v === "number"
      ? { success: true, data: v }
      : { success: false, error: { issues: [{ path: [], message: "Expected number." }] } },
  }),
};
// --- End mock ---

const greet = defineAction({
  name: "greet",
  description: "Greet someone via a Zod schema.",
  input: z.object({ name: z.string(), age: z.number() }),
  run: ({ name, age }) => ({ greeting: `Hello ${name}, age ${age}` }),
});

console.log("Generated JSON Schema (for MCP / OpenAI tool spec):");
console.log(JSON.stringify(greet.input.toJSONSchema(), null, 2));

const runtime = createRuntime({ actions: [greet] });

console.log("\n=== Valid input ===");
console.log(await runtime.invoke("greet", { name: "Ada", age: 36 }, { surface: "json" }));

console.log("\n=== Invalid input (age is not a number) ===");
const failed = await runtime.invoke("greet", { name: "Ada", age: "thirty-six" }, { surface: "json" });
console.log(failed.error);
