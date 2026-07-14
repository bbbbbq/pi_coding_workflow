import type { WorkflowNodeType } from "@pi-workflow/contracts";

export interface WorkflowNodeVisual {
  type: WorkflowNodeType;
  icon: string;
  color: string;
  labelKey: string;
  descriptionKey: string;
}

export const workflowNodeCatalog: WorkflowNodeVisual[] = [
  { type: "trigger", icon: "↯", color: "#4d7c0f", labelKey: "builder.nodes.trigger.label", descriptionKey: "builder.nodes.trigger.description" },
  { type: "pi-agent", icon: "π", color: "#2563eb", labelKey: "builder.nodes.piAgent.label", descriptionKey: "builder.nodes.piAgent.description" },
  { type: "action", icon: ">_", color: "#b45309", labelKey: "builder.nodes.action.label", descriptionKey: "builder.nodes.action.description" },
  { type: "condition", icon: "◇", color: "#a16207", labelKey: "builder.nodes.condition.label", descriptionKey: "builder.nodes.condition.description" },
  { type: "loop", icon: "↻", color: "#c2413b", labelKey: "builder.nodes.loop.label", descriptionKey: "builder.nodes.loop.description" },
  { type: "parallel", icon: "∥", color: "#7c3aed", labelKey: "builder.nodes.parallel.label", descriptionKey: "builder.nodes.parallel.description" },
  { type: "human", icon: "◎", color: "#be185d", labelKey: "builder.nodes.human.label", descriptionKey: "builder.nodes.human.description" },
  { type: "wait-event", icon: "◷", color: "#0f766e", labelKey: "builder.nodes.waitEvent.label", descriptionKey: "builder.nodes.waitEvent.description" },
  { type: "subworkflow", icon: "⤴", color: "#1d4ed8", labelKey: "builder.nodes.subworkflow.label", descriptionKey: "builder.nodes.subworkflow.description" },
  { type: "end", icon: "■", color: "#59635c", labelKey: "builder.nodes.end.label", descriptionKey: "builder.nodes.end.description" },
];

export const workflowNodeVisuals = Object.fromEntries(
  workflowNodeCatalog.map((node) => [node.type, node]),
) as Record<WorkflowNodeType, WorkflowNodeVisual>;
