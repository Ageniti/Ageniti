# Changelog

## 0.1.1

Release hardening update for public SDK distribution.

### Added

- GitHub Actions CI for test and package dry-run checks.
- Host starter templates for OpenAI Responses, AI SDK, MCP, and HTTP gateway usage.
- Runnable host examples backed by a shared task app.
- Shared exposure policy helper for external surfaces.
- Generated bundle README deployment instructions for CLI, MCP, npm package, and HTTP gateway usage.

### Fixed

- MCP, HTTP, OpenAI, and AI SDK surfaces now consistently hide `private`, `local`, and destructive actions by default.
- Example permission checks no longer grant write permissions by default.
- AI SDK tools continue to execute through the shared runtime and validation path.
- npm bin metadata uses a valid executable path.

### Changed

- Documentation now consistently positions Ageniti as an SDK for apps that agents can use, not an agent framework.
- Declared actions default to `public` visibility; use `local` or `private` for restricted capabilities.

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
