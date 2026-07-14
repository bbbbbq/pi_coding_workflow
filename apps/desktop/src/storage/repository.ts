import { isTauri } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type {
  WorkflowApproval,
  WorkflowDefinition,
  WorkflowRunRecord,
  WorkflowSchedule,
} from "@pi-workflow/contracts";

const databaseUrl = "sqlite:pi-workflow.db";
const workflowStorageKey = "pi-workflow.definition.v1";
const workflowVersionsStorageKey = "pi-workflow.workflow-versions.v1";
const schedulesStorageKey = "pi-workflow.schedules.v1";
const legacyRunsStorageKey = "pi-workflow.scheduled-runs.v1";
const runsStorageKey = "pi-workflow.runs.v1";
const approvalsStorageKey = "pi-workflow.approvals.v1";
const usesSqlite = isTauri();

let databasePromise: Promise<Database> | undefined;
let initializationPromise: Promise<void> | undefined;

interface CurrentVersionRow {
  current_version: number;
}

interface DefinitionRow {
  definition_json: string;
}

interface ScheduleRow {
  id: string;
  name: string;
  workflow_id: string;
  workflow_name: string;
  workflow_version: number;
  frequency: WorkflowSchedule["frequency"];
  scheduled_at: string;
  next_run_at: string | null;
  last_run_at: string | null;
  time_zone: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  workflow_id: string;
  workflow_version: number;
  schedule_id: string | null;
  trigger_type: WorkflowRunRecord["trigger"];
  title: string;
  repository: string;
  task: string | null;
  status: WorkflowRunRecord["status"];
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  result_json: string | null;
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

export function initializePersistence(): Promise<void> {
  initializationPromise ??= usesSqlite
    ? initializeSqlite()
    : initializeBrowserStorage();
  return initializationPromise;
}

export async function getLatestWorkflowDefinition(): Promise<WorkflowDefinition | undefined> {
  if (!usesSqlite) return getBrowserLatestWorkflow();
  const database = await readyDatabase();
  const rows = await database.select<DefinitionRow[]>(`
    SELECT versions.definition_json
    FROM workflows
    JOIN workflow_versions AS versions
      ON versions.workflow_id = workflows.id
      AND versions.version = workflows.current_version
    ORDER BY workflows.updated_at DESC
    LIMIT 1
  `);
  return parseDefinition(rows[0]?.definition_json);
}

export async function saveWorkflowDefinition(
  definition: WorkflowDefinition,
): Promise<WorkflowDefinition> {
  if (!usesSqlite) return saveBrowserWorkflow(definition);
  const database = await readyDatabase();
  const current = await database.select<CurrentVersionRow[]>(
    "SELECT current_version FROM workflows WHERE id = $1",
    [definition.id],
  );
  const now = new Date().toISOString();
  const version = (current[0]?.current_version ?? 0) + 1;
  const savedDefinition = { ...definition, version, updatedAt: now };

  await database.execute(`
    INSERT INTO workflows (id, name, current_version, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $4)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      current_version = excluded.current_version,
      updated_at = excluded.updated_at
  `, [definition.id, definition.name, version, now]);
  await database.execute(`
    INSERT INTO workflow_versions (workflow_id, version, definition_json, created_at)
    VALUES ($1, $2, $3, $4)
  `, [definition.id, version, JSON.stringify(savedDefinition), now]);

  return savedDefinition;
}

export async function listWorkflowVersions(workflowId: string): Promise<WorkflowDefinition[]> {
  if (!usesSqlite) return getBrowserWorkflowVersions(workflowId);
  const database = await readyDatabase();
  const rows = await database.select<DefinitionRow[]>(`
    SELECT definition_json
    FROM workflow_versions
    WHERE workflow_id = $1
    ORDER BY version DESC
  `, [workflowId]);
  return rows.flatMap((row) => {
    const definition = parseDefinition(row.definition_json);
    return definition ? [definition] : [];
  });
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  if (!usesSqlite) {
    deleteBrowserWorkflow(workflowId);
    return;
  }
  const database = await readyDatabase();
  await database.execute("DELETE FROM schedules WHERE workflow_id = $1", [workflowId]);
  await database.execute("DELETE FROM workflows WHERE id = $1", [workflowId]);
}

export async function listSchedules(): Promise<WorkflowSchedule[]> {
  if (!usesSqlite) return loadBrowserSchedules();
  const database = await readyDatabase();
  const rows = await database.select<ScheduleRow[]>(`
    SELECT * FROM schedules ORDER BY updated_at DESC
  `);
  return rows.map(scheduleFromRow);
}

export async function saveSchedule(schedule: WorkflowSchedule): Promise<void> {
  if (!usesSqlite) {
    const schedules = loadBrowserSchedules();
    const next = [schedule, ...schedules.filter((item) => item.id !== schedule.id)];
    writeJson(schedulesStorageKey, next);
    return;
  }
  const database = await readyDatabase();
  await saveSqliteSchedule(database, schedule);
}

export async function deleteScheduleRecord(scheduleId: string): Promise<void> {
  if (!usesSqlite) {
    writeJson(schedulesStorageKey, loadBrowserSchedules().filter((item) => item.id !== scheduleId));
    return;
  }
  const database = await readyDatabase();
  await database.execute("DELETE FROM schedules WHERE id = $1", [scheduleId]);
}

export async function listRuns(limit = 50): Promise<WorkflowRunRecord[]> {
  if (!usesSqlite) return loadBrowserRuns().slice(0, limit);
  const database = await readyDatabase();
  const rows = await database.select<RunRow[]>(`
    SELECT * FROM workflow_runs ORDER BY updated_at DESC LIMIT $1
  `, [limit]);
  return rows.map(runFromRow);
}

export async function saveRun(run: WorkflowRunRecord): Promise<void> {
  if (!usesSqlite) {
    const runs = loadBrowserRuns();
    writeJson(runsStorageKey, [run, ...runs.filter((item) => item.id !== run.id)].slice(0, 50));
    return;
  }
  const database = await readyDatabase();
  await saveSqliteRun(database, run);
}

export async function saveApproval(approval: WorkflowApproval): Promise<void> {
  if (!usesSqlite) {
    const approvals = readJson<WorkflowApproval[]>(approvalsStorageKey) ?? [];
    writeJson(approvalsStorageKey, [
      approval,
      ...approvals.filter((item) => item.id !== approval.id),
    ]);
    return;
  }
  const database = await readyDatabase();
  await database.execute(`
    INSERT INTO approvals (
      id, run_id, node_id, title, status, requested_at, decided_at, comment
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      decided_at = excluded.decided_at,
      comment = excluded.comment
  `, [
    approval.id,
    approval.runId,
    approval.nodeId ?? null,
    approval.title,
    approval.status,
    approval.requestedAt,
    approval.decidedAt ?? null,
    approval.comment ?? null,
  ]);
}

export async function listApprovals(runId: string): Promise<WorkflowApproval[]> {
  if (!usesSqlite) {
    return (readJson<WorkflowApproval[]>(approvalsStorageKey) ?? [])
      .filter((approval) => approval.runId === runId);
  }
  const database = await readyDatabase();
  const rows = await database.select<ApprovalRow[]>(`
    SELECT * FROM approvals WHERE run_id = $1 ORDER BY requested_at DESC
  `, [runId]);
  return rows.map(approvalFromRow);
}

async function initializeSqlite(): Promise<void> {
  const database = await getDatabase();
  await migrateLegacyStorage(database);
}

async function initializeBrowserStorage(): Promise<void> {
  const latest = getBrowserLatestWorkflow();
  if (latest && getBrowserWorkflowVersions(latest.id).length === 0) {
    writeJson(workflowVersionsStorageKey, { [latest.id]: [latest] });
  }
  loadBrowserRuns();
}

async function readyDatabase(): Promise<Database> {
  await initializePersistence();
  return getDatabase();
}

function getDatabase(): Promise<Database> {
  databasePromise ??= Database.load(databaseUrl);
  return databasePromise;
}

async function migrateLegacyStorage(database: Database): Promise<void> {
  const legacyWorkflow = readJson<WorkflowDefinition>(workflowStorageKey);
  if (legacyWorkflow) {
    const existing = await database.select<CurrentVersionRow[]>(
      "SELECT current_version FROM workflows WHERE id = $1",
      [legacyWorkflow.id],
    );
    if (existing.length === 0) {
      await saveSqliteWorkflowVersion(database, { ...legacyWorkflow, version: 1 });
    }
    window.localStorage.removeItem(workflowStorageKey);
  }

  const legacySchedules = readJson<unknown[]>(schedulesStorageKey) ?? [];
  for (const value of legacySchedules) {
    const schedule = normalizeSchedule(value);
    if (schedule) await saveSqliteSchedule(database, schedule);
  }
  if (legacySchedules.length > 0) window.localStorage.removeItem(schedulesStorageKey);

  const legacyRuns = readJson<unknown[]>(legacyRunsStorageKey) ?? [];
  for (const value of legacyRuns) {
    const run = normalizeLegacyRun(value);
    if (run) await saveSqliteRun(database, run);
  }
  if (legacyRuns.length > 0) window.localStorage.removeItem(legacyRunsStorageKey);
}

async function saveSqliteWorkflowVersion(
  database: Database,
  definition: WorkflowDefinition,
): Promise<void> {
  const now = definition.updatedAt || new Date().toISOString();
  await database.execute(`
    INSERT INTO workflows (id, name, current_version, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $4)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      current_version = excluded.current_version,
      updated_at = excluded.updated_at
  `, [definition.id, definition.name, definition.version, now]);
  await database.execute(`
    INSERT OR IGNORE INTO workflow_versions (workflow_id, version, definition_json, created_at)
    VALUES ($1, $2, $3, $4)
  `, [definition.id, definition.version, JSON.stringify(definition), now]);
}

async function saveSqliteSchedule(database: Database, schedule: WorkflowSchedule): Promise<void> {
  await database.execute(`
    INSERT INTO schedules (
      id, name, workflow_id, workflow_name, workflow_version, frequency,
      scheduled_at, next_run_at, last_run_at, time_zone, enabled, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      workflow_name = excluded.workflow_name,
      workflow_version = excluded.workflow_version,
      frequency = excluded.frequency,
      scheduled_at = excluded.scheduled_at,
      next_run_at = excluded.next_run_at,
      last_run_at = excluded.last_run_at,
      time_zone = excluded.time_zone,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `, [
    schedule.id,
    schedule.name,
    schedule.workflowId,
    schedule.workflowName,
    schedule.workflowVersion,
    schedule.frequency,
    schedule.scheduledAt,
    schedule.nextRunAt ?? null,
    schedule.lastRunAt ?? null,
    schedule.timeZone,
    schedule.enabled ? 1 : 0,
    schedule.createdAt,
    schedule.updatedAt,
  ]);
}

async function saveSqliteRun(database: Database, run: WorkflowRunRecord): Promise<void> {
  await database.execute(`
    INSERT INTO workflow_runs (
      id, workflow_id, workflow_version, schedule_id, trigger_type, title,
      repository, task, status, started_at, updated_at, completed_at, result_json
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at,
      result_json = excluded.result_json
  `, [
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
  ]);
}

function scheduleFromRow(row: ScheduleRow): WorkflowSchedule {
  return {
    id: row.id,
    name: row.name,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    workflowVersion: row.workflow_version,
    frequency: row.frequency,
    scheduledAt: row.scheduled_at,
    nextRunAt: row.next_run_at ?? undefined,
    lastRunAt: row.last_run_at ?? undefined,
    timeZone: row.time_zone,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
    result: row.result_json ? parseJson(row.result_json) : undefined,
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

function getBrowserLatestWorkflow(): WorkflowDefinition | undefined {
  return readJson<WorkflowDefinition>(workflowStorageKey);
}

function saveBrowserWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  const versions = readJson<Record<string, WorkflowDefinition[]>>(workflowVersionsStorageKey) ?? {};
  const version = Math.max(0, ...(versions[definition.id] ?? []).map((item) => item.version)) + 1;
  const saved = { ...definition, version, updatedAt: new Date().toISOString() };
  versions[definition.id] = [saved, ...(versions[definition.id] ?? [])];
  writeJson(workflowVersionsStorageKey, versions);
  writeJson(workflowStorageKey, saved);
  return saved;
}

function getBrowserWorkflowVersions(workflowId: string): WorkflowDefinition[] {
  const versions = readJson<Record<string, WorkflowDefinition[]>>(workflowVersionsStorageKey) ?? {};
  return versions[workflowId] ?? [];
}

function deleteBrowserWorkflow(workflowId: string): void {
  const latest = getBrowserLatestWorkflow();
  if (latest?.id === workflowId) window.localStorage.removeItem(workflowStorageKey);
  const versions = readJson<Record<string, WorkflowDefinition[]>>(workflowVersionsStorageKey) ?? {};
  delete versions[workflowId];
  writeJson(workflowVersionsStorageKey, versions);
  writeJson(schedulesStorageKey, loadBrowserSchedules().filter((item) => item.workflowId !== workflowId));
}

function loadBrowserSchedules(): WorkflowSchedule[] {
  const values = readJson<unknown[]>(schedulesStorageKey) ?? [];
  return values.flatMap((value) => {
    const schedule = normalizeSchedule(value);
    return schedule ? [schedule] : [];
  });
}

function loadBrowserRuns(): WorkflowRunRecord[] {
  const current = readJson<WorkflowRunRecord[]>(runsStorageKey);
  if (current) return current;
  const legacy = readJson<unknown[]>(legacyRunsStorageKey) ?? [];
  const migrated = legacy.flatMap((value) => {
    const run = normalizeLegacyRun(value);
    return run ? [run] : [];
  });
  writeJson(runsStorageKey, migrated);
  if (legacy.length > 0) window.localStorage.removeItem(legacyRunsStorageKey);
  return migrated;
}

function normalizeSchedule(value: unknown): WorkflowSchedule | undefined {
  if (!value || typeof value !== "object") return undefined;
  const schedule = value as Partial<WorkflowSchedule>;
  if (
    typeof schedule.id !== "string"
    || typeof schedule.name !== "string"
    || typeof schedule.workflowId !== "string"
    || typeof schedule.workflowName !== "string"
    || typeof schedule.scheduledAt !== "string"
    || (schedule.frequency !== "once" && schedule.frequency !== "daily" && schedule.frequency !== "weekly")
  ) return undefined;

  return {
    ...schedule,
    workflowVersion: typeof schedule.workflowVersion === "number" ? schedule.workflowVersion : 1,
    timeZone: schedule.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    enabled: schedule.enabled === true,
    createdAt: schedule.createdAt ?? new Date().toISOString(),
    updatedAt: schedule.updatedAt ?? new Date().toISOString(),
  } as WorkflowSchedule;
}

function normalizeLegacyRun(value: unknown): WorkflowRunRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const run = value as Record<string, unknown>;
  if (typeof run.id !== "string" || typeof run.repository !== "string") return undefined;
  const now = new Date().toISOString();
  return {
    id: run.id,
    workflowId: "coding-workflow",
    workflowVersion: 1,
    trigger: "schedule",
    title: typeof run.title === "string" ? run.title : "Coding workflow",
    repository: run.repository,
    status: run.status === "complete" ? "completed" : run.status === "review" ? "review" : "running",
    startedAt: now,
    updatedAt: now,
  };
}

function parseDefinition(value: string | undefined): WorkflowDefinition | undefined {
  const parsed = value ? parseJson(value) : undefined;
  if (!parsed || typeof parsed !== "object") return undefined;
  const definition = parsed as Partial<WorkflowDefinition>;
  return typeof definition.id === "string"
    && typeof definition.name === "string"
    && Array.isArray(definition.nodes)
    && Array.isArray(definition.edges)
    ? definition as WorkflowDefinition
    : undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function readJson<T>(key: string): T | undefined {
  const value = window.localStorage.getItem(key);
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    window.localStorage.removeItem(key);
    return undefined;
  }
}

function writeJson(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}
