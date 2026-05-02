# Contributing

## Development

Ageniti is currently dependency-free and uses native Node.js test runner.

```text
npm test
node examples/demo.cli.js search-orders --status paid
node examples/demo.cli.js dev --port 4321
```

## Design Principles

- Build for agent-facing apps, not agents.
- Keep existing React app structures intact.
- Keep the app action runtime headless.
- Keep React as an invocation adapter, not a dependency of the core.
- Generate CLI, MCP, and AI tools from explicit action contracts.
- Prefer explicit action exposure over automatic discovery.
- Keep agent-facing output structured and stable.
- Avoid orchestration, planning, memory, hosted runtime, marketplace, and workflow engine scope.

## Pull Request Checklist

- Tests pass with `npm test`.
- Public API changes are reflected in `src/index.d.ts`.
- README or docs are updated when behavior changes.
- New action/runtime behavior includes tests.
- Security-sensitive changes mention permissions, visibility, or side effects where relevant.
