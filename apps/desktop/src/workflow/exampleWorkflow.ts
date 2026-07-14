import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
} from "@pi-workflow/contracts";
import { createWorkflowNode } from "@pi-workflow/workflow-core";

const nodeLayout: Array<{
  id: string;
  type: WorkflowNodeType;
  x: number;
  y: number;
}> = [
  { id: "trigger", type: "trigger", x: 20, y: 190 },
  { id: "agent", type: "pi-agent", x: 260, y: 190 },
  { id: "human", type: "human", x: 510, y: 50 },
  { id: "action", type: "action", x: 510, y: 310 },
  { id: "parallel", type: "parallel", x: 760, y: 310 },
  { id: "condition", type: "condition", x: 1010, y: 310 },
  { id: "subworkflow", type: "subworkflow", x: 1260, y: 160 },
  { id: "loop", type: "loop", x: 1260, y: 440 },
  { id: "wait", type: "wait-event", x: 1010, y: 560 },
  { id: "end", type: "end", x: 1510, y: 310 },
];

const edgeSpecs: Array<[string, string, string, string, string]> = [
  ["trigger-agent", "trigger", "started", "agent", "input"],
  ["agent-human", "agent", "completed", "human", "input"],
  ["agent-end", "agent", "failed", "end", "input"],
  ["human-action", "human", "approved", "action", "input"],
  ["human-end", "human", "rejected", "end", "input"],
  ["action-parallel", "action", "success", "parallel", "input"],
  ["action-loop", "action", "failure", "loop", "input"],
  ["parallel-condition", "parallel", "completed", "condition", "input"],
  ["parallel-loop", "parallel", "failed", "loop", "input"],
  ["condition-subworkflow", "condition", "true", "subworkflow", "input"],
  ["condition-loop", "condition", "false", "loop", "input"],
  ["subworkflow-end", "subworkflow", "completed", "end", "input"],
  ["subworkflow-loop", "subworkflow", "failed", "loop", "input"],
  ["loop-wait", "loop", "continue", "wait", "input"],
  ["loop-end", "loop", "exhausted", "end", "input"],
  ["wait-agent", "wait", "completed", "agent", "input"],
  ["wait-end", "wait", "timeout", "end", "input"],
];

export function createExampleWorkflow(): WorkflowDefinition {
  const nodes: WorkflowNode[] = nodeLayout.map((item) => createWorkflowNode({
    id: item.id,
    type: item.type,
    name: "",
    position: { x: item.x, y: item.y },
  }));
  const edges: WorkflowEdge[] = edgeSpecs.map(([id, sourceNodeId, sourcePort, targetNodeId, targetPort]) => ({
    id,
    sourceNodeId,
    sourcePort,
    targetNodeId,
    targetPort,
  }));

  return {
    id: "coding-workflow",
    name: "Coding workflow",
    version: 1,
    nodes,
    edges,
    updatedAt: new Date().toISOString(),
  };
}
