export type WorkflowRunTrigger = "manual" | "schedule";

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "paused"
  | "interrupted"
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

export const workflowRunEventTypes = [
  "run_created",
  "run_started",
  "run_paused",
  "run_resumed",
  "approval_requested",
  "approval_approved",
  "approval_rejected",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "run_interrupted",
] as const;

export type WorkflowRunEventType = (typeof workflowRunEventTypes)[number];

export interface WorkflowRunEvent {
  id: string;
  runId: string;
  sequence: number;
  type: WorkflowRunEventType;
  fromStatus?: WorkflowRunStatus;
  toStatus: WorkflowRunStatus;
  nodeId?: string;
  payload?: unknown;
  createdAt: string;
}
