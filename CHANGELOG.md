# Changelog

## 0.1.0

Initial public-ready release candidate for exposing React and TypeScript app actions to agents and automation tools.

### Added

- Headless action runtime.
- `defineAction()` action contract.
- Lightweight runtime schema system.
- Input and output validation.
- Structured success and failure envelopes.
- Logs, progress, and artifact collectors.
- Permission checker support.
- Middleware support.
- Timeout and retry support.
- Destructive action confirmation guard.
- CLI surface generated from action contracts.
- JSON runner surface.
- MCP-compatible manifest and JSON-RPC handler.
- MCP stdio line runner.
- OpenAI Chat/Responses tool adapters.
- Vercel AI SDK-style tool adapter.
- AI SDK surface adapter capability metadata.
- React-friendly adapter that does not make React a core dependency.
- Local dev console.
- Surface adapter declarations and capability manifests.
- Contract linting.
- Demo app and test suite.

### Known Boundaries

- MCP support is intentionally minimal and local-first; full transport compatibility should be validated against target MCP clients before production use.
- The schema system is intentionally lightweight; a Zod adapter is a planned follow-up.
- Ageniti does not implement agent orchestration, planning, memory, workflow execution, hosted runtime, durable jobs, marketplace, or automatic React component parsing.
