# Pi Coding Workflow

A cross-platform desktop workspace for durable, reviewable coding-agent runs.

## Technology route

- Desktop: Tauri 2 + React 19 + TypeScript + Vite
- Coding executor: Pi SDK
- Durable orchestration: Temporal TypeScript SDK
- Workspace isolation: Git worktree first, container or microVM next
- Shared contracts: TypeScript workspace package
- Persistence: Tauri SQL plugin + SQLite

Tauri is the desktop shell for macOS, Windows, and Linux. Pi owns the inner coding-agent loop. Temporal owns long-running task stages, retries, approval gates, cancellation, and recovery.

## Repository layout

```text
apps/desktop       Tauri desktop application
apps/cli           Non-interactive piwf CLI
apps/orchestrator  Temporal workflow and worker
packages/application-service Shared use cases and persistence/gateway ports
packages/contracts Shared workflow types
packages/pi-adapter Pi SDK integration boundary
```

## Development

```bash
pnpm install
pnpm dev:desktop
```

Build and invoke the non-interactive CLI with:

```bash
pnpm --filter @pi-workflow/cli build
node apps/cli/dist/index.js --help
node --disable-warning=ExperimentalWarning apps/cli/dist/index.js --json workflow list
```

`piwf` stores Workflow definitions in `~/.pi-workflow/piwf.db` by default. Override it with
`PIWF_DATABASE` or `--database`. Workflow, node, and edge mutations support `--dry-run` and
`--if-version`; every command supports `--json`. JSON/YAML input accepts a file path, `@file`, or
`-` for stdin where the command exposes `--file`, `--config`, or `--input`.

```bash
piwf workflow apply --file workflow.yaml --if-version 3 --json
piwf node add coding-workflow --type pi-agent --config @agent.yaml --dry-run --json
piwf edge connect coding-workflow trigger agent --source-port started --target-port input --json
```

Successful business output is written to stdout and diagnostics to stderr. Stable exit codes are
`0` success, `2` usage/input, `3` not found, `4` validation, `5` version conflict, and `6`
Orchestrator/API failure.

To run durable scheduling locally, start Temporal Server and the long-lived Orchestrator before opening the desktop app:

```bash
docker compose -f infra/temporal/docker-compose.yml up -d
pnpm dev:orchestrator
pnpm dev:desktop
```

The Temporal UI is available at `http://localhost:8233`. The Orchestrator exposes a loopback-only API at
`http://127.0.0.1:8787`; the desktop app uses it to register and control Temporal Schedules. `pnpm dev:worker`
is still available when the API and Worker need to run as separate processes, and `pnpm dev:temporal-api`
starts only the API.

CLI run, schedule, provider, and route commands use that API. Configure model discovery with
`PI_WORKFLOW_MODEL_ROUTING_FILE=/absolute/path/model-routing.json`; the file contains
`ModelRoutingConfig` without credential values. Provider credentials remain in
`PI_WORKFLOW_SECRET_<NORMALIZED_SECRET_REF>` environment variables on the Orchestrator process.

## Current scope

The repository contains the first executable desktop shell and a Temporal-backed Workflow/Pi execution path. The
Orchestrator API creates idempotent Temporal Schedules, applies a 24-hour catch-up window, pauses schedules after
repeated failures, and exposes pause/resume/cancel/approval signals for running coding Workflows. Activity calls use
exponential retries and the Workflow keeps its state in Temporal history, so the Temporal Server and Orchestrator can
continue a run after the desktop app exits.

The desktop app stores Workflow definitions and versions, one-time/daily/weekly schedules, run records, approvals, and settings in `pi-workflow.db` under the Tauri application data directory. The UI is supported only inside the Tauri desktop shell; Vite remains an internal build and hot-reload tool for Tauri.

Desktop SQLite stores a local mirror of schedule intent and Temporal execution identifiers. Temporal is the source of
truth for the clock, retries, catch-up, pause/resume state, and scheduled Workflow execution. The Orchestrator process
must remain running independently of the desktop app; for production, run it as a system service or container.
