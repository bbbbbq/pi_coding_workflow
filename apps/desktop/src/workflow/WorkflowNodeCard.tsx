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

const attachmentOffsets = [8, 22, 36, 50, 64, 78, 92];
const attachmentSides = [Position.Top, Position.Right, Position.Bottom, Position.Left];

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

      {ports.inputs.length > 0 && attachmentSides.flatMap((position) => (
        attachmentOffsets.map((offset) => (
          <Handle
            className="canvas-attachment-handle"
            id={attachmentHandleId("target", position, offset)}
            isConnectableStart={false}
            key={`target-${position}-${offset}`}
            position={position}
            style={attachmentHandleStyle(position, offset)}
            type="target"
          />
        ))
      ))}

      {ports.outputs.length > 0 && attachmentSides.flatMap((position) => (
        attachmentOffsets.map((offset) => (
          <Handle
            className="canvas-attachment-handle"
            id={attachmentHandleId("source", position, offset)}
            isConnectableStart={false}
            key={`source-${position}-${offset}`}
            position={position}
            style={attachmentHandleStyle(position, offset)}
            type="source"
          />
        ))
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

function attachmentHandleId(type: "source" | "target", position: Position, offset: number): string {
  return `__attach-${type}-${position}-${offset}`;
}

function attachmentHandleStyle(position: Position, offset: number): React.CSSProperties {
  return position === Position.Left || position === Position.Right
    ? { top: `${offset}%` }
    : { left: `${offset}%` };
}
