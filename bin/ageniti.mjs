#!/usr/bin/env node
import { createCli } from "../src/cli.js";

await createCli({
  name: "ageniti",
  description: "Ageniti project tooling.",
}).main();
