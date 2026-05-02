# Scope

Ageniti is for building agent-facing apps.

It helps existing React and TypeScript applications expose selected app capabilities as structured tools.

## In Scope

- Define explicit app actions.
- Keep existing React app structure intact.
- Invoke actions from React UI.
- Generate CLI commands from actions.
- Expose actions as MCP tools.
- Expose actions as OpenAI tools.
- Expose actions as AI SDK-style tools.
- Test actions in a local dev console.
- Return structured success and failure results.
- Attach logs, progress, and artifact metadata.
- Provide permission hooks and side-effect metadata.

## Out Of Scope

- Creating autonomous agents.
- Planning and reasoning loops.
- Memory systems.
- Tool routing.
- Workflow orchestration.
- Hosted execution.
- Durable job queues.
- Marketplace distribution.
- Replacing application auth.
- Parsing arbitrary React component trees.

## Design Rule

Ageniti should make app actions callable by agents.

It should not decide what the agent should do.
