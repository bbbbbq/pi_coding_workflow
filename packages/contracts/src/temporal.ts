import type { ApprovalDecision, CodingWorkflowInput } from "./index.js";
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
}

export interface TemporalRunRef {
  workflowId: string;
  runId: string;
}

export interface RegisterTemporalScheduleRequest {
  schedule: WorkflowSchedule;
  maxAttempts?: CodingWorkflowInput["maxAttempts"];
  requirePlanApproval?: CodingWorkflowInput["requirePlanApproval"];
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
