use std::{collections::HashMap, time::Duration};

use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri_plugin_sql::{Migration, MigrationKind};

const KEYCHAIN_SERVICE: &str = "com.caojunze.piworkflow.model-provider";

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
    }, Migration {
        version: 2,
        description: "add_temporal_execution_metadata",
        sql: r#"
            ALTER TABLE schedules ADD COLUMN repository_path TEXT NOT NULL DEFAULT '';
            ALTER TABLE schedules ADD COLUMN task TEXT NOT NULL DEFAULT '';
            ALTER TABLE schedules ADD COLUMN temporal_schedule_id TEXT;
            ALTER TABLE workflow_runs ADD COLUMN temporal_workflow_id TEXT;
            ALTER TABLE workflow_runs ADD COLUMN temporal_run_id TEXT;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_temporal_id
                ON schedules(temporal_schedule_id);
            CREATE INDEX IF NOT EXISTS idx_workflow_runs_temporal_id
                ON workflow_runs(temporal_workflow_id);
        "#,
        kind: MigrationKind::Up,
    }, Migration {
        version: 3,
        description: "create_desktop_settings",
        sql: r#"
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        "#,
        kind: MigrationKind::Up,
    }, Migration {
        version: 4,
        description: "create_model_routing_configuration",
        sql: r#"
            CREATE TABLE IF NOT EXISTS model_providers (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                provider_type TEXT NOT NULL,
                base_url TEXT NOT NULL,
                secret_ref TEXT NOT NULL,
                custom_headers_json TEXT NOT NULL,
                timeout_ms INTEGER NOT NULL,
                enabled INTEGER NOT NULL,
                models_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS model_routes (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                strategy TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                candidates_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_model_providers_enabled
                ON model_providers(enabled, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_model_routes_enabled
                ON model_routes(enabled, updated_at DESC);
        "#,
        kind: MigrationKind::Up,
    }, Migration {
        version: 5,
        description: "add_workflow_lifecycle_status",
        sql: r#"
            ALTER TABLE workflows ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'draft';
            ALTER TABLE workflows ADD COLUMN published_at TEXT;
            CREATE INDEX IF NOT EXISTS idx_workflows_lifecycle
                ON workflows(lifecycle_status, updated_at DESC);
        "#,
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pi-workflow.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            store_model_secret,
            delete_model_secret,
            has_model_secret,
            test_model_provider,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretRequest {
    secret_ref: String,
    secret: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConnectionRequest {
    id: String,
    #[serde(rename = "type")]
    provider_type: String,
    base_url: String,
    secret_ref: String,
    custom_headers: HashMap<String, String>,
    timeout_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderHealthResponse {
    provider_id: String,
    status: &'static str,
    checked_at: String,
    latency_ms: Option<u64>,
    status_code: Option<u16>,
    error_code: Option<&'static str>,
    message: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
fn store_model_secret(request: SecretRequest) -> Result<(), String> {
    let entry = keychain_entry(&request.secret_ref)?;
    entry
        .set_password(&request.secret)
        .map_err(|_| "Unable to store the provider credential in the system keychain.".to_string())
}

#[tauri::command(rename_all = "camelCase")]
fn delete_model_secret(secret_ref: String) -> Result<(), String> {
    let entry = keychain_entry(&secret_ref)?;
    entry
        .delete_credential()
        .or_else(|error| {
            if error.to_string().to_lowercase().contains("no entry") {
                Ok(())
            } else {
                Err(error)
            }
        })
        .map_err(|_| "Unable to remove the provider credential from the system keychain.".to_string())
}

#[tauri::command(rename_all = "camelCase")]
fn has_model_secret(secret_ref: String) -> Result<bool, String> {
    let entry = keychain_entry(&secret_ref)?;
    Ok(entry.get_password().is_ok())
}

#[tauri::command(rename_all = "camelCase")]
async fn test_model_provider(
    provider: ProviderConnectionRequest,
) -> Result<ProviderHealthResponse, String> {
    let started = std::time::Instant::now();
    let checked_at = chrono_like_now();
    let secret = keychain_entry(&provider.secret_ref)
        .and_then(|entry| entry.get_password().map_err(|_| "secret_missing".to_string()))?;
    let endpoint = provider_endpoint(&provider.base_url, &provider.provider_type);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(provider.timeout_ms.clamp(1_000, 120_000)))
        .build()
        .map_err(|_| "Unable to create the provider test client.".to_string())?;
    let mut request = client.get(endpoint);
    for (name, value) in &provider.custom_headers {
        request = request.header(name, value);
    }
    match provider.provider_type.as_str() {
        "anthropic" => {
            request = request.header("x-api-key", secret).header("anthropic-version", "2023-06-01");
        }
        "google-gemini" => {
            request = request.query(&[("key", secret.as_str())]);
        }
        _ => {
            request = request.bearer_auth(secret);
        }
    }

    match request.send().await {
        Ok(response) => {
            let status_code = response.status().as_u16();
            let status = if response.status().is_success() { "healthy" } else { "unavailable" };
            Ok(ProviderHealthResponse {
                provider_id: provider.id,
                status,
                checked_at,
                latency_ms: Some(started.elapsed().as_millis() as u64),
                status_code: Some(status_code),
                error_code: if response.status().is_success() { None } else { Some("provider_http_error") },
                message: if response.status().is_success() { None } else { Some(format!("Provider returned HTTP {status_code}.")) },
            })
        }
        Err(_) => Ok(ProviderHealthResponse {
            provider_id: provider.id,
            status: "unavailable",
            checked_at,
            latency_ms: Some(started.elapsed().as_millis() as u64),
            status_code: None,
            error_code: Some("network_error"),
            message: Some("Provider connection failed or timed out.".to_string()),
        }),
    }
}

fn keychain_entry(secret_ref: &str) -> Result<Entry, String> {
    if secret_ref.is_empty() || secret_ref.len() > 160 || !secret_ref.bytes().all(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-' | b'.')
    }) {
        return Err("The provider secret reference is invalid.".to_string());
    }
    Entry::new(KEYCHAIN_SERVICE, secret_ref)
        .map_err(|_| "Unable to access the system keychain.".to_string())
}

fn provider_endpoint(base_url: &str, provider_type: &str) -> String {
    let base = base_url.trim_end_matches('/');
    match provider_type {
        "anthropic" if base.ends_with("/v1") => format!("{base}/models"),
        "anthropic" => format!("{base}/v1/models"),
        "google-gemini" if base.ends_with("/v1beta") => format!("{base}/models"),
        "google-gemini" => format!("{base}/v1beta/models"),
        _ => format!("{base}/models"),
    }
}

fn chrono_like_now() -> String {
    chrono::Utc::now().to_rfc3339()
}
