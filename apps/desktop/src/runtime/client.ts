import { invoke } from "@tauri-apps/api/core";
import type {
  AddWorkflowNodeInput,
  ChangeOptions,
  ConnectWorkflowEdgeInput,
  CreateRunInput,
  RunStateCommitResult,
  UpdateWorkflowNodeInput,
  WorkflowChangeResult,
  WorkflowRecord,
  WorkflowSummary,
} from "@pi-workflow/application-service";
import type {
  ApprovalDecision,
  WorkflowApproval,
  WorkflowDefinition,
  WorkflowRunEvent,
  WorkflowRunRecord,
  WorkflowValidationResult,
} from "@pi-workflow/contracts";

interface RuntimeResponse<Result> {
  id: string;
  ok: boolean;
  result?: Result;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class DesktopRuntimeError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = "DesktopRuntimeError";
  }
}

export class DesktopRuntimeClient {
  health(): Promise<{ status: "ok"; transport: "stdio" }> {
    return this.request("runtime.health");
  }

  listWorkflows(): Promise<WorkflowSummary[]> {
    return this.request("workflow.list");
  }

  getWorkflow(workflowId: string): Promise<WorkflowRecord> {
    return this.request("workflow.get", { workflowId });
  }

  createWorkflow(definition: WorkflowDefinition, options: ChangeOptions = {}): Promise<WorkflowChangeResult> {
    return this.request("workflow.create", { definition, options });
  }

  applyWorkflow(definition: WorkflowDefinition, options: ChangeOptions = {}): Promise<WorkflowChangeResult> {
    return this.request("workflow.apply", { definition, options });
  }

  validateWorkflow(workflowId: string): Promise<WorkflowValidationResult> {
    return this.request("workflow.validate", { workflowId });
  }

  publishWorkflow(workflowId: string, options: ChangeOptions = {}): Promise<WorkflowChangeResult> {
    return this.request("workflow.publish", { workflowId, options });
  }

  deleteWorkflow(workflowId: string, options: ChangeOptions = {}): Promise<{ id: string; deleted: boolean; dryRun: boolean }> {
    return this.request("workflow.delete", { workflowId, options });
  }

  addNode(workflowId: string, input: AddWorkflowNodeInput, options: ChangeOptions = {}): Promise<WorkflowChangeResult> {
    return this.request("node.add", { workflowId, input, options });
  }

  updateNode(workflowId: string, nodeId: string, input: UpdateWorkflowNodeInput, options: ChangeOptions = {}): Promise<WorkflowChangeResult> {
    return this.request("node.update", { workflowId, nodeId, input, options });
  }

  setNodeEnabled(workflowId: string, nodeId: string, enabled: boolean, options: ChangeOptions = {}): Promise<WorkflowChangeResult> {
    return this.request(enabled ? "node.enable" : "node.disable", { workflowId, nodeId, options });
  }

  removeNode(workflowId: string, nodeId: string, options: ChangeOptions = {}): Promise<WorkflowChangeResult> {
    return this.request("node.remove", { workflowId, nodeId, options });
  }

  connectEdge(workflowId: string, input: ConnectWorkflowEdgeInput, options: ChangeOptions = {}): Promise<WorkflowChangeResult> {
    return this.request("edge.connect", { workflowId, input, options });
  }

  listRuns(): Promise<WorkflowRunRecord[]> {
    return this.request("run.list");
  }

  getRun(runId: string): Promise<WorkflowRunRecord> {
    return this.request("run.get", { runId });
  }

  listRunEvents(runId: string): Promise<WorkflowRunEvent[]> {
    return this.request("run.events", { runId });
  }

  listApprovals(runId: string): Promise<WorkflowApproval[]> {
    return this.request("approval.list", { runId });
  }

  createRun(input: CreateRunInput): Promise<RunStateCommitResult> {
    return this.request("run.create", { input });
  }

  startRun(runId: string): Promise<RunStateCommitResult> {
    return this.request("run.start", { runId });
  }

  pauseRun(runId: string): Promise<RunStateCommitResult> {
    return this.request("run.pause", { runId });
  }

  resumeRun(runId: string): Promise<RunStateCommitResult> {
    return this.request("run.resume", { runId });
  }

  cancelRun(runId: string): Promise<RunStateCommitResult> {
    return this.request("run.cancel", { runId });
  }

  decideApproval(runId: string, approvalId: string, decision: ApprovalDecision): Promise<RunStateCommitResult> {
    return this.request("approval.decide", { runId, approvalId, decision });
  }

  private async request<Result>(method: string, params: Record<string, unknown> = {}): Promise<Result> {
    const id = crypto.randomUUID();
    const response = await invoke<RuntimeResponse<Result>>("runtime_request", {
      request: { id, method, params },
    });
    if (!response.ok || response.result === undefined) {
      throw new DesktopRuntimeError(
        response.error?.code ?? "runtime_error",
        response.error?.message ?? "Local runtime request failed.",
        response.error?.details,
      );
    }
    return response.result;
  }
}

export const desktopRuntime = new DesktopRuntimeClient();
