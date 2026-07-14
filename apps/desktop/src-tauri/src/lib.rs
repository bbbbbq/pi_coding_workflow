use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_workflow_persistence",
        sql: r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS workflows (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                current_version INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workflow_versions (
                workflow_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                definition_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (workflow_id, version),
                FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS schedules (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                workflow_id TEXT NOT NULL,
                workflow_name TEXT NOT NULL,
                workflow_version INTEGER NOT NULL,
                frequency TEXT NOT NULL,
                scheduled_at TEXT NOT NULL,
                next_run_at TEXT,
                last_run_at TEXT,
                time_zone TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workflow_runs (
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
                FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS approvals (
                id TEXT PRIMARY KEY NOT NULL,
                run_id TEXT NOT NULL,
                node_id TEXT,
                title TEXT NOT NULL,
                status TEXT NOT NULL,
                requested_at TEXT NOT NULL,
                decided_at TEXT,
                comment TEXT,
                FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_workflow_versions_created
                ON workflow_versions(workflow_id, version DESC);
            CREATE INDEX IF NOT EXISTS idx_schedules_next_run
                ON schedules(enabled, next_run_at);
            CREATE INDEX IF NOT EXISTS idx_workflow_runs_updated
                ON workflow_runs(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_approvals_run
                ON approvals(run_id, requested_at DESC);
        "#,
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pi-workflow.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
