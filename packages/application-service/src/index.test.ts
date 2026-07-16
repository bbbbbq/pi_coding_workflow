import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowDefinition } from "@pi-workflow/contracts";
import { createWorkflowNode } from "@pi-workflow/workflow-core";
import {
  InMemoryWorkflowRepository,
  WorkflowApplicationError,
  WorkflowApplicationService,
} from "./index.js";

function workflow(): WorkflowDefinition {
  const trigger = createWorkflowNode({ id: "trigger", type: "trigger", name: "Trigger", position: { x: 0, y: 0 } });
  const end = createWorkflowNode({ id: "end", type: "end", name: "End", position: { x: 200, y: 0 } });
  return {
    id: "coding",
    name: "Coding",
    version: 99,
    nodes: [trigger, end],
    edges: [{ id: "trigger-end", sourceNodeId: trigger.id, sourcePort: "started", targetNodeId: end.id, targetPort: "input" }],
    updatedAt: new Date(0).toISOString(),
  };
}

test("apply is idempotent and uses optimistic workflow versions", async () => {
  const service = new WorkflowApplicationService(new InMemoryWorkflowRepository(), {
    now: () => "2026-07-15T00:00:00.000Z",
  });
  const created = await service.applyWorkflow(workflow());
  assert.equal(created.workflow.definition.version, 1);
  const unchanged = await service.applyWorkflow(workflow(), { ifVersion: 1 });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.workflow.definition.version, 1);

  const changedDefinition = workflow();
  changedDefinition.name = "Coding updated";
  const updated = await service.applyWorkflow(changedDefinition, { ifVersion: 1 });
  assert.equal(updated.workflow.definition.version, 2);
  assert.equal((await service.getWorkflowVersion("coding", 1)).name, "Coding");
  assert.equal((await service.getWorkflowVersion("coding", 2)).name, "Coding updated");

  await assert.rejects(
    service.applyWorkflow(workflow(), { ifVersion: 1 }),
    (error: unknown) => error instanceof WorkflowApplicationError && error.code === "version_conflict",
  );
});

test("node mutations return validation and respect dry-run", async () => {
  const repository = new InMemoryWorkflowRepository();
  const service = new WorkflowApplicationService(repository, {
    now: () => "2026-07-15T00:00:00.000Z",
    idFactory: () => "12345678-0000-0000-0000-000000000000",
  });
  await service.createWorkflow(workflow());
  const preview = await service.addNode("coding", { type: "pi-agent", name: "Agent" }, { dryRun: true, ifVersion: 1 });
  assert.equal(preview.dryRun, true);
  assert.ok(preview.workflow.definition.nodes.some((node) => node.id === "pi-agent-12345678"));
  assert.equal((await service.getWorkflow("coding")).definition.nodes.length, 2);

  const changed = await service.setNodeEnabled("coding", "end", false, { ifVersion: 1 });
  assert.equal(changed.workflow.definition.version, 2);
  assert.equal(changed.workflow.definition.nodes.find((node) => node.id === "end")?.enabled, false);
});

test("publish rejects invalid workflows", async () => {
  const service = new WorkflowApplicationService(new InMemoryWorkflowRepository());
  const invalid = workflow();
  invalid.nodes = invalid.nodes.filter((node) => node.type !== "end");
  invalid.edges = [];
  await service.createWorkflow(invalid);
  await assert.rejects(
    service.publishWorkflow("coding"),
    (error: unknown) => error instanceof WorkflowApplicationError && error.code === "validation_failed",
  );
});
