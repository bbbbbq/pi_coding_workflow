# Pi Coding Workflow

A local-first desktop workspace for durable, reviewable coding-agent workflows.

## Architecture

- Desktop: Tauri 2 + React 19 + TypeScript + Vite
- Local runtime: bundled Node.js process using JSON Lines over stdin/stdout
- Coding executor: Pi SDK
- Application layer: shared TypeScript services for Workflows and Run state
- Persistence: SQLite with optimistic Workflow versions and append-only Run events
- Workspace isolation: Git worktree first, container or microVM later

No HTTP server, WebSocket, Docker service, or local TCP port is required. Desktop launches the local
runtime as a child process and communicates through Tauri commands. `piwf` imports the same runtime
in-process.

```text
Desktop UI --Tauri IPC/stdin--> Local Runtime --+--> Application Service
piwf CLI ---------------------> Local Runtime --+--> SQLite / Pi / Git
```

## Repository Layout

```text
apps/desktop        Tauri desktop application
apps/cli            Non-interactive piwf CLI
apps/local-runtime  Local stdio runtime and Pi integration boundary
packages/application-service  Workflow and Run use cases plus persistence ports
packages/contracts  Shared workflow, run, schedule, and model types
packages/pi-adapter Pi SDK and model-routing adapter
packages/workflow-core Workflow validation and schedule calculations
```

## Development

```bash
pnpm install
pnpm dev:desktop
```

The Desktop dev/build scripts build `apps/local-runtime/dist/piwf-runtime.js` automatically. The
current sidecar launcher requires Node.js 22 or newer to be installed. Production packaging still
needs a target-specific bundled Node executable before the desktop installer is fully standalone.

Build and invoke the CLI:

```bash
pnpm --filter @pi-workflow/cli build
node --disable-warning=ExperimentalWarning apps/cli/dist/index.js --help
node --disable-warning=ExperimentalWarning apps/cli/dist/index.js --json workflow list
```

Both Desktop and CLI use `~/.pi-workflow/piwf.db` by default. Override it for development or testing
with `PI_WORKFLOW_DATABASE`. Model routing can be loaded with
`PI_WORKFLOW_MODEL_ROUTING_FILE=/absolute/path/model-routing.json`; provider credentials use
`PI_WORKFLOW_SECRET_<NORMALIZED_SECRET_REF>` in the runtime environment.

Workflow, node, and edge mutations support `--dry-run` and `--if-version`; every CLI command supports
`--json`. JSON/YAML inputs accept a file path, `@file`, or `-` for stdin where exposed by the command.

```bash
piwf workflow apply --file workflow.yaml --if-version 3 --json
piwf node add coding-workflow --type pi-agent --config @agent.yaml --dry-run --json
piwf edge connect coding-workflow trigger agent --source-port started --target-port input --json
piwf run start coding-workflow --input '{ repositoryPath: "/code/project", task: "Fix tests" }' --json
```

Successful business output is written to stdout and diagnostics to stderr. Stable exit codes are
`0` success, `1` unexpected failure, `2` usage/input, `3` not found, `4` validation, `5` state or
version conflict, and `6` runtime failure.

## Persistence Ownership

The local runtime owns authoritative Workflow definitions, versions, Run records, ordered Run events,
and approvals. Run transitions and their events are committed atomically. Desktop keeps a separate
Tauri SQLite database only for UI settings, model configuration, legacy migration data, and local
schedule definitions.

On upgrade, Desktop imports its latest legacy Workflow into the runtime database only when that
database is empty. It no longer writes Workflow or Run state to the Tauri database.

## Current Scope

Implemented:

- Visual Workflow editor and structural validation
- Idempotent Workflow apply, publication, dry-run, and optimistic version checks
- Shared Desktop/CLI local runtime with no network transport
- Durable Run state machine with ordered events, pause/resume/interruption, and approval gates
- SQLite persistence for Workflows, Runs, events, and approvals
- Pi model routing and provider health checks
- Local schedule definition management in Desktop

Not yet implemented:

- Graph interpretation that executes every visual node type
- Connecting `run start` to the Pi coding executor and validation loop
- OS scheduler integration for running schedules while Desktop is closed
- Target-specific bundling of the Node runtime executable

Without a resident process, active Agent work cannot continue after both Desktop and CLI exit. Stored
Runs can be marked interrupted and resumed on a later launch.
