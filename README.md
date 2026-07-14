# Pi Coding Workflow

A cross-platform desktop workspace for durable, reviewable coding-agent runs.

## Technology route

- Desktop: Tauri 2 + React 19 + TypeScript + Vite
- Coding executor: Pi SDK
- Durable orchestration: Temporal TypeScript SDK
- Workspace isolation: Git worktree first, container or microVM next
- Shared contracts: TypeScript workspace package
- Persistence: Tauri SQL plugin + SQLite on desktop, browser fallback for Vite preview

Tauri is the desktop shell for macOS, Windows, and Linux. Pi owns the inner coding-agent loop. Temporal owns long-running task stages, retries, approval gates, cancellation, and recovery.

## Repository layout

```text
apps/desktop       Tauri desktop application
apps/orchestrator  Temporal workflow and worker
packages/contracts Shared workflow types
packages/pi-adapter Pi SDK integration boundary
```

## Development

```bash
pnpm install
pnpm dev:desktop
```

To run the worker, start a local Temporal server and configure Pi model credentials first:

```bash
pnpm dev:worker
```

## Current scope

The repository contains the first executable desktop shell and compile-checked Workflow/Pi integration skeleton. Repository cloning, isolated sandboxes, validation command profiles, and pull-request delivery are deliberately left for the next implementation stage.

The desktop app stores Workflow definitions and versions, one-time/daily/weekly schedules, run records, and approvals in `pi-workflow.db` under the Tauri application data directory. Existing localStorage data is imported once on first launch. Vite browser preview uses a localStorage compatibility adapter because the Tauri SQL bridge is only available inside the desktop shell.

Schedules start runs while the desktop app remains open. Always-on execution after the app exits should use Temporal Schedules in the orchestrator layer.
