#!/usr/bin/env node
import { createCli } from "../src/tooling/cli.js";

await createCli({
  name: "ageniti",
  description: "Ageniti project tooling.",
}).main();
