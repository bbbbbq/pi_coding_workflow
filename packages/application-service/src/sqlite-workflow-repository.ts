import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  RepositoryVersionConflictError,
  type WorkflowRecord,
  type WorkflowRepository,
  type WorkflowSaveOptions,
} from "./index.js";

interface WorkflowRow {
  id: string;
  definition_json: string;
  lifecycle_status: WorkflowRecord["status"];
  created_at: string;
  updated_at: string;
  published_at: string | null;
  current_version: number;
}

export class SqliteWorkflowRepository implements WorkflowRepository, Disposable {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS application_workflows (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        current_version INTEGER NOT NULL,
        lifecycle_status TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        published_at TEXT
      );
      CREATE TABLE IF NOT EXISTS application_workflow_versions (
        workflow_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workflow_id, version),
        FOREIGN KEY (workflow_id) REFERENCES application_workflows(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_application_workflows_updated
        ON application_workflows(updated_at DESC);
    `);
  }

  async list(): Promise<WorkflowRecord[]> {
    const rows = this.database.prepare(`
      SELECT * FROM application_workflows ORDER BY updated_at DESC
    `).all() as unknown as WorkflowRow[];
    return rows.map(fromRow);
  }

  async get(workflowId: string): Promise<WorkflowRecord | undefined> {
    const row = this.database.prepare(`
      SELECT * FROM application_workflows WHERE id = ?
    `).get(workflowId) as unknown as WorkflowRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  async save(record: WorkflowRecord, options: WorkflowSaveOptions = {}): Promise<void> {
    this.transaction(() => {
      const currentVersion = this.currentVersion(record.definition.id);
      assertVersion(options.expectedVersion, currentVersion);
      this.database.prepare(`
        INSERT INTO application_workflows (
          id, name, current_version, lifecycle_status, definition_json,
          created_at, updated_at, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          current_version = excluded.current_version,
          lifecycle_status = excluded.lifecycle_status,
          definition_json = excluded.definition_json,
          updated_at = excluded.updated_at,
          published_at = excluded.published_at
      `).run(
        record.definition.id,
        record.definition.name,
        record.definition.version,
        record.status,
        JSON.stringify(record.definition),
        record.createdAt,
        record.updatedAt,
        record.publishedAt ?? null,
      );
      this.database.prepare(`
        INSERT INTO application_workflow_versions (
          workflow_id, version, definition_json, created_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(workflow_id, version) DO UPDATE SET
          definition_json = excluded.definition_json
      `).run(
        record.definition.id,
        record.definition.version,
        JSON.stringify(record.definition),
        record.updatedAt,
      );
    });
  }

  async delete(workflowId: string, options: WorkflowSaveOptions = {}): Promise<void> {
    this.transaction(() => {
      const currentVersion = this.currentVersion(workflowId);
      assertVersion(options.expectedVersion, currentVersion);
      this.database.prepare("DELETE FROM application_workflows WHERE id = ?").run(workflowId);
    });
  }

  close(): void {
    this.database.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }

  private currentVersion(workflowId: string): number | undefined {
    const row = this.database.prepare(`
      SELECT current_version FROM application_workflows WHERE id = ?
    `).get(workflowId) as { current_version: number } | undefined;
    return row?.current_version;
  }

  private transaction(action: () => void): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function assertVersion(expected: number | null | undefined, actual: number | undefined): void {
  if (expected === undefined) return;
  if (expected === null ? actual !== undefined : actual !== expected) {
    throw new RepositoryVersionConflictError(expected, actual);
  }
}

function fromRow(row: WorkflowRow): WorkflowRecord {
  return {
    definition: JSON.parse(row.definition_json) as WorkflowRecord["definition"],
    status: row.lifecycle_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at ?? undefined,
  };
}
