import type { ApprovalDecision, CodingWorkflowInput, ModelRoutingConfig } from "./index.js";
import type { WorkflowSchedule } from "./schedule.js";

export interface TemporalHealth {
  status: "ok";
  namespace: string;
  taskQueue: string;
}

export interface StartTemporalRunRequest {
  runId: string;
  workflowId: string;
  workflowVersion: number;
  repositoryPath: string;
  task: string;
  maxAttempts?: number;
  requirePlanApproval?: boolean;
  modelRouting?: ModelRoutingConfig;
  routeId?: string;
  providerId?: string;
  modelId?: string;
}

export interface TemporalRunRef {
  workflowId: string;
  runId: string;
}

export interface RegisterTemporalScheduleRequest {
  schedule: WorkflowSchedule;
  maxAttempts?: CodingWorkflowInput["maxAttempts"];
  requirePlanApproval?: CodingWorkflowInput["requirePlanApproval"];
  modelRouting?: CodingWorkflowInput["modelRouting"];
  routeId?: CodingWorkflowInput["routeId"];
  providerId?: CodingWorkflowInput["providerId"];
  modelId?: CodingWorkflowInput["modelId"];
}

export interface TemporalScheduleRef {
  scheduleId: string;
  paused: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  remainingActions?: number;
}

export interface TemporalApprovalRequest {
  decision: ApprovalDecision;
}
