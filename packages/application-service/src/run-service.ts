import type {
  ApprovalDecision,
  WorkflowApproval,
  WorkflowRunEvent,
  WorkflowRunEventType,
  WorkflowRunRecord,
  WorkflowRunStatus,
} from "@pi-workflow/contracts";

export interface CreateRunInput {
  id?: string;
  workflowId: string;
  workflowVersion: number;
  scheduleId?: string;
  trigger?: WorkflowRunRecord["trigger"];
  title: string;
  repository: string;
  task?: string;
}

export interface RequestRunApprovalInput {
  id?: string;
  nodeId?: string;
  title: string;
}

export interface RunStateCommit {
  run: WorkflowRunRecord;
  expectedStatus: WorkflowRunStatus | null;
  event: Omit<WorkflowRunEvent, "sequence">;
  approval?: WorkflowApproval;
}

export interface RunStateCommitResult {
  run: WorkflowRunRecord;
  event: WorkflowRunEvent;
  approval?: WorkflowApproval;
}

export interface RunStateRepository {
  listRuns(limit?: number): Promise<WorkflowRunRecord[]>;
  getRun(runId: string): Promise<WorkflowRunRecord | undefined>;
  listEvents(runId: string): Promise<WorkflowRunEvent[]>;
  listApprovals(runId: string): Promise<WorkflowApproval[]>;
  getApproval(approvalId: string): Promise<WorkflowApproval | undefined>;
  commit(input: RunStateCommit): Promise<RunStateCommitResult>;
}

export class RunStateConflictError extends Error {
  constructor(
    readonly expectedStatus: WorkflowRunStatus | null,
    readonly actualStatus: WorkflowRunStatus | undefined,
  ) {
    super(`Run state conflict: expected ${expectedStatus ?? "new"}, found ${actualStatus ?? "missing"}.`);
    this.name = "RunStateConflictError";
  }
}

export type RunApplicationErrorCode =
  | "run_not_found"
  | "run_exists"
  | "run_state_conflict"
  | "run_transition_invalid"
  | "approval_not_found"
  | "approval_already_decided"
  | "input_invalid";

export class RunApplicationError extends Error {
  constructor(
    readonly code: RunApplicationErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "RunApplicationError";
  }
}

export interface RunApplicationServiceOptions {
  now?: () => string;
  idFactory?: () => string;
}

export type WorkflowNodeRunEventType = Extract<
  WorkflowRunEventType,
  "node_started" | "node_completed" | "node_failed" | "node_skipped"
>;

export class RunApplicationService {
  private readonly now: () => string;
  private readonly idFactory: () => string;

  constructor(
    private readonly repository: RunStateRepository,
    options: RunApplicationServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  listRuns(limit = 100): Promise<WorkflowRunRecord[]> {
    return this.repository.listRuns(limit);
  }

  async getRun(runId: string): Promise<WorkflowRunRecord> {
    const run = await this.repository.getRun(runId);
    if (!run) throw new RunApplicationError("run_not_found", `Run '${runId}' was not found.`);
    return run;
  }

  listEvents(runId: string): Promise<WorkflowRunEvent[]> {
    return this.repository.listEvents(runId);
  }

  listApprovals(runId: string): Promise<WorkflowApproval[]> {
    return this.repository.listApprovals(runId);
  }

  async createRun(input: CreateRunInput): Promise<RunStateCommitResult> {
    if (!input.workflowId.trim() || !input.title.trim() || !input.repository.trim()) {
      throw new RunApplicationError("input_invalid", "workflowId, title, and repository are required.");
    }
    const now = this.now();
    const run: WorkflowRunRecord = {
      id: input.id ?? `RUN-${this.idFactory()}`,
      workflowId: input.workflowId,
      workflowVersion: input.workflowVersion,
      scheduleId: input.scheduleId,
      trigger: input.trigger ?? "manual",
      title: input.title,
      repository: input.repository,
      task: input.task,
      status: "queued",
      startedAt: now,
      updatedAt: now,
    };
    return this.commit({
      run,
      expectedStatus: null,
      event: event(this.idFactory(), run.id, "run_created", undefined, "queued", now),
    }, "run_exists");
  }

  startRun(runId: string): Promise<RunStateCommitResult> {
    return this.transition(runId, "running", "run_started");
  }

  pauseRun(runId: string): Promise<RunStateCommitResult> {
    return this.transition(runId, "paused", "run_paused");
  }

  resumeRun(runId: string): Promise<RunStateCommitResult> {
    return this.transition(runId, "queued", "run_resumed");
  }

  interruptRun(runId: string, payload?: unknown): Promise<RunStateCommitResult> {
    return this.transition(runId, "interrupted", "run_interrupted", { payload });
  }

  completeRun(runId: string, payload?: unknown): Promise<RunStateCommitResult> {
    return this.transition(runId, "completed", "run_completed", { payload, result: payload });
  }

  failRun(runId: string, payload?: unknown): Promise<RunStateCommitResult> {
    return this.transition(runId, "failed", "run_failed", { payload, result: payload });
  }

  cancelRun(runId: string, payload?: unknown): Promise<RunStateCommitResult> {
    return this.transition(runId, "cancelled", "run_cancelled", { payload, result: payload });
  }

  async recordNodeEvent(
    runId: string,
    type: WorkflowNodeRunEventType,
    nodeId: string,
    payload?: unknown,
  ): Promise<RunStateCommitResult> {
    const current = await this.getRun(runId);
    if (current.status !== "running") {
      throw new RunApplicationError(
        "run_transition_invalid",
        `Node events cannot be recorded while Run is '${current.status}'.`,
        { runId, nodeId, status: current.status },
      );
    }
    const now = this.now();
    return this.commit({
      run: { ...current, updatedAt: now },
      expectedStatus: current.status,
      event: event(this.idFactory(), runId, type, current.status, current.status, now, nodeId, payload),
    });
  }

  async requestApproval(
    runId: string,
    input: RequestRunApprovalInput,
  ): Promise<RunStateCommitResult> {
    const current = await this.getRun(runId);
    assertTransition(current.status, "waiting_for_approval");
    const now = this.now();
    const approval: WorkflowApproval = {
      id: input.id ?? `APPROVAL-${this.idFactory()}`,
      runId,
      nodeId: input.nodeId,
      title: input.title,
      status: "pending",
      requestedAt: now,
    };
    return this.commit({
      run: updateRun(current, "waiting_for_approval", now),
      expectedStatus: current.status,
      event: event(
        this.idFactory(), runId, "approval_requested", current.status,
        "waiting_for_approval", now, input.nodeId, { approvalId: approval.id },
      ),
      approval,
    });
  }

  async decideApproval(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<RunStateCommitResult> {
    const current = await this.getRun(runId);
    const approval = await this.repository.getApproval(approvalId);
    if (!approval || approval.runId !== runId) {
      throw new RunApplicationError("approval_not_found", `Approval '${approvalId}' was not found.`);
    }
    if (approval.status !== "pending") {
      throw new RunApplicationError("approval_already_decided", `Approval '${approvalId}' is already decided.`);
    }
    const target = "queued";
    assertTransition(current.status, target);
    const now = this.now();
    const updatedApproval: WorkflowApproval = {
      ...approval,
      status: decision.approved ? "approved" : "rejected",
      decidedAt: now,
      comment: decision.note,
    };
    return this.commit({
      run: updateRun(current, target, now),
      expectedStatus: current.status,
      event: event(
        this.idFactory(), runId,
        decision.approved ? "approval_approved" : "approval_rejected",
        current.status, target, now, approval.nodeId, { approvalId },
      ),
      approval: updatedApproval,
    });
  }

  private async transition(
    runId: string,
    target: WorkflowRunStatus,
    type: WorkflowRunEventType,
    options: { payload?: unknown; result?: unknown } = {},
  ): Promise<RunStateCommitResult> {
    const current = await this.getRun(runId);
    assertTransition(current.status, target);
    const now = this.now();
    return this.commit({
      run: updateRun(current, target, now, options.result),
      expectedStatus: current.status,
      event: event(
        this.idFactory(), runId, type, current.status, target, now,
        undefined, options.payload,
      ),
    });
  }

  private async commit(
    input: RunStateCommit,
    conflictCode: "run_exists" | "run_state_conflict" = "run_state_conflict",
  ): Promise<RunStateCommitResult> {
    try {
      return await this.repository.commit(input);
    } catch (error) {
      if (error instanceof RunStateConflictError) {
        throw new RunApplicationError(conflictCode, error.message, {
          expectedStatus: error.expectedStatus,
          actualStatus: error.actualStatus,
        });
      }
      throw error;
    }
  }
}

export class InMemoryRunStateRepository implements RunStateRepository {
  private readonly runs = new Map<string, WorkflowRunRecord>();
  private readonly events = new Map<string, WorkflowRunEvent[]>();
  private readonly approvals = new Map<string, WorkflowApproval>();

  async listRuns(limit = 100): Promise<WorkflowRunRecord[]> {
    return [...this.runs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit).map(clone);
  }

  async getRun(runId: string): Promise<WorkflowRunRecord | undefined> {
    const run = this.runs.get(runId);
    return run ? clone(run) : undefined;
  }

  async listEvents(runId: string): Promise<WorkflowRunEvent[]> {
    return (this.events.get(runId) ?? []).map(clone);
  }

  async listApprovals(runId: string): Promise<WorkflowApproval[]> {
    return [...this.approvals.values()].filter((approval) => approval.runId === runId).map(clone);
  }

  async getApproval(approvalId: string): Promise<WorkflowApproval | undefined> {
    const approval = this.approvals.get(approvalId);
    return approval ? clone(approval) : undefined;
  }

  async commit(input: RunStateCommit): Promise<RunStateCommitResult> {
    const current = this.runs.get(input.run.id);
    assertExpectedStatus(input.expectedStatus, current?.status);
    const runEvents = this.events.get(input.run.id) ?? [];
    const storedEvent = { ...input.event, sequence: runEvents.length + 1 };
    this.runs.set(input.run.id, clone(input.run));
    this.events.set(input.run.id, [...runEvents, clone(storedEvent)]);
    if (input.approval) this.approvals.set(input.approval.id, clone(input.approval));
    return { run: clone(input.run), event: clone(storedEvent), approval: input.approval ? clone(input.approval) : undefined };
  }
}

const allowedTransitions: Partial<Record<WorkflowRunStatus, WorkflowRunStatus[]>> = {
  queued: ["running", "cancelled"],
  running: ["waiting_for_approval", "paused", "completed", "failed", "cancelled", "interrupted"],
  waiting_for_approval: ["queued", "cancelled"],
  paused: ["queued", "cancelled"],
  interrupted: ["queued", "failed", "cancelled"],
  review: ["queued", "cancelled"],
};

function assertTransition(from: WorkflowRunStatus, to: WorkflowRunStatus): void {
  if (!allowedTransitions[from]?.includes(to)) {
    throw new RunApplicationError(
      "run_transition_invalid",
      `Run cannot transition from '${from}' to '${to}'.`,
      { from, to },
    );
  }
}

function assertExpectedStatus(
  expected: WorkflowRunStatus | null,
  actual: WorkflowRunStatus | undefined,
): void {
  if (expected === null ? actual !== undefined : actual !== expected) {
    throw new RunStateConflictError(expected, actual);
  }
}

function updateRun(
  run: WorkflowRunRecord,
  status: WorkflowRunStatus,
  updatedAt: string,
  result?: unknown,
): WorkflowRunRecord {
  return {
    ...run,
    status,
    updatedAt,
    completedAt: ["completed", "failed", "cancelled"].includes(status) ? updatedAt : undefined,
    ...(result === undefined ? {} : { result }),
  };
}

function event(
  id: string,
  runId: string,
  type: WorkflowRunEventType,
  fromStatus: WorkflowRunStatus | undefined,
  toStatus: WorkflowRunStatus,
  createdAt: string,
  nodeId?: string,
  payload?: unknown,
): Omit<WorkflowRunEvent, "sequence"> {
  return { id, runId, type, fromStatus, toStatus, createdAt, nodeId, payload };
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}
