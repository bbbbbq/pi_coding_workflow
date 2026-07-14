export type CodingRunPhase =
  | "preparing"
  | "planning"
  | "waiting_for_approval"
  | "implementing"
  | "validating"
  | "reviewing"
  | "completed"
  | "failed";

export interface CodingWorkflowInput {
  taskId: string;
  repositoryPath: string;
  task: string;
  maxAttempts?: number;
  requirePlanApproval?: boolean;
}

export interface WorkspaceRef {
  id: string;
  path: string;
}

export interface CodingPlan {
  summary: string;
  piSessionId: string;
}

export interface ApprovalDecision {
  approved: boolean;
  note?: string;
}

export interface CodingAttemptResult {
  status: "completed" | "needs_approval" | "needs_input" | "failed";
  piSessionId: string;
  messageCount: number;
  attempt: number;
}

export interface ValidationResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    output: string;
  }>;
}

export interface CodingWorkflowResult {
  taskId: string;
  status: "completed" | "rejected" | "failed";
  attempts: number;
  piSessionId?: string;
  validation?: ValidationResult;
}

export * from "./workflow.js";
export * from "./schedule.js";
export * from "./persistence.js";
