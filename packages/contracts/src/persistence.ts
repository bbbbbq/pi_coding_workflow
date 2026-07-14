export type WorkflowRunTrigger = "manual" | "schedule";

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "review"
  | "completed"
  | "failed"
  | "cancelled";

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  workflowVersion: number;
  scheduleId?: string;
  trigger: WorkflowRunTrigger;
  title: string;
  repository: string;
  task?: string;
  status: WorkflowRunStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  result?: unknown;
  temporalWorkflowId?: string;
  temporalRunId?: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface WorkflowApproval {
  id: string;
  runId: string;
  nodeId?: string;
  title: string;
  status: ApprovalStatus;
  requestedAt: string;
  decidedAt?: string;
  comment?: string;
}
