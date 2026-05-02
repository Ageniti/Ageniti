# Getting Started

Ageniti helps an existing React or TypeScript app expose selected app actions to agents and automation tools.

It does not create an agent. It makes your app agent-facing.

## Install

```text
npm install @ageniti/core
```

Ageniti is ESM-only and requires Node.js 20 or newer.

## 1. Pick One App Capability

Start with one capability already present in your app:

- create a task
- search workspace records
- summarize a document
- export a report
- deploy a project

Do not start by rewriting your app. Extract or wrap the capability you want to expose.

## 2. Define An Action

```js
import { defineAction, s } from "@ageniti/core";

export const hello = defineAction({
  name: "hello",
  description: "Say hello to a person.",
  input: s.object({
    name: s.string().min(1).describe("Name to greet"),
  }),
  output: s.object({
    message: s.string(),
  }),
  run({ name }) {
    return { message: `Hello, ${name}.` };
  },
});
```

## 3. Create An App

```js
import { createAgenitiApp } from "@ageniti/core";
import { hello } from "./actions/hello.js";

export const app = createAgenitiApp({
  name: "hello-tool",
  description: "A simple greeting capability for agents.",
  docs: {
    summary: "Use this app when an agent needs to greet a person.",
  },
  actions: [hello],
});
```

## 4. Expose CLI

```js
#!/usr/bin/env node
import { app } from "./app.js";

await app.createCli().main();
```

Now run:

```text
hello-tool hello --name Aiden
hello-tool hello --json '{"name":"Aiden"}'
hello-tool hello --schema
hello-tool manifest
hello-tool build
hello-tool build docs
hello-tool docs
hello-tool package
hello-tool publish
hello-tool mcp
hello-tool dev --port 4321
```

## 5. Expose AI Tools

```js
const openaiTools = app.createOpenAITools();
const responsesTools = app.createOpenAIResponsesTools();
const aiSdkTools = app.createAISDKTools();
```

## 6. Use From React

```js
const { useAction } = app.createReactAdapter();
const runHello = useAction(hello);

await runHello({ name: "Aiden" });
```

This adapter can be used from your existing event handlers. It does not require replacing your React app structure.

## 7. Build Or Package Official Artifacts

When you are ready to ship CLI or MCP launchers:

```js
await app.build({
  targets: ["bundle"],
  appModule: "./src/ageniti/app.js",
  appExport: "app",
  outDir: "./dist/ageniti",
});
```

Or from the CLI:

```text
hello-tool build
hello-tool docs
hello-tool package
hello-tool publish
```

`docs` prints or exports a single `GUIDE.md` generated from your app-level and action-level natural-language descriptions.
`package` builds the bundle and runs `npm pack` in the output directory so you get a distributable `.tgz`.
`publish` performs an npm publish dry-run by default. Use live publish only when you are ready to release for real.
