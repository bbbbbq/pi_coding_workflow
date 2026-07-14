import {
  Handle,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { WorkflowNode } from "@pi-workflow/contracts";
import { workflowNodePorts } from "@pi-workflow/workflow-core";
import { useTranslation } from "react-i18next";
import { workflowNodeVisuals } from "./catalog";

export type WorkflowCanvasNodeData = {
  workflowNode: WorkflowNode;
} & Record<string, unknown>;

export type WorkflowCanvasNode = Node<WorkflowCanvasNodeData, "workflow-node">;

export function WorkflowNodeCard({ data, selected }: NodeProps<WorkflowCanvasNode>) {
  const { t } = useTranslation();
  const node = data.workflowNode;
  const visual = workflowNodeVisuals[node.type];
  const ports = workflowNodePorts[node.type];
  const displayName = node.name.trim() || t(visual.labelKey);

  return (
    <div
      className={`canvas-node canvas-node-${node.type} ${selected ? "is-selected" : ""}`}
      style={{ "--node-accent": visual.color } as React.CSSProperties}
    >
      {ports.inputs.map((port) => (
        <Handle
          className="canvas-handle canvas-handle-input"
          id={port}
          key={port}
          position={Position.Left}
          title={t(`builder.ports.${port}`)}
          type="target"
        />
      ))}

      <div className="canvas-node-head">
        <span className="canvas-node-icon">{visual.icon}</span>
        <span className="canvas-node-type">{t(visual.labelKey)}</span>
      </div>
      <strong>{displayName}</strong>
      <small>{t(visual.descriptionKey)}</small>

      <div className="canvas-node-ports" aria-label={t("builder.outputPorts")}>
        {ports.outputs.map((port, index) => (
          <span className="canvas-port" key={port}>
            {t(`builder.ports.${port}`)}
            <Handle
              className="canvas-handle canvas-handle-output"
              id={port}
              position={Position.Right}
              style={{ top: `${((index + 1) / (ports.outputs.length + 1)) * 100}%` }}
              title={t(`builder.ports.${port}`)}
              type="source"
            />
          </span>
        ))}
      </div>
    </div>
  );
}
