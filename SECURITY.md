# Security Policy

## Supported Versions

This repository is currently at an early `0.x` stage. Security fixes should target the latest released version.

## Reporting A Vulnerability

Report vulnerabilities privately to the project maintainers before public disclosure.

Please include:

- affected version or commit
- reproduction steps
- expected impact
- whether the issue can expose secrets, execute unintended actions, or bypass permissions

## Security Model

Ageniti provides hooks and defaults for safer app action exposure, but application developers remain responsible for their business permissions and data access policies.

Important safeguards included in the framework:

- explicit action registration
- structured permission checker hook
- visibility metadata
- side effect metadata
- destructive action confirmation
- MCP manifest filtering for destructive actions by default
- structured errors instead of raw stack traces

Important application responsibilities:

- do not expose sensitive actions without explicit permissions
- do not log secrets in action code
- validate user and tenant access inside the permission checker or service layer
- use idempotency keys for write actions that may be retried
- review action manifests before exposing them to agents

## Non-Goals

Ageniti does not provide a complete authorization system, hosted execution layer, agent planner, workflow engine, or marketplace. Security-sensitive app behavior should remain owned by the host application.
