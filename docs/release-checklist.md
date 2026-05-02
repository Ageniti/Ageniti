# Release Checklist

Before publishing:

- Confirm package name availability on npm.
- Confirm `package.json` metadata.
- Confirm npm registry points to the intended publish registry.
- Confirm README says Ageniti is for agent-facing apps, not agents.
- Confirm docs do not promise workflow orchestration, hosted runtime, marketplace, or agent planning.
- Run `npm test`.
- Run `npm pack --dry-run`.
- Review `README.md`.
- Review `CHANGELOG.md`.
- Review generated type declarations.
- Run the demo CLI.
- Run `node examples/demo.cli.js lint`.
- Inspect `node examples/demo.cli.js manifest`.
- Inspect `node examples/demo.cli.js mcp`.
- Start the dev console locally.

Recommended commands:

```text
npm test
npm pack --dry-run
npm publish --dry-run --access public --registry=https://registry.npmjs.org
node examples/demo.cli.js search-tasks --status open
node examples/demo.cli.js create-task --title "Follow up with design review"
node examples/demo.cli.js lint
node examples/demo.cli.js manifest
node examples/demo.cli.js mcp
node examples/demo.cli.js dev --port 4321
```

Publishing:

```text
npm publish --access public
```

Do not publish until the package name and ownership are confirmed.

If your local npm config points at a mirror, publish with:

```text
npm publish --access public --registry=https://registry.npmjs.org
```
