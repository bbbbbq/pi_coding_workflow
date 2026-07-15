import type {
  DelayNodeConfig,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeConfigMap,
  WorkflowNodeType,
  WorkflowValidationIssue,
  WorkflowValidationResult,
} from "@pi-workflow/contracts";

export {
  advanceWorkflowSchedule,
  calculateNextRunAt,
  isWorkflowScheduleDue,
} from "./schedule.js";

export interface WorkflowNodePorts {
  inputs: string[];
  outputs: string[];
}

export const workflowNodePorts: Record<WorkflowNodeType, WorkflowNodePorts> = {
  trigger: { inputs: [], outputs: ["started"] },
  "pi-agent": { inputs: ["input"], outputs: ["completed", "failed"] },
  action: { inputs: ["input"], outputs: ["success", "failure"] },
  condition: { inputs: ["input"], outputs: ["true", "false"] },
  loop: { inputs: ["input"], outputs: ["continue", "exhausted"] },
  parallel: { inputs: ["input"], outputs: ["completed", "failed"] },
  human: { inputs: ["input"], outputs: ["approved", "rejected"] },
  delay: { inputs: ["input"], outputs: ["completed"] },
  "wait-event": { inputs: ["input"], outputs: ["completed", "timeout"] },
  subworkflow: { inputs: ["input"], outputs: ["completed", "failed"] },
  end: { inputs: ["input"], outputs: [] },
};

export function defaultNodeConfig<Type extends WorkflowNodeType>(
  type: Type,
): WorkflowNodeConfigMap[Type] {
  const configs: WorkflowNodeConfigMap = {
    trigger: { triggerType: "manual" },
    "pi-agent": {
      mode: "implement",
      prompt: "",
      tools: ["read", "grep", "find", "ls", "edit", "bash"],
      maxTurns: 20,
      timeoutSeconds: 1800,
      sessionStrategy: "new",
      routeId: "coding-default",
    },
    action: {
      handler: "shell",
      command: "git status --short",
      timeoutSeconds: 300,
    },
    condition: { expression: "validation.passed === true" },
    loop: {
      maxIterations: 3,
      continueCondition: "validation.passed === false",
      onExhausted: "human",
    },
    parallel: {
      joinStrategy: "all",
      failureStrategy: "collect_all",
    },
    human: {
      mode: "approve",
      title: "Review request",
      description: "Review the workflow output before it continues.",
      timeoutHours: 24,
    },
    delay: {
      duration: 5,
      unit: "minutes",
    },
    "wait-event": {
      waitType: "duration",
      durationSeconds: 60,
      timeoutSeconds: 3600,
    },
    subworkflow: {
      workflowId: "validation-workflow",
      workflowVersion: 1,
    },
    end: { result: "success" },
  };

  return structuredClone(configs[type]);
}

export function getDelayDurationMilliseconds(config: DelayNodeConfig): number {
  const unitMilliseconds: Record<DelayNodeConfig["unit"], number> = {
    seconds: 1_000,
    minutes: 60_000,
    hours: 3_600_000,
  };
  return config.duration * unitMilliseconds[config.unit];
}

export function createWorkflowNode<Type extends WorkflowNodeType>(input: {
  id: string;
  type: Type;
  name: string;
  position: { x: number; y: number };
}): WorkflowNode {
  return {
    id: input.id,
    type: input.type,
    name: input.name,
    enabled: true,
    version: 1,
    position: input.position,
    config: defaultNodeConfig(input.type),
  } as unknown as WorkflowNode;
}

export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const node of definition.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ severity: "error", code: "duplicate_node", message: "Node IDs must be unique.", nodeId: node.id });
    }
    nodeIds.add(node.id);
  }

  const triggers = definition.nodes.filter((node) => node.type === "trigger");
  if (triggers.length !== 1) {
    issues.push({ severity: "error", code: "trigger_count", message: "A workflow must contain exactly one Trigger node." });
  }

  if (!definition.nodes.some((node) => node.type === "end")) {
    issues.push({ severity: "error", code: "missing_end", message: "A workflow must contain at least one End node." });
  }

  for (const node of definition.nodes) {
    if (node.type === "loop" && (node.config.maxIterations < 1 || node.config.maxIterations > 50)) {
      issues.push({ severity: "error", code: "loop_limit", message: "Loop iterations must be between 1 and 50.", nodeId: node.id });
    }
    if (node.type === "pi-agent" && (node.config.maxTurns < 1 || node.config.maxTurns > 200)) {
      issues.push({ severity: "error", code: "agent_turn_limit", message: "Pi Agent max turns must be between 1 and 200.", nodeId: node.id });
    }
    if (node.type === "delay" && (!Number.isFinite(node.config.duration) || node.config.duration <= 0)) {
      issues.push({ severity: "error", code: "delay_duration", message: "Delay duration must be greater than zero.", nodeId: node.id });
    }
    if (node.type === "delay" && !["seconds", "minutes", "hours"].includes(node.config.unit)) {
      issues.push({ severity: "error", code: "delay_unit", message: "Delay unit is invalid.", nodeId: node.id });
    }
    if (node.type === "subworkflow" && node.config.workflowId.trim().length === 0) {
      issues.push({ severity: "error", code: "subworkflow_id", message: "Subworkflow ID is required.", nodeId: node.id });
    }
  }

  for (const edge of definition.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push({ severity: "error", code: "duplicate_edge", message: "Edge IDs must be unique.", edgeId: edge.id });
    }
    edgeIds.add(edge.id);

    const source = definition.nodes.find((node) => node.id === edge.sourceNodeId);
    const target = definition.nodes.find((node) => node.id === edge.targetNodeId);
    if (!source || !target) {
      issues.push({ severity: "error", code: "missing_edge_node", message: "Every edge must reference existing nodes.", edgeId: edge.id });
      continue;
    }
    if (!workflowNodePorts[source.type].outputs.includes(edge.sourcePort)) {
      issues.push({ severity: "error", code: "invalid_source_port", message: "Edge source port is invalid for its node type.", edgeId: edge.id, nodeId: source.id });
    }
    if (!workflowNodePorts[target.type].inputs.includes(edge.targetPort)) {
      issues.push({ severity: "error", code: "invalid_target_port", message: "Edge target port is invalid for its node type.", edgeId: edge.id, nodeId: target.id });
    }
  }

  if (triggers.length === 1) {
    const reachable = collectReachableNodes(triggers[0].id, definition.edges);
    for (const node of definition.nodes) {
      if (!reachable.has(node.id)) {
        issues.push({ severity: "warning", code: "unreachable_node", message: "Node is not reachable from the Trigger.", nodeId: node.id });
      }
    }
  }

  for (const node of definition.nodes) {
    const hasIncoming = definition.edges.some((edge) => edge.targetNodeId === node.id);
    const hasOutgoing = definition.edges.some((edge) => edge.sourceNodeId === node.id);
    if (node.type !== "trigger" && !hasIncoming) {
      issues.push({ severity: "warning", code: "missing_incoming", message: "Node has no incoming connection.", nodeId: node.id });
    }
    if (node.type !== "end" && !hasOutgoing) {
      issues.push({ severity: "warning", code: "missing_outgoing", message: "Node has no outgoing connection.", nodeId: node.id });
    }
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

function collectReachableNodes(startNodeId: string, edges: WorkflowEdge[]): Set<string> {
  const reachable = new Set([startNodeId]);
  const queue = [startNodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const edge of edges) {
      if (edge.sourceNodeId === current && !reachable.has(edge.targetNodeId)) {
        reachable.add(edge.targetNodeId);
        queue.push(edge.targetNodeId);
      }
    }
  }

  return reachable;
}
