import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

test("index.d.ts declares every runtime export from src/index.js", async () => {
  const dts = await readFile(resolve(root, "src/index.d.ts"), "utf8");
  const runtime = await import(resolve(root, "src/index.js"));

  const declared = new Set();
  for (const line of dts.split("\n")) {
    const m = line.match(/^export\s+(?:declare\s+)?(?:function|const|class|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (m) declared.add(m[1]);
  }

  const runtimeNames = Object.keys(runtime).filter((k) => k !== "default");
  const missing = runtimeNames.filter((name) => !declared.has(name));

  assert.deepEqual(
    missing,
    [],
    `Runtime exports missing from src/index.d.ts: ${missing.join(", ")}. ` +
      `Add a declaration or remove the runtime export.`,
  );
});
