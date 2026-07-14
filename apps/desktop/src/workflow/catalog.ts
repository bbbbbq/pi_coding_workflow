import type { WorkflowNodeType } from "@pi-workflow/contracts";

export interface WorkflowNodeVisual {
  type: WorkflowNodeType;
  icon: string;
  color: string;
  labelKey: string;
  descriptionKey: string;
}

export const workflowNodeCatalog: WorkflowNodeVisual[] = [
  { type: "trigger", icon: "↯", color: "#c6f04d", labelKey: "builder.nodes.trigger.label", descriptionKey: "builder.nodes.trigger.description" },
  { type: "pi-agent", icon: "π", color: "#75b8ff", labelKey: "builder.nodes.piAgent.label", descriptionKey: "builder.nodes.piAgent.description" },
  { type: "action", icon: ">_", color: "#ed8d53", labelKey: "builder.nodes.action.label", descriptionKey: "builder.nodes.action.description" },
  { type: "condition", icon: "◇", color: "#f3d36a", labelKey: "builder.nodes.condition.label", descriptionKey: "builder.nodes.condition.description" },
  { type: "loop", icon: "↻", color: "#ff807a", labelKey: "builder.nodes.loop.label", descriptionKey: "builder.nodes.loop.description" },
  { type: "parallel", icon: "∥", color: "#ab91ff", labelKey: "builder.nodes.parallel.label", descriptionKey: "builder.nodes.parallel.description" },
  { type: "human", icon: "◎", color: "#f5a9cf", labelKey: "builder.nodes.human.label", descriptionKey: "builder.nodes.human.description" },
  { type: "wait-event", icon: "◷", color: "#69d5c3", labelKey: "builder.nodes.waitEvent.label", descriptionKey: "builder.nodes.waitEvent.description" },
  { type: "subworkflow", icon: "⤴", color: "#85a8ff", labelKey: "builder.nodes.subworkflow.label", descriptionKey: "builder.nodes.subworkflow.description" },
  { type: "end", icon: "■", color: "#aeb5aa", labelKey: "builder.nodes.end.label", descriptionKey: "builder.nodes.end.description" },
];

export const workflowNodeVisuals = Object.fromEntries(
  workflowNodeCatalog.map((node) => [node.type, node]),
) as Record<WorkflowNodeType, WorkflowNodeVisual>;
