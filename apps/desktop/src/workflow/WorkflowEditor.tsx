import { useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  addEdge,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
} from "@pi-workflow/contracts";
import {
  createWorkflowNode,
  validateWorkflowDefinition,
  workflowNodePorts,
} from "@pi-workflow/workflow-core";
import { useTranslation } from "react-i18next";
import { workflowNodeCatalog, workflowNodeVisuals } from "./catalog";
import { createExampleWorkflow } from "./exampleWorkflow";
import { NodeInspector } from "./NodeInspector";
import {
  WorkflowNodeCard,
  type WorkflowCanvasNode,
} from "./WorkflowNodeCard";
import "./workflowEditor.css";

const storageKey = "pi-workflow.definition.v1";
const nodeTypes = { "workflow-node": WorkflowNodeCard };

interface WorkflowEditorProps {
  onWorkflowSaved?: (definition: WorkflowDefinition) => void;
}

export function WorkflowEditor({ onWorkflowSaved }: WorkflowEditorProps) {
  const { t } = useTranslation();
  const initialDefinition = useMemo(loadInitialDefinition, []);
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowCanvasNode>(
    initialDefinition.nodes.map(toCanvasNode),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initialDefinition.edges.map(toCanvasEdge),
  );
  const [workflowName, setWorkflowName] = useState(initialDefinition.name);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [saveState, setSaveState] = useState<"draft" | "saved">("draft");

  const definition = useMemo(
    () => toWorkflowDefinition(initialDefinition.id, workflowName, nodes, edges),
    [edges, initialDefinition.id, nodes, workflowName],
  );
  const validation = useMemo(() => validateWorkflowDefinition(definition), [definition]);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId)?.data.workflowNode;
  const triggerExists = nodes.some((node) => node.data.workflowNode.type === "trigger");

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
      return;
    }

    setEdges((currentEdges) => addEdge({
      ...connection,
      id: `edge-${crypto.randomUUID()}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#687060" },
      style: { stroke: "#687060", strokeWidth: 1.5 },
      type: "smoothstep",
    }, currentEdges));
    setSaveState("draft");
  }, [setEdges]);

  const onReconnect = useCallback((edge: Edge, connection: Connection) => {
    if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
      return;
    }

    setEdges((currentEdges) => reconnectEdge(edge, connection, currentEdges));
    setSaveState("draft");
  }, [setEdges]);

  function addNode(type: WorkflowNodeType) {
    if (type === "trigger" && triggerExists) return;
    const index = nodes.length;
    const workflowNode = createWorkflowNode({
      id: `${type}-${crypto.randomUUID().slice(0, 8)}`,
      type,
      name: "",
      position: {
        x: 100 + (index % 4) * 240,
        y: 120 + Math.floor(index / 4) * 180,
      },
    });

    setNodes((currentNodes) => [...currentNodes, toCanvasNode(workflowNode)]);
    setSelectedNodeId(workflowNode.id);
    setSaveState("draft");
  }

  function updateNode(updatedNode: WorkflowNode) {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === updatedNode.id
        ? { ...node, data: { workflowNode: updatedNode } }
        : node
    )));
    setSaveState("draft");
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;
    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNodeId));
    setEdges((currentEdges) => currentEdges.filter(
      (edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId,
    ));
    setSelectedNodeId(undefined);
    setSaveState("draft");
  }

  function saveWorkflow() {
    const savedDefinition = {
      ...definition,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(storageKey, JSON.stringify(savedDefinition));
    onWorkflowSaved?.(savedDefinition);
    setSaveState("saved");
  }

  function resetWorkflow() {
    if (!window.confirm(t("builder.resetConfirm"))) return;
    const example = createExampleWorkflow();
    setNodes(example.nodes.map(toCanvasNode));
    setEdges(example.edges.map(toCanvasEdge));
    setWorkflowName(example.name);
    setSelectedNodeId(undefined);
    window.localStorage.removeItem(storageKey);
    onWorkflowSaved?.(example);
    setSaveState("draft");
  }

  return (
    <section className="workflow-builder">
      <header className="builder-toolbar">
        <div>
          <p className="section-index">{t("builder.index")}</p>
          <h2>{t("builder.title")}</h2>
          <p>{t("builder.subtitle")}</p>
        </div>

        <div className="builder-actions">
          <label className="workflow-name-field">
            <span>{t("builder.workflowName")}</span>
            <input
              value={workflowName}
              onChange={(event) => {
                setWorkflowName(event.target.value);
                setSaveState("draft");
              }}
            />
          </label>
          <button className="builder-secondary-button" onClick={resetWorkflow} type="button">
            {t("builder.reset")}
          </button>
          <button className="builder-save-button" onClick={saveWorkflow} type="button">
            {t("builder.save")}
          </button>
        </div>
      </header>

      <div className="builder-statusbar">
        <span className={validation.valid ? "is-valid" : "is-invalid"}>
          <i /> {validation.valid ? t("builder.valid") : t("builder.invalid", { count: validation.issues.length })}
        </span>
        <span>{nodes.length} {t("builder.nodesCount")}</span>
        <span>{edges.length} {t("builder.connectionsCount")}</span>
        <span className="save-state">{t(`builder.${saveState}`)}</span>
      </div>

      <div className="builder-layout">
        <aside className="node-library">
          <div className="library-heading">
            <p className="section-index">{t("builder.library.index")}</p>
            <h3>{t("builder.library.title")}</h3>
            <span>{t("builder.library.count")}</span>
          </div>

          <div className="node-library-list">
            {workflowNodeCatalog.map((item) => {
              const disabled = item.type === "trigger" && triggerExists;
              return (
                <button
                  data-testid={`node-palette-${item.type}`}
                  disabled={disabled}
                  key={item.type}
                  onClick={() => addNode(item.type)}
                  type="button"
                >
                  <span className="library-node-icon" style={{ color: item.color }}>{item.icon}</span>
                  <span>
                    <strong>{t(item.labelKey)}</strong>
                    <small>{t(item.descriptionKey)}</small>
                  </span>
                  <b>{disabled ? "•" : "+"}</b>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="workflow-canvas" data-testid="workflow-canvas">
          <div className="canvas-caption">
            <span>{t("builder.canvasTitle")}</span>
            <small>{t("builder.canvasHint")}</small>
          </div>
          <ReactFlow
            colorMode="light"
            defaultEdgeOptions={{
              markerEnd: { type: MarkerType.ArrowClosed, color: "#687060" },
              style: { stroke: "#687060", strokeWidth: 1.5 },
              type: "smoothstep",
            }}
            deleteKeyCode={["Backspace", "Delete"]}
            edges={edges}
            edgesReconnectable
            fitView
            fitViewOptions={{ padding: 0.16 }}
            maxZoom={1.5}
            minZoom={0.25}
            nodeTypes={nodeTypes}
            nodes={nodes}
            onConnect={onConnect}
            onEdgesChange={(changes) => {
              onEdgesChange(changes);
              setSaveState("draft");
            }}
            onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
            onNodesChange={(changes) => {
              onNodesChange(changes);
              if (changes.some((change) => change.type === "position" || change.type === "remove")) {
                setSaveState("draft");
              }
            }}
            onPaneClick={() => setSelectedNodeId(undefined)}
            onReconnect={onReconnect}
            proOptions={{ hideAttribution: true }}
            reconnectRadius={12}
          >
            <Background color="#dce4dc" gap={28} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              maskColor="rgba(238, 242, 236, 0.76)"
              nodeColor={(node) => workflowNodeVisuals[(node.data as WorkflowCanvasNode["data"]).workflowNode.type].color}
              pannable
              zoomable
            />
          </ReactFlow>
        </div>

        <div className="builder-inspector-column">
          <NodeInspector
            node={selectedNode}
            onChange={updateNode}
            onDelete={deleteSelectedNode}
          />

          <section className="validation-panel">
            <div>
              <p className="section-index">{t("builder.validation.index")}</p>
              <h3>{t("builder.validation.title")}</h3>
            </div>
            {validation.issues.length === 0 ? (
              <p className="validation-empty">{t("builder.validation.empty")}</p>
            ) : (
              <ul>
                {validation.issues.slice(0, 6).map((issue, index) => (
                  <li className={issue.severity} key={`${issue.code}-${issue.nodeId ?? issue.edgeId ?? index}`}>
                    <span>{issue.severity === "error" ? "!" : "·"}</span>
                    {t(`builder.validationCodes.${issue.code}`, { defaultValue: issue.message })}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}

function toCanvasNode(node: WorkflowNode): WorkflowCanvasNode {
  return {
    id: node.id,
    type: "workflow-node",
    position: node.position,
    data: { workflowNode: node },
  };
}

function toCanvasEdge(edge: WorkflowEdge): Edge {
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    sourceHandle: edge.sourcePort,
    target: edge.targetNodeId,
    targetHandle: edge.targetPort,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#687060" },
    style: { stroke: "#687060", strokeWidth: 1.5 },
    type: "smoothstep",
  };
}

function toWorkflowDefinition(
  id: string,
  name: string,
  nodes: WorkflowCanvasNode[],
  edges: Edge[],
): WorkflowDefinition {
  return {
    id,
    name,
    version: 1,
    nodes: nodes.map((node) => ({
      ...node.data.workflowNode,
      position: node.position,
    } as WorkflowNode)),
    edges: edges.flatMap((edge) => {
      const source = nodes.find((node) => node.id === edge.source);
      const target = nodes.find((node) => node.id === edge.target);
      if (!source || !target) return [];
      return [{
        id: edge.id,
        sourceNodeId: edge.source,
        sourcePort: edge.sourceHandle ?? workflowNodePorts[source.data.workflowNode.type].outputs[0] ?? "",
        targetNodeId: edge.target,
        targetPort: edge.targetHandle ?? workflowNodePorts[target.data.workflowNode.type].inputs[0] ?? "",
      }];
    }),
    updatedAt: new Date().toISOString(),
  };
}

function loadInitialDefinition(): WorkflowDefinition {
  return getStoredWorkflowDefinition() ?? createExampleWorkflow();
}

export function getStoredWorkflowDefinition(): WorkflowDefinition | undefined {
  const savedDefinition = window.localStorage.getItem(storageKey);
  if (!savedDefinition) return undefined;

  try {
    const parsed = JSON.parse(savedDefinition) as Partial<WorkflowDefinition>;
    if (
      typeof parsed.id === "string"
      && typeof parsed.name === "string"
      && Array.isArray(parsed.nodes)
      && Array.isArray(parsed.edges)
    ) {
      return parsed as WorkflowDefinition;
    }
  } catch {
    window.localStorage.removeItem(storageKey);
  }

  return undefined;
}
