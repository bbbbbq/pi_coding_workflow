import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowDefinition, WorkflowNodeType } from "@pi-workflow/contracts";
import {
  createWorkflowNode,
  validateWorkflowDefinition,
  workflowNodePorts,
} from "./index.js";

const nodeTypes: WorkflowNodeType[] = [
  "trigger",
  "pi-agent",
  "action",
  "condition",
  "loop",
  "parallel",
  "human",
  "wait-event",
  "subworkflow",
  "end",
];

function createTenNodeWorkflow(): WorkflowDefinition {
  const nodes = nodeTypes.map((type, index) => createWorkflowNode({
    id: `node-${index}`,
    type,
    name: type,
    position: { x: index * 200, y: 0 },
  }));
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${index}`,
    sourceNodeId: node.id,
    sourcePort: workflowNodePorts[node.type].outputs[0],
    targetNodeId: nodes[index + 1].id,
    targetPort: workflowNodePorts[nodes[index + 1].type].inputs[0],
  }));

  return {
    id: "test-workflow",
    name: "Ten node workflow",
    version: 1,
    nodes,
    edges,
    updatedAt: new Date(0).toISOString(),
  };
}

test("validates a workflow containing all ten supported node types", () => {
  const result = validateWorkflowDefinition(createTenNodeWorkflow());
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues.filter((issue) => issue.severity === "error"), []);
});

test("rejects a workflow without an end node", () => {
  const workflow = createTenNodeWorkflow();
  workflow.nodes = workflow.nodes.filter((node) => node.type !== "end");
  const result = validateWorkflowDefinition(workflow);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "missing_end"));
});

test("rejects an unbounded loop configuration", () => {
  const workflow = createTenNodeWorkflow();
  const loop = workflow.nodes.find((node) => node.type === "loop");
  if (loop?.type === "loop") loop.config.maxIterations = 0;
  const result = validateWorkflowDefinition(workflow);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "loop_limit"));
});
