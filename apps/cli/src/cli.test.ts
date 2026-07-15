import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliEntry = fileURLToPath(new URL("./index.ts", import.meta.url));
const cliDirectory = dirname(cliEntry);

test("CLI applies workflows idempotently and reports version conflicts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwf-cli-"));
  const database = join(directory, "piwf.db");
  const definitionFile = join(directory, "workflow.json");
  try {
    await writeFile(definitionFile, JSON.stringify(workflowDefinition("CLI workflow")), "utf8");
    const created = runCli(["--database", database, "--json", "workflow", "create", "--file", definitionFile]);
    assert.equal(created.status, 0, created.stderr);
    assert.equal(JSON.parse(created.stdout).workflow.definition.version, 1);

    const unchanged = runCli([
      "--database", database, "--json", "--if-version", "1",
      "workflow", "apply", "--file", definitionFile,
    ]);
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.equal(JSON.parse(unchanged.stdout).changed, false);

    await writeFile(definitionFile, JSON.stringify(workflowDefinition("CLI workflow updated")), "utf8");
    const updated = runCli([
      "--database", database, "--json", "--if-version", "1",
      "workflow", "apply", "--file", definitionFile,
    ]);
    assert.equal(updated.status, 0, updated.stderr);
    assert.equal(JSON.parse(updated.stdout).workflow.definition.version, 2);

    const conflict = runCli([
      "--database", database, "--json", "--if-version", "1",
      "workflow", "apply", "--file", definitionFile,
    ]);
    assert.equal(conflict.status, 5);
    assert.match(conflict.stderr, /version_conflict/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI dry-run returns validation without writing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwf-cli-dry-run-"));
  const database = join(directory, "piwf.db");
  const definitionFile = join(directory, "workflow.json");
  try {
    await writeFile(definitionFile, JSON.stringify(workflowDefinition("Preview")), "utf8");
    const preview = runCli([
      "--database", database, "--json", "--dry-run",
      "workflow", "create", "--file", definitionFile,
    ]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).dryRun, true);

    const listed = runCli(["--database", database, "--json", "workflow", "list"]);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout), []);
    assert.ok((await readFile(definitionFile, "utf8")).includes("Preview"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI node and edge commands mutate through the application service", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwf-cli-graph-"));
  const database = join(directory, "piwf.db");
  const definitionFile = join(directory, "workflow.json");
  try {
    await writeFile(definitionFile, JSON.stringify(workflowDefinition("Graph commands")), "utf8");
    assert.equal(runCli([
      "--database", database, "--json", "workflow", "create", "--file", definitionFile,
    ]).status, 0);

    const added = runCli([
      "--database", database, "--json", "--if-version", "1",
      "node", "add", "cli-workflow", "--type", "pi-agent", "--id", "agent",
      "--config", "{ prompt: 'Inspect the repository', maxTurns: 8 }",
    ]);
    assert.equal(added.status, 0, added.stderr);
    assert.equal(JSON.parse(added.stdout).workflow.definition.version, 2);

    const updated = runCli([
      "--database", database, "--json", "--if-version", "2",
      "node", "update", "cli-workflow", "agent", "--config", "{ timeoutSeconds: 90 }",
    ]);
    assert.equal(updated.status, 0, updated.stderr);
    const updatedAgent = JSON.parse(updated.stdout).workflow.definition.nodes
      .find((node: { id: string }) => node.id === "agent");
    assert.equal(updatedAgent.config.timeoutSeconds, 90);

    const disabled = runCli([
      "--database", database, "--json", "--if-version", "3",
      "node", "disable", "cli-workflow", "agent",
    ]);
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.equal(JSON.parse(disabled.stdout).workflow.definition.version, 4);

    const connected = runCli([
      "--database", database, "--json", "--if-version", "4",
      "edge", "connect", "cli-workflow", "trigger", "agent",
      "--source-port", "started", "--target-port", "input",
    ]);
    assert.equal(connected.status, 0, connected.stderr);
    assert.equal(JSON.parse(connected.stdout).workflow.definition.version, 5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI returns stable usage and validation exit codes", async () => {
  const unknown = runCli(["--json", "unknown-command"]);
  assert.equal(unknown.status, 2);
  assert.equal(JSON.parse(unknown.stderr).error.code, "usage_error");

  const directory = await mkdtemp(join(tmpdir(), "piwf-cli-validation-"));
  const database = join(directory, "piwf.db");
  const definitionFile = join(directory, "workflow.json");
  try {
    const invalid = workflowDefinition("Invalid workflow");
    invalid.nodes = (invalid.nodes as Array<{ type: string }>).filter((node) => node.type !== "end");
    invalid.edges = [];
    await writeFile(definitionFile, JSON.stringify(invalid), "utf8");
    assert.equal(runCli([
      "--database", database, "--json", "workflow", "create", "--file", definitionFile,
    ]).status, 0);
    const validation = runCli(["--database", database, "--json", "workflow", "validate", "cli-workflow"]);
    assert.equal(validation.status, 4);
    assert.equal(JSON.parse(validation.stdout).valid, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function runCli(arguments_: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", cliEntry, ...arguments_], {
    cwd: cliDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--disable-warning=ExperimentalWarning"].filter(Boolean).join(" "),
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function workflowDefinition(name: string): Record<string, unknown> {
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
        config: { result: "success" },
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
