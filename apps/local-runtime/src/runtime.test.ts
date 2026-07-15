import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryWorkflowRepository,
  WorkflowApplicationService,
} from "@pi-workflow/application-service";
import { LocalRuntime } from "./runtime.js";

test("local runtime dispatches Workflow commands without HTTP", async () => {
  const runtime = LocalRuntime.createForTesting(
    new WorkflowApplicationService(new InMemoryWorkflowRepository()),
  );
  const created = await runtime.request({
    id: "create-1",
    method: "workflow.create",
    params: { definition: workflowDefinition() },
  });
  assert.equal(created.ok, true);

  const listed = await runtime.request({ id: "list-1", method: "workflow.list" });
  assert.equal(listed.ok, true);
  if (listed.ok) assert.equal((listed.result as unknown[]).length, 1);
});

test("local runtime returns structured input errors", async () => {
  const runtime = LocalRuntime.createForTesting(
    new WorkflowApplicationService(new InMemoryWorkflowRepository()),
  );
  const response = await runtime.request({ id: "get-1", method: "workflow.get" });
  assert.equal(response.ok, false);
  if (!response.ok) assert.equal(response.error.code, "input_invalid");
});

function workflowDefinition(): Record<string, unknown> {
  return {
    id: "local-runtime-test",
    name: "Local runtime test",
    version: 1,
    updatedAt: "2026-07-15T00:00:00.000Z",
    nodes: [
      { id: "trigger", type: "trigger", name: "", version: 1, position: { x: 0, y: 0 }, config: { triggerType: "manual" } },
      { id: "end", type: "end", name: "", version: 1, position: { x: 200, y: 0 }, config: { result: "success" } },
    ],
    edges: [{ id: "edge", sourceNodeId: "trigger", sourcePort: "started", targetNodeId: "end", targetPort: "input" }],
  };
}
