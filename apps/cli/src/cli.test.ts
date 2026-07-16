import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  InMemoryWorkflowRepository,
  WorkflowApplicationService,
} from "@pi-workflow/application-service";
import { LocalRuntime } from "@pi-workflow/local-runtime";
import { runCli as executeCli } from "./cli.js";

test("CLI applies workflows idempotently and reports version conflicts", async () => {
  const service = createService();
  const fixture = await createFixture();
  try {
    const created = await runCli(["--json", "workflow", "create", "--file", fixture.file], service);
    assert.equal(created.status, 0, created.stderr);
    assert.equal(JSON.parse(created.stdout).workflow.definition.version, 1);

    const unchanged = await runCli([
      "--json", "--if-version", "1", "workflow", "apply", "--file", fixture.file,
    ], service);
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.equal(JSON.parse(unchanged.stdout).changed, false);

    await writeFile(fixture.file, JSON.stringify(workflowDefinition("CLI workflow updated")), "utf8");
    const updated = await runCli([
      "--json", "--if-version", "1", "workflow", "apply", "--file", fixture.file,
    ], service);
    assert.equal(updated.status, 0, updated.stderr);
    assert.equal(JSON.parse(updated.stdout).workflow.definition.version, 2);

    const conflict = await runCli([
      "--json", "--if-version", "1", "workflow", "apply", "--file", fixture.file,
    ], service);
    assert.equal(conflict.status, 5);
    assert.match(conflict.stderr, /version_conflict/);
  } finally {
    await fixture.cleanup();
  }
});

test("CLI dry-run returns validation without writing", async () => {
  const service = createService();
  const fixture = await createFixture("Preview");
  try {
    const preview = await runCli([
      "--json", "--dry-run", "workflow", "create", "--file", fixture.file,
    ], service);
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).dryRun, true);

    const listed = await runCli(["--json", "workflow", "list"], service);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout), []);
  } finally {
    await fixture.cleanup();
  }
});

test("CLI node and edge commands mutate through the application service", async () => {
  const service = createService();
  const fixture = await createFixture("Graph commands");
  try {
    assert.equal((await runCli([
      "--json", "workflow", "create", "--file", fixture.file,
    ], service)).status, 0);

    const added = await runCli([
      "--json", "--if-version", "1",
      "node", "add", "cli-workflow", "--type", "pi-agent", "--id", "agent",
      "--config", "{ prompt: 'Inspect the repository', maxTurns: 8 }",
    ], service);
    assert.equal(added.status, 0, added.stderr);
    assert.equal(JSON.parse(added.stdout).workflow.definition.version, 2);

    const updated = await runCli([
      "--json", "--if-version", "2",
      "node", "update", "cli-workflow", "agent", "--config", "{ timeoutSeconds: 90 }",
    ], service);
    assert.equal(updated.status, 0, updated.stderr);
    const updatedAgent = JSON.parse(updated.stdout).workflow.definition.nodes
      .find((node: { id: string }) => node.id === "agent");
    assert.equal(updatedAgent.config.timeoutSeconds, 90);

    const disabled = await runCli([
      "--json", "--if-version", "3", "node", "disable", "cli-workflow", "agent",
    ], service);
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.equal(JSON.parse(disabled.stdout).workflow.definition.version, 4);

    const connected = await runCli([
      "--json", "--if-version", "4",
      "edge", "connect", "cli-workflow", "trigger", "agent",
      "--source-port", "started", "--target-port", "input",
    ], service);
    assert.equal(connected.status, 0, connected.stderr);
    assert.equal(JSON.parse(connected.stdout).workflow.definition.version, 5);
  } finally {
    await fixture.cleanup();
  }
});

test("CLI returns stable usage and validation exit codes", async () => {
  const service = createService();
  const unknown = await runCli(["--json", "unknown-command"], service);
  assert.equal(unknown.status, 2);
  assert.equal(JSON.parse(unknown.stderr).error.code, "usage_error");

  const fixture = await createFixture("Invalid workflow");
  try {
    const invalid = workflowDefinition("Invalid workflow");
    invalid.nodes = (invalid.nodes as Array<{ type: string }>).filter((node) => node.type !== "end");
    invalid.edges = [];
    await writeFile(fixture.file, JSON.stringify(invalid), "utf8");
    assert.equal((await runCli([
      "--json", "workflow", "create", "--file", fixture.file,
    ], service)).status, 0);
    const validation = await runCli(["--json", "workflow", "validate", "cli-workflow"], service);
    assert.equal(validation.status, 4);
    assert.equal(JSON.parse(validation.stdout).valid, false);
  } finally {
    await fixture.cleanup();
  }
});

test("CLI run commands use the same in-process local runtime", async () => {
  const runtime = createService();
  const fixture = await createFixture("Local run workflow");
  try {
    assert.equal((await runCli([
      "--json", "workflow", "create", "--file", fixture.file,
    ], runtime)).status, 0);
    const started = await runCli([
      "--json", "run", "start", "cli-workflow",
      "--input", "{ repositoryPath: '/repo', task: 'Implement local runtime' }",
    ], runtime);
    assert.equal(started.status, 0, started.stderr);
    const runId = JSON.parse(started.stdout).run.id as string;
    const inspected = await runCli(["--json", "run", "inspect", runId], runtime);
    assert.equal(inspected.status, 0, inspected.stderr);
    assert.equal(JSON.parse(started.stdout).run.status, "completed");
    assert.equal(JSON.parse(inspected.stdout).run.status, "completed");
    assert.equal(JSON.parse(inspected.stdout).events.length, 7);
  } finally {
    await fixture.cleanup();
  }
});

test("CLI run start returns the stable runtime exit code for a failed graph", async () => {
  const runtime = createService();
  const fixture = await createFixture("Failed run");
  try {
    await writeFile(fixture.file, JSON.stringify(workflowDefinition("Failed run", "failed")), "utf8");
    assert.equal((await runCli([
      "--json", "workflow", "create", "--file", fixture.file,
    ], runtime)).status, 0);
    const result = await runCli([
      "--json", "run", "start", "cli-workflow",
      "--input", "{ repositoryPath: '/repo', task: 'Fail deliberately' }",
    ], runtime);
    assert.equal(result.status, 6);
    assert.equal(JSON.parse(result.stdout).run.status, "failed");
  } finally {
    await fixture.cleanup();
  }
});

function createService(): LocalRuntime {
  return LocalRuntime.createForTesting(
    new WorkflowApplicationService(new InMemoryWorkflowRepository()),
  );
}

async function createFixture(name = "CLI workflow"): Promise<{ file: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "piwf-cli-"));
  const file = join(directory, "workflow.json");
  await writeFile(file, JSON.stringify(workflowDefinition(name)), "utf8");
  return {
    file,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function runCli(
  arguments_: string[],
  runtime: LocalRuntime,
): Promise<{ status: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const status = await executeCli(["node", "piwf", ...arguments_], { runtime });
    return { status, stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
}

function workflowDefinition(name: string, result = "success"): Record<string, unknown> {
  return {
    id: "cli-workflow",
    name,
    version: 1,
    updatedAt: "2026-07-15T00:00:00.000Z",
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        name: "Trigger",
        enabled: true,
        version: 1,
        position: { x: 0, y: 0 },
        config: { triggerType: "manual" },
      },
      {
        id: "end",
        type: "end",
        name: "End",
        enabled: true,
        version: 1,
        position: { x: 200, y: 0 },
        config: { result },
      },
    ],
    edges: [
      {
        id: "trigger-end",
        sourceNodeId: "trigger",
        sourcePort: "started",
        targetNodeId: "end",
        targetPort: "input",
      },
    ],
  };
}
