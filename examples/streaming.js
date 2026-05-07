// Streaming events: subscribe to log / progress / artifact / result events
// as an action runs. The runtime is the source of truth; any consumer
// (CLI, UI, agent, log shipper) plugs in via runtime.stream().
//
// Run with: node examples/streaming.js

import { createRuntime, defineAction, s } from "../src/index.js";

const longRunning = defineAction({
  name: "long_running",
  description: "Simulates a multi-step task that streams progress.",
  input: s.object({ steps: s.number().int().min(1).max(10).default(3) }),
  output: s.object({ done: s.boolean(), processed: s.number() }),
  async run({ steps }, ctx) {
    ctx.logger.info("Starting long-running task", { steps });

    for (let i = 1; i <= steps; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      ctx.progress.report({
        message: `Step ${i}/${steps}`,
        percent: Math.round((i / steps) * 100),
      });
      ctx.logger.debug("Step completed", { step: i });
    }

    ctx.artifacts.add({
      type: "report",
      name: "summary.txt",
      uri: "memory://summary",
      sizeBytes: 128,
      metadata: { steps },
    });

    return { done: true, processed: steps };
  },
});

const runtime = createRuntime({ actions: [longRunning] });

console.log("=== Live stream ===");
for await (const event of runtime.stream("long_running", { steps: 4 })) {
  if (event.type === "log") {
    console.log(`  [${event.level}]`, event.message);
  } else if (event.type === "progress") {
    console.log(`  ${event.percent}% — ${event.message}`);
  } else if (event.type === "artifact") {
    console.log(`  artifact:`, event.artifact.name, `(${event.artifact.sizeBytes} bytes)`);
  } else if (event.type === "result") {
    console.log(`  result:`, event.envelope.ok ? "OK" : "FAIL", event.envelope.data ?? event.envelope.error);
  }
}
