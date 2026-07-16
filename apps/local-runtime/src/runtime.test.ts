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

test("local runtime exposes durable run state commands", async () => {
  const runtime = LocalRuntime.createForTesting(
    new WorkflowApplicationService(new InMemoryWorkflowRepository()),
  );
  const workflow = await runtime.request({
    id: "run-workflow-create",
    method: "workflow.create",
    params: { definition: workflowDefinition() },
  });
  assert.equal(workflow.ok, true);
  const created = await runtime.request({
    id: "run-create",
    method: "run.create",
    params: {
      input: {
        id: "RUN-LOCAL",
        workflowId: "local-runtime-test",
        workflowVersion: 1,
        title: "Local run",
        repository: "/repo",
      },
    },
  });
  assert.equal(created.ok, true);
  const started = await runtime.request({
    id: "run-start",
    method: "run.start",
    params: { runId: "RUN-LOCAL" },
  });
  assert.equal(started.ok, true);
  if (started.ok) assert.equal((started.result as { run: { status: string } }).run.status, "running");
  const final = await runtime.execution.waitForRun("RUN-LOCAL");
  assert.equal(final.status, "completed");
  assert.deepEqual((await runtime.runs.listEvents(final.id)).map((event) => event.type), [
    "run_created",
    "run_started",
    "node_started",
    "node_completed",
    "node_started",
    "node_completed",
    "run_completed",
  ]);
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
