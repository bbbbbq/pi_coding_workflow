import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  WorkflowApproval,
  WorkflowRunEvent,
  WorkflowRunRecord,
  WorkflowRunStatus,
} from "@pi-workflow/contracts";
import {
  RunStateConflictError,
  type RunStateCommit,
  type RunStateCommitResult,
  type RunStateRepository,
} from "./run-service.js";

interface RunRow {
  id: string;
  workflow_id: string;
  workflow_version: number;
  schedule_id: string | null;
  trigger_type: WorkflowRunRecord["trigger"];
  title: string;
  repository: string;
  task: string | null;
  status: WorkflowRunStatus;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  result_json: string | null;
  temporal_workflow_id: string | null;
  temporal_run_id: string | null;
}

interface EventRow {
  id: string;
  run_id: string;
  sequence: number;
  event_type: WorkflowRunEvent["type"];
  from_status: WorkflowRunStatus | null;
  to_status: WorkflowRunStatus;
  node_id: string | null;
  payload_json: string | null;
  created_at: string;
}

interface ApprovalRow {
  id: string;
  run_id: string;
  node_id: string | null;
  title: string;
  status: WorkflowApproval["status"];
  requested_at: string;
  decided_at: string | null;
  comment: string | null;
}

export class SqliteRunStateRepository implements RunStateRepository, Disposable {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS local_workflow_runs (
        id TEXT PRIMARY KEY NOT NULL,
        workflow_id TEXT NOT NULL,
        workflow_version INTEGER NOT NULL,
        schedule_id TEXT,
        trigger_type TEXT NOT NULL,
        title TEXT NOT NULL,
        repository TEXT NOT NULL,
        task TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        result_json TEXT,
        temporal_workflow_id TEXT,
        temporal_run_id TEXT
      );
      CREATE TABLE IF NOT EXISTS local_run_events (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        node_id TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (run_id, sequence),
        FOREIGN KEY (run_id) REFERENCES local_workflow_runs(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS local_run_approvals (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        node_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        decided_at TEXT,
        comment TEXT,
        FOREIGN KEY (run_id) REFERENCES local_workflow_runs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_local_runs_updated
        ON local_workflow_runs(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_local_run_events_sequence
        ON local_run_events(run_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_local_run_approvals_run
        ON local_run_approvals(run_id, requested_at DESC);
    `);
  }

  async listRuns(limit = 100): Promise<WorkflowRunRecord[]> {
    const rows = this.database.prepare(`
      SELECT * FROM local_workflow_runs ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as unknown as RunRow[];
    return rows.map(runFromRow);
  }

  async getRun(runId: string): Promise<WorkflowRunRecord | undefined> {
    const row = this.database.prepare(`
      SELECT * FROM local_workflow_runs WHERE id = ?
    `).get(runId) as unknown as RunRow | undefined;
    return row ? runFromRow(row) : undefined;
  }

  async listEvents(runId: string): Promise<WorkflowRunEvent[]> {
    const rows = this.database.prepare(`
      SELECT * FROM local_run_events WHERE run_id = ? ORDER BY sequence
    `).all(runId) as unknown as EventRow[];
    return rows.map(eventFromRow);
  }

  async listApprovals(runId: string): Promise<WorkflowApproval[]> {
    const rows = this.database.prepare(`
      SELECT * FROM local_run_approvals WHERE run_id = ? ORDER BY requested_at DESC
    `).all(runId) as unknown as ApprovalRow[];
    return rows.map(approvalFromRow);
  }

  async getApproval(approvalId: string): Promise<WorkflowApproval | undefined> {
    const row = this.database.prepare(`
      SELECT * FROM local_run_approvals WHERE id = ?
    `).get(approvalId) as unknown as ApprovalRow | undefined;
    return row ? approvalFromRow(row) : undefined;
  }

  async commit(input: RunStateCommit): Promise<RunStateCommitResult> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.database.prepare(`
        SELECT status FROM local_workflow_runs WHERE id = ?
      `).get(input.run.id) as { status: WorkflowRunStatus } | undefined;
      assertExpectedStatus(input.expectedStatus, current?.status);
      this.saveRun(input.run);
      const sequenceRow = this.database.prepare(`
        SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
        FROM local_run_events WHERE run_id = ?
      `).get(input.run.id) as { sequence: number };
      const storedEvent: WorkflowRunEvent = {
        ...input.event,
        sequence: sequenceRow.sequence,
      };
      this.database.prepare(`
        INSERT INTO local_run_events (
          id, run_id, sequence, event_type, from_status, to_status,
          node_id, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        storedEvent.id,
        storedEvent.runId,
        storedEvent.sequence,
        storedEvent.type,
        storedEvent.fromStatus ?? null,
        storedEvent.toStatus,
        storedEvent.nodeId ?? null,
        storedEvent.payload === undefined ? null : JSON.stringify(storedEvent.payload),
        storedEvent.createdAt,
      );
      if (input.approval) this.saveApproval(input.approval);
      this.database.exec("COMMIT");
      return { run: structuredClone(input.run), event: storedEvent, approval: input.approval ? structuredClone(input.approval) : undefined };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }

  private saveRun(run: WorkflowRunRecord): void {
    this.database.prepare(`
      INSERT INTO local_workflow_runs (
        id, workflow_id, workflow_version, schedule_id, trigger_type,
        title, repository, task, status, started_at, updated_at,
        completed_at, result_json, temporal_workflow_id, temporal_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        result_json = excluded.result_json,
        temporal_workflow_id = excluded.temporal_workflow_id,
        temporal_run_id = excluded.temporal_run_id
    `).run(
      run.id,
      run.workflowId,
      run.workflowVersion,
      run.scheduleId ?? null,
      run.trigger,
      run.title,
      run.repository,
      run.task ?? null,
      run.status,
      run.startedAt,
      run.updatedAt,
      run.completedAt ?? null,
      run.result === undefined ? null : JSON.stringify(run.result),
      run.temporalWorkflowId ?? null,
      run.temporalRunId ?? null,
    );
  }

  private saveApproval(approval: WorkflowApproval): void {
    this.database.prepare(`
      INSERT INTO local_run_approvals (
        id, run_id, node_id, title, status, requested_at, decided_at, comment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        decided_at = excluded.decided_at,
        comment = excluded.comment
    `).run(
      approval.id,
      approval.runId,
      approval.nodeId ?? null,
      approval.title,
      approval.status,
      approval.requestedAt,
      approval.decidedAt ?? null,
      approval.comment ?? null,
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

function runFromRow(row: RunRow): WorkflowRunRecord {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    scheduleId: row.schedule_id ?? undefined,
    trigger: row.trigger_type,
    title: row.title,
    repository: row.repository,
    task: row.task ?? undefined,
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    temporalWorkflowId: row.temporal_workflow_id ?? undefined,
    temporalRunId: row.temporal_run_id ?? undefined,
  };
}

function eventFromRow(row: EventRow): WorkflowRunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    type: row.event_type,
    fromStatus: row.from_status ?? undefined,
    toStatus: row.to_status,
    nodeId: row.node_id ?? undefined,
    payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
    createdAt: row.created_at,
  };
}

function approvalFromRow(row: ApprovalRow): WorkflowApproval {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id ?? undefined,
    title: row.title,
    status: row.status,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at ?? undefined,
    comment: row.comment ?? undefined,
  };
}
