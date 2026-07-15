import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkflowDefinition } from "@pi-workflow/contracts";
import { createWorkflowNode } from "@pi-workflow/workflow-core";
import { WorkflowApplicationService } from "./index.js";
import { SqliteWorkflowRepository } from "./sqlite-workflow-repository.js";

test("SQLite repository persists workflow versions across connections", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwf-repository-"));
  const databasePath = join(directory, "workflows.db");
  try {
    const firstRepository = new SqliteWorkflowRepository(databasePath);
    const firstService = new WorkflowApplicationService(firstRepository);
    await firstService.createWorkflow(validWorkflow());
    firstRepository.close();

    const secondRepository = new SqliteWorkflowRepository(databasePath);
    const secondService = new WorkflowApplicationService(secondRepository);
    const stored = await secondService.getWorkflow("sqlite-test");
    assert.equal(stored.definition.version, 1);
    assert.equal(stored.definition.name, "SQLite test");
    secondRepository.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function validWorkflow(): WorkflowDefinition {
  const trigger = createWorkflowNode({ id: "trigger", type: "trigger", name: "", position: { x: 0, y: 0 } });
  const end = createWorkflowNode({ id: "end", type: "end", name: "", position: { x: 200, y: 0 } });
  return {
    id: "sqlite-test",
    name: "SQLite test",
    version: 1,
    nodes: [trigger, end],
    edges: [{ id: "edge", sourceNodeId: "trigger", sourcePort: "started", targetNodeId: "end", targetPort: "input" }],
    updatedAt: new Date(0).toISOString(),
  };
}
