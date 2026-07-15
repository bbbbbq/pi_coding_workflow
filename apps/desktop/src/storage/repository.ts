import Database from "@tauri-apps/plugin-sql";
import type {
  ModelProvider,
  ModelRoute,
  WorkflowDefinition,
  WorkflowSchedule,
} from "@pi-workflow/contracts";

const databaseUrl = "sqlite:pi-workflow.db";

let databasePromise: Promise<Database> | undefined;
let initializationPromise: Promise<void> | undefined;

interface DefinitionRow {
  definition_json: string;
}

interface SettingRow {
  value: string;
}

interface ModelProviderRow {
  id: string;
  name: string;
  provider_type: ModelProvider["type"];
  base_url: string;
  secret_ref: string;
  custom_headers_json: string;
  timeout_ms: number;
  enabled: number;
  models_json: string;
  created_at: string;
  updated_at: string;
}

interface ModelRouteRow {
  id: string;
  name: string;
  strategy: ModelRoute["strategy"];
  enabled: number;
  candidates_json: string;
  created_at: string;
  updated_at: string;
}

interface ScheduleRow {
  id: string;
  name: string;
  workflow_id: string;
  workflow_name: string;
  workflow_version: number;
  repository_path: string;
  task: string;
  frequency: WorkflowSchedule["frequency"];
  scheduled_at: string;
  next_run_at: string | null;
  last_run_at: string | null;
  temporal_schedule_id: string | null;
  time_zone: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function initializePersistence(): Promise<void> {
  initializationPromise ??= getDatabase().then(() => undefined);
  return initializationPromise;
}

export async function getSetting(key: string): Promise<string | undefined> {
  const database = await readyDatabase();
  const rows = await database.select<SettingRow[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows[0]?.value;
}

export async function saveSetting(key: string, value: string): Promise<void> {
  const database = await readyDatabase();
  await database.execute(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ($1, $2, $3)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `, [key, value, new Date().toISOString()]);
}

export async function listModelProviders(): Promise<ModelProvider[]> {
  const database = await readyDatabase();
  const rows = await database.select<ModelProviderRow[]>(
    "SELECT * FROM model_providers ORDER BY updated_at DESC",
  );
  return rows.flatMap((row) => {
    const models = parseJson(row.models_json);
    const customHeaders = parseJson(row.custom_headers_json);
    return Array.isArray(models) && customHeaders && typeof customHeaders === "object"
      ? [{
          id: row.id,
          name: row.name,
          type: row.provider_type,
          baseUrl: row.base_url,
          secretRef: row.secret_ref,
          customHeaders: customHeaders as Record<string, string>,
          timeoutMs: row.timeout_ms,
          enabled: row.enabled === 1,
          models: models as ModelProvider["models"],
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }]
      : [];
  });
}

export async function saveModelProvider(provider: ModelProvider): Promise<void> {
  const database = await readyDatabase();
  await database.execute(`
    INSERT INTO model_providers (
      id, name, provider_type, base_url, secret_ref, custom_headers_json,
      timeout_ms, enabled, models_json, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      provider_type = excluded.provider_type,
      base_url = excluded.base_url,
      secret_ref = excluded.secret_ref,
      custom_headers_json = excluded.custom_headers_json,
      timeout_ms = excluded.timeout_ms,
      enabled = excluded.enabled,
      models_json = excluded.models_json,
      updated_at = excluded.updated_at
  `, [
    provider.id,
    provider.name,
    provider.type,
    provider.baseUrl,
    provider.secretRef,
    JSON.stringify(provider.customHeaders),
    provider.timeoutMs,
    provider.enabled ? 1 : 0,
    JSON.stringify(provider.models),
    provider.createdAt,
    provider.updatedAt,
  ]);
}

export async function deleteModelProvider(providerId: string): Promise<void> {
  const database = await readyDatabase();
  await database.execute("DELETE FROM model_providers WHERE id = $1", [providerId]);
}

export async function listModelRoutes(): Promise<ModelRoute[]> {
  const database = await readyDatabase();
  const rows = await database.select<ModelRouteRow[]>(
    "SELECT * FROM model_routes ORDER BY updated_at DESC",
  );
  return rows.flatMap((row) => {
    const candidates = parseJson(row.candidates_json);
    return Array.isArray(candidates)
      ? [{
          id: row.id,
          name: row.name,
          strategy: row.strategy,
          enabled: row.enabled === 1,
          candidates: candidates as ModelRoute["candidates"],
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }]
      : [];
  });
}

export async function saveModelRoute(route: ModelRoute): Promise<void> {
  const database = await readyDatabase();
  await database.execute(`
    INSERT INTO model_routes (
      id, name, strategy, enabled, candidates_json, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      strategy = excluded.strategy,
      enabled = excluded.enabled,
      candidates_json = excluded.candidates_json,
      updated_at = excluded.updated_at
  `, [
    route.id,
    route.name,
    route.strategy,
    route.enabled ? 1 : 0,
    JSON.stringify(route.candidates),
    route.createdAt,
    route.updatedAt,
  ]);
}

export async function deleteModelRoute(routeId: string): Promise<void> {
  const database = await readyDatabase();
  await database.execute("DELETE FROM model_routes WHERE id = $1", [routeId]);
}

export async function getLatestWorkflowDefinition(): Promise<WorkflowDefinition | undefined> {
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

export async function listSchedules(): Promise<WorkflowSchedule[]> {
  const database = await readyDatabase();
  const rows = await database.select<ScheduleRow[]>(`
    SELECT * FROM schedules ORDER BY updated_at DESC
  `);
  return rows.map(scheduleFromRow);
}

export async function saveSchedule(schedule: WorkflowSchedule): Promise<void> {
  const database = await readyDatabase();
  await saveSqliteSchedule(database, schedule);
}

export async function deleteScheduleRecord(scheduleId: string): Promise<void> {
  const database = await readyDatabase();
  await database.execute("DELETE FROM schedules WHERE id = $1", [scheduleId]);
}

async function readyDatabase(): Promise<Database> {
  await initializePersistence();
  return getDatabase();
}

function getDatabase(): Promise<Database> {
  databasePromise ??= Database.load(databaseUrl);
  return databasePromise;
}

async function saveSqliteSchedule(database: Database, schedule: WorkflowSchedule): Promise<void> {
  await database.execute(`
    INSERT INTO schedules (
      id, name, workflow_id, workflow_name, workflow_version, repository_path, task, frequency,
      scheduled_at, next_run_at, last_run_at, temporal_schedule_id,
      time_zone, enabled, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      workflow_name = excluded.workflow_name,
      workflow_version = excluded.workflow_version,
      repository_path = excluded.repository_path,
      task = excluded.task,
      frequency = excluded.frequency,
      scheduled_at = excluded.scheduled_at,
      next_run_at = excluded.next_run_at,
      last_run_at = excluded.last_run_at,
      temporal_schedule_id = excluded.temporal_schedule_id,
      time_zone = excluded.time_zone,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `, [
    schedule.id,
    schedule.name,
    schedule.workflowId,
    schedule.workflowName,
    schedule.workflowVersion,
    schedule.repositoryPath,
    schedule.task,
    schedule.frequency,
    schedule.scheduledAt,
    schedule.nextRunAt ?? null,
    schedule.lastRunAt ?? null,
    schedule.temporalScheduleId ?? null,
    schedule.timeZone,
    schedule.enabled ? 1 : 0,
    schedule.createdAt,
    schedule.updatedAt,
  ]);
}

function scheduleFromRow(row: ScheduleRow): WorkflowSchedule {
  return {
    id: row.id,
    name: row.name,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    workflowVersion: row.workflow_version,
    repositoryPath: row.repository_path,
    task: row.task,
    frequency: row.frequency,
    scheduledAt: row.scheduled_at,
    nextRunAt: row.next_run_at ?? undefined,
    lastRunAt: row.last_run_at ?? undefined,
    temporalScheduleId: row.temporal_schedule_id ?? undefined,
    timeZone: row.time_zone,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
