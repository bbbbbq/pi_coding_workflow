import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  InMemoryWorkflowRepository,
  WorkflowApplicationService,
} from "@pi-workflow/application-service";
import {
  OrchestratorApplicationService,
  OrchestratorClientError,
} from "@pi-workflow/application-service/orchestrator-client";
import type { WorkflowDefinition } from "@pi-workflow/contracts";
import type { OrchestratorConfig } from "./config.js";
import { ModelRoutingService } from "./model-routing-service.js";
import { startApiServer } from "./server.js";
import type { TemporalService } from "./temporal-service.js";

const emptyModelRouting = new ModelRoutingService({ providers: [], routes: [] });
const temporal = {} as TemporalService;
const cliEntry = fileURLToPath(new URL("../../cli/src/index.ts", import.meta.url));

test("Workflow API exposes CRUD, validation, and optimistic mutation errors", async () => {
  const workflows = new WorkflowApplicationService(new InMemoryWorkflowRepository());
  const server = await startApiServer(temporal, config(":memory:"), emptyModelRouting, workflows);
  const baseUrl = serverBaseUrl(server);
  try {
    const created = await request(baseUrl, "/v1/workflows", {
      method: "POST",
      body: JSON.stringify({ definition: workflowDefinition("API workflow") }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.workflow.definition.version, 1);

    const added = await request(baseUrl, "/v1/workflows/api-workflow/nodes", {
      method: "POST",
      body: JSON.stringify({
        input: { id: "agent", type: "pi-agent", name: "Agent" },
        options: { ifVersion: 1 },
      }),
    });
    assert.equal(added.status, 200);
    assert.equal(added.body.workflow.definition.version, 2);

    const conflict = await request(baseUrl, "/v1/workflows/api-workflow/nodes/agent/disable", {
      method: "POST",
      body: JSON.stringify({ options: { ifVersion: 1 } }),
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, "version_conflict");

    const validation = await request(baseUrl, "/v1/workflows/api-workflow/validate", {
      method: "POST",
      body: "{}",
    });
    assert.equal(validation.status, 200);
    assert.equal(typeof validation.body.valid, "boolean");
  } finally {
    await closeServer(server);
  }
});

test("Orchestrator-owned SQLite remains the Workflow source of truth after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwf-orchestrator-api-"));
  const databasePath = join(directory, "workflows.db");
  try {
    const first = await startApiServer(temporal, config(databasePath), emptyModelRouting);
    try {
      const created = await request(serverBaseUrl(first), "/v1/workflows", {
        method: "POST",
        body: JSON.stringify({ definition: workflowDefinition("Persistent workflow") }),
      });
      assert.equal(created.status, 201);
    } finally {
      await closeServer(first);
    }

    const second = await startApiServer(temporal, config(databasePath), emptyModelRouting);
    try {
      const listed = await request(serverBaseUrl(second), "/v1/workflows");
      assert.equal(listed.status, 200);
      assert.equal(listed.body.length, 1);
      assert.equal(listed.body[0].id, "api-workflow");
    } finally {
      await closeServer(second);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("piwf uses the Orchestrator Workflow API instead of opening SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwf-cli-api-"));
  const definitionFile = join(directory, "workflow.json");
  const workflows = new WorkflowApplicationService(new InMemoryWorkflowRepository());
  const server = await startApiServer(temporal, config(":memory:"), emptyModelRouting, workflows);
  const baseUrl = serverBaseUrl(server);
  try {
    await writeFile(definitionFile, JSON.stringify(workflowDefinition("CLI over API")), "utf8");
    const created = await runCli([
      "--api-url", baseUrl, "--json", "workflow", "create", "--file", definitionFile,
    ]);
    assert.equal(created.status, 0, created.stderr);
    assert.equal(JSON.parse(created.stdout).workflow.definition.version, 1);

    const shown = await runCli(["--api-url", baseUrl, "--json", "workflow", "show", "api-workflow"]);
    assert.equal(shown.status, 0, shown.stderr);
    assert.equal(JSON.parse(shown.stdout).definition.name, "CLI over API");
    assert.equal((await workflows.listWorkflows()).length, 1);
  } finally {
    await closeServer(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared Desktop and CLI client matches the Workflow HTTP contract", async () => {
  const workflows = new WorkflowApplicationService(new InMemoryWorkflowRepository());
  const server = await startApiServer(temporal, config(":memory:"), emptyModelRouting, workflows);
  const client = new OrchestratorApplicationService(serverBaseUrl(server));
  try {
    const created = await client.createWorkflow(workflowDefinition("Shared client"));
    assert.equal(created.workflow.definition.version, 1);

    const added = await client.addNode(
      "api-workflow",
      { id: "agent", type: "pi-agent", name: "Agent" },
      { ifVersion: 1 },
    );
    assert.equal(added.workflow.definition.version, 2);

    await assert.rejects(
      client.setNodeEnabled("api-workflow", "agent", false, { ifVersion: 1 }),
      (error: unknown) => error instanceof OrchestratorClientError
        && error.status === 409
        && error.code === "version_conflict",
    );
  } finally {
    await closeServer(server);
  }
});

function config(workflowDatabasePath: string): OrchestratorConfig {
  return {
    temporalAddress: "localhost:7233",
    temporalNamespace: "default",
    taskQueue: "test-task-queue",
    apiHost: "127.0.0.1",
    apiPort: 0,
    allowedOrigins: new Set(),
    workflowDatabasePath,
  };
}

function serverBaseUrl(server: Awaited<ReturnType<typeof startApiServer>>): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Awaited<ReturnType<typeof startApiServer>>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function request(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
  return { status: response.status, body: await response.json() };
}

async function runCli(arguments_: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", cliEntry, ...arguments_], {
    cwd: fileURLToPath(new URL("../../cli", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const status = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  return {
    status,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

function workflowDefinition(name: string): WorkflowDefinition {
  return {
    id: "api-workflow",
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
    edges: [{
      id: "trigger-end",
      sourceNodeId: "trigger",
      sourcePort: "started",
      targetNodeId: "end",
      targetPort: "input",
    }],
  };
}
