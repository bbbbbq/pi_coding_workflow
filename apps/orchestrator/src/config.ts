export interface OrchestratorConfig {
  temporalAddress: string;
  temporalNamespace: string;
  taskQueue: string;
  apiHost: string;
  apiPort: number;
  allowedOrigins: Set<string>;
}

const defaultOrigins = [
  "tauri://localhost",
  "http://tauri.localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
];

export function loadOrchestratorConfig(): OrchestratorConfig {
  return {
    temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "pi-coding-workflow",
    apiHost: process.env.PI_WORKFLOW_API_HOST ?? "127.0.0.1",
    apiPort: parsePort(process.env.PI_WORKFLOW_API_PORT),
    allowedOrigins: new Set(
      (process.env.PI_WORKFLOW_ALLOWED_ORIGINS?.split(",") ?? defaultOrigins)
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  };
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PI_WORKFLOW_API_PORT: ${value}`);
  }
  return port;
}
