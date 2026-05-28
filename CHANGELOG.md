# Changelog

## Unreleased

### Changed

- Extracted the `useAction` state machine into a framework-agnostic reducer at
  `src/runtime/action-state.js` (`initialActionState`, `reduceActionEvent`,
  `reduceResult`). The React hook in `src/react-hooks.js` is now a thin binding
  that drives this reducer from `runtime.stream()` events and only owns React
  lifecycle concerns (mount, invocation race). Behavior is unchanged. This lets
  the invocation logic be unit-tested without a React renderer and makes the
  same logic reusable for future non-React bindings.

### Tests / CI

- Added `test/react.test.js` covering the React-free bindings (`makeInvoker`,
  `streamAction`, `createReactActionAdapter`): `src/react.js` now at 100% line
  and function coverage (was 46% / 0%).
- Added `test/action-state.test.js` covering the extracted state machine at
  100%, including the cancelled-vs-error terminal rule and the "don't downgrade
  an already-cancelled state" guard.
- Added `test:coverage` script using Node's built-in coverage (zero deps).
- CI now runs the test suite with coverage on Node 20, 22, and 24 (matching
  `engines: >=20`) instead of smoke-testing Node 20 only.

## 0.2.0

Surface-area cleanup and type integrity. Pre-1.0 breaking change.

### Breaking

- The following tool-chain APIs are no longer re-exported from `@ageniti/core`. Import them from their subpath instead — the runtime modules and behavior are unchanged:
  - `buildArtifacts`, `packageArtifacts`, `publishArtifacts` → `@ageniti/core/build`
  - `createGuideDoc`, `exportDocs` → `@ageniti/core/docs`
  - `initProject`, `doctorProject`, `loadProjectConfig`, `findDefaultAppModule`, `detectTypeScriptRuntime`, `supportsTypeScriptEntrypoints` → `@ageniti/core/project`
  - `lintActions` → `@ageniti/core/lint`
  - `describeAction`, `createSurfaceManifest`, `diffActionManifests` → `@ageniti/core/manifest`

  The main entry now exposes only runtime-facing primitives (action definition, runtime, adapters, transports, schema, client, test utilities). This keeps the SDK's hot path lean and isolates dev/build tooling behind explicit imports.

### Added

- `tsconfig.json` and `npm run typecheck` validate the source tree as part of `npm run ci` and `prepack`.
- `test/types-drift.test.js` fails CI if `src/index.d.ts` is missing a declaration for any runtime export from `src/index.js`.
- New `test:unit` and `test:e2e` scripts split the suite into fast (logic + drift, ~5s) and slower (build/publish/host examples) groups. `prepack` now runs `test:unit` + `typecheck` only.
- New subpath exports: `@ageniti/core/build`, `@ageniti/core/docs`, `@ageniti/core/project`.
- `zodToJsonSchema` is now declared in `src/index.d.ts` (previously runtime-only).

### Changed

- `src/index.d.ts` no longer declares the moved tool-chain functions; their type declarations live in `src/types/subpaths.d.ts` next to the corresponding subpath module.
- README now carries an explicit pre-1.0 stability notice recommending an exact-version pin.

## 0.1.2

SDK structure and release workflow update.

### Added

- SDK-style source grouping for `runtime`, `transports`, `tooling`, `clients`, `schema`, and `testing`.
- New examples for streaming, typed clients, handler wrapping, Zod schemas, and test helpers.
- Published package smoke coverage that installs the tarball and exercises the shipped CLI.

### Fixed

- Published CLI entry now resolves to the current CLI implementation.
- Release checks now cover executable validation and tarball-installed CLI usage.
- Documentation, exports, and examples now match the current SDK file layout and public entry points.
- Prepack and publish dry-run flows no longer fail because of nested tarball install tests.

### Changed

- Root modules now expose more conventional Node SDK entry names while transport and runtime internals live in dedicated directories.
- README and API docs were updated to reflect the current package structure and capabilities.

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
