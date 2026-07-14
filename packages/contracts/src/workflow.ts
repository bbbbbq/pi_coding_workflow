export const workflowNodeTypes = [
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
] as const;

export type WorkflowNodeType = (typeof workflowNodeTypes)[number];

export interface TriggerNodeConfig {
  triggerType: "manual" | "webhook" | "schedule" | "api";
  expression?: string;
}

export interface PiAgentNodeConfig {
  mode: "analyze" | "plan" | "implement" | "repair" | "review";
  prompt: string;
  tools: string[];
  maxTurns: number;
  timeoutSeconds: number;
  sessionStrategy: "new" | "continue";
}

export interface ActionNodeConfig {
  handler: "git" | "shell" | "test" | "build" | "http" | "artifact" | "transform";
  command: string;
  timeoutSeconds: number;
}

export interface ConditionNodeConfig {
  expression: string;
}

export interface LoopNodeConfig {
  maxIterations: number;
  continueCondition: string;
  onExhausted: "fail" | "human" | "continue";
}

export interface ParallelNodeConfig {
  joinStrategy: "all" | "any" | "first_success";
  failureStrategy: "fail_fast" | "collect_all";
}

export interface HumanNodeConfig {
  mode: "approve" | "input" | "select" | "review_diff";
  title: string;
  description: string;
  timeoutHours?: number;
}

export interface WaitEventNodeConfig {
  waitType: "duration" | "datetime" | "webhook" | "external_event";
  durationSeconds?: number;
  eventName?: string;
  timeoutSeconds?: number;
}

export interface SubworkflowNodeConfig {
  workflowId: string;
  workflowVersion: number;
}

export interface EndNodeConfig {
  result: "success" | "failed" | "cancelled" | "escalated";
}

export interface WorkflowNodeConfigMap {
  trigger: TriggerNodeConfig;
  "pi-agent": PiAgentNodeConfig;
  action: ActionNodeConfig;
  condition: ConditionNodeConfig;
  loop: LoopNodeConfig;
  parallel: ParallelNodeConfig;
  human: HumanNodeConfig;
  "wait-event": WaitEventNodeConfig;
  subworkflow: SubworkflowNodeConfig;
  end: EndNodeConfig;
}

export interface WorkflowNodeBase<
  Type extends WorkflowNodeType,
  Config extends WorkflowNodeConfigMap[Type],
> {
  id: string;
  type: Type;
  name: string;
  version: number;
  position: {
    x: number;
    y: number;
  };
  config: Config;
}

export type WorkflowNode = {
  [Type in WorkflowNodeType]: WorkflowNodeBase<Type, WorkflowNodeConfigMap[Type]>;
}[WorkflowNodeType];

export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  updatedAt: string;
}

export interface WorkflowValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  issues: WorkflowValidationIssue[];
}
