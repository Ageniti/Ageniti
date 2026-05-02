#!/usr/bin/env node
import { createCli, defineAction, s } from "../src/index.js";

const hello = defineAction({
  name: "hello",
  description: "Say hello to someone.",
  input: s.object({
    name: s.string().min(1).describe("Name to greet"),
    excited: s.boolean().default(false).describe("Whether to add extra enthusiasm"),
  }),
  output: s.object({
    message: s.string(),
  }),
  run({ name, excited }, ctx) {
    ctx.logger.info("Generating greeting.", { name });
    return {
      message: `Hello, ${name}${excited ? "!" : "."}`,
    };
  },
});

const cli = createCli({
  name: "hello-tool",
  actions: [hello],
});

await cli.main();
