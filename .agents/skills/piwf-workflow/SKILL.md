---
name: piwf-workflow
description: Manage Pi Coding Workflow definitions, nodes, edges, runs, schedules, model providers, and routes through the repository's non-interactive piwf CLI. Use when Codex needs to inspect, validate, create, apply, publish, or delete workflows; edit graph nodes or connections; control Temporal runs or schedules; or query model routing with structured JSON and optimistic version protection.
---

# Pi Workflow CLI

Use `piwf` as the supported automation boundary for Pi Coding Workflow. Run commands from the repository root. Require the Orchestrator API for every command that reads or changes application state.

## Prepare The CLI

Build the CLI when `apps/cli/dist/index.js` is missing or its sources changed:

```bash
pnpm --filter @pi-workflow/cli build
```

Invoke the built CLI for clean machine-readable output:

```bash
node apps/cli/dist/index.js --json workflow list
```

Use `--api-url <url>` or `PIWF_API_URL` to select the Orchestrator; the default is `http://127.0.0.1:8787`. Never pass a database path to `piwf`: only the Orchestrator opens the authoritative Workflow SQLite configured by `PI_WORKFLOW_DATABASE`.

## Follow The Safe Mutation Flow

1. Inspect the current object and retain its version:

   ```bash
   node apps/cli/dist/index.js --json workflow show <workflow-id>
   ```

2. Validate the current workflow before editing:

   ```bash
   node apps/cli/dist/index.js --json workflow validate <workflow-id>
   ```

3. Preview every workflow, node, or edge mutation with both `--dry-run` and `--if-version <current-version>`.
4. Review the returned `validation`, object ID, and version.
5. Repeat the same command without `--dry-run`, preserving `--if-version`.
6. Validate again after the mutation. Publish only when `validation.valid` is `true`.

On exit code `5`, re-read the workflow and reconcile the version conflict. Never retry a stale mutation blindly.

## Manage Workflows

Use JSON or YAML files. Pass `-` to read supported input from stdin.

```bash
# Create or idempotently apply a definition
node apps/cli/dist/index.js --json workflow create --file workflow.yaml
node apps/cli/dist/index.js --json --if-version 3 workflow apply --file workflow.yaml

# Preview publication or deletion
node apps/cli/dist/index.js --json --dry-run --if-version 3 workflow publish <workflow-id>
node apps/cli/dist/index.js --json --dry-run --if-version 3 workflow delete <workflow-id>
```

Use `workflow list`, `workflow show`, `workflow create`, `workflow apply`, `workflow validate`, `workflow publish`, and `workflow delete`.

## Edit Nodes And Edges

Pass node configuration as inline JSON/YAML, `@file`, or `-` for stdin. For `node update`, pass either a runtime config patch or a wrapper containing `name`, `enabled`, `position`, or `config`.

```bash
node apps/cli/dist/index.js --json --dry-run --if-version 3 \
  node add <workflow-id> --type pi-agent --id implement --config @agent.yaml

node apps/cli/dist/index.js --json --dry-run --if-version 4 \
  node update <workflow-id> implement --config '{ maxTurns: 30 }'

node apps/cli/dist/index.js --json --dry-run --if-version 5 \
  edge connect <workflow-id> trigger implement --source-port started --target-port input
```

Use `node add`, `node update`, `node enable`, `node disable`, `node remove`, and `edge connect`. Read the returned workflow version before issuing the next mutation.

## Control Runtime Operations

Start the Orchestrator before using any stateful command. Supply `--api-url` when it is not on the default loopback address.

- Use `run start/list/inspect/pause/resume/cancel/approve` for Temporal runs.
- Use `schedule create/inspect/pause/resume/trigger/delete` for Temporal schedules.
- Use `provider list/test` and `route list/resolve` for model routing.
- Add `--dry-run` to mutating remote commands to preview requests without sending them.

Do not invent a `set-status` operation or directly mark a node completed. Runtime state must come from execution events. Use only the policy-controlled run and schedule commands exposed by `piwf`.

## Preserve Automation Contracts

- Always request `--json`; parse stdout as business data and treat stderr as diagnostics.
- Keep CLI invocations non-interactive. Use files or stdin instead of terminal menus.
- Never open or edit the Workflow SQLite from Desktop, CLI, or raw SQL. Let `piwf` call the Orchestrator API, which owns the application service and repository adapter.
- Never place API keys in command arguments. Keep provider credentials in the configured secure store or Orchestrator environment.
- Inspect command-specific options with `piwf <group> <command> --help` instead of guessing flags.
- Treat exit codes as stable: `0` success, `2` usage/input, `3` not found, `4` validation, `5` version conflict, `6` Orchestrator/API failure, and `1` unexpected failure.
