import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowDefinition, WorkflowNodeType } from "@pi-workflow/contracts";
import {
  createWorkflowNode,
  getDelayDurationMilliseconds,
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
  "delay",
  "wait-event",
  "subworkflow",
  "end",
];

function createElevenNodeWorkflow(): WorkflowDefinition {
  const nodes = nodeTypes.map((type, index) => createWorkflowNode({
    id: `node-${index}`,
    type,
    name: type,
    position: { x: index * 200, y: 0 },
  }));
  const edges = nodes.slice(0, -1).flatMap((node, index) => (
    workflowNodePorts[node.type].outputs.map((sourcePort) => ({
      id: `edge-${index}-${sourcePort}`,
      sourceNodeId: node.id,
      sourcePort,
      targetNodeId: nodes[index + 1].id,
      targetPort: workflowNodePorts[nodes[index + 1].type].inputs[0],
    }))
  ));

  return {
    id: "test-workflow",
    name: "Eleven node workflow",
    version: 1,
    nodes,
    edges,
    updatedAt: new Date(0).toISOString(),
  };
}

test("validates a workflow containing all eleven supported node types", () => {
  const result = validateWorkflowDefinition(createElevenNodeWorkflow());
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues.filter((issue) => issue.severity === "error"), []);
});

test("rejects a workflow without an end node", () => {
  const workflow = createElevenNodeWorkflow();
  workflow.nodes = workflow.nodes.filter((node) => node.type !== "end");
  const result = validateWorkflowDefinition(workflow);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "missing_end"));
});

test("rejects an unbounded loop configuration", () => {
  const workflow = createElevenNodeWorkflow();
  const loop = workflow.nodes.find((node) => node.type === "loop");
  if (loop?.type === "loop") loop.config.maxIterations = 0;
  const result = validateWorkflowDefinition(workflow);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "loop_limit"));
});

test("rejects missing deterministic branch connections", () => {
  const workflow = createElevenNodeWorkflow();
  const condition = workflow.nodes.find((node) => node.type === "condition");
  workflow.edges = workflow.edges.filter(
    (edge) => edge.sourceNodeId !== condition?.id || edge.sourcePort !== "false",
  );
  const result = validateWorkflowDefinition(workflow);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(
    (issue) => issue.code === "missing_output_connection" && issue.nodeId === condition?.id,
  ));
});

test("converts delay units and rejects non-positive durations", () => {
  assert.equal(getDelayDurationMilliseconds({ duration: 2, unit: "minutes" }), 120_000);

  const workflow = createElevenNodeWorkflow();
  const delay = workflow.nodes.find((node) => node.type === "delay");
  if (delay?.type === "delay") delay.config.duration = 0;
  const result = validateWorkflowDefinition(workflow);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "delay_duration"));
});
