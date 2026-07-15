import { homedir } from "node:os";
import { join } from "node:path";

export interface LocalRuntimeConfig {
  workflowDatabasePath: string;
  modelRoutingFile?: string;
}

export function loadLocalRuntimeConfig(): LocalRuntimeConfig {
  return {
    workflowDatabasePath: process.env.PI_WORKFLOW_DATABASE
      ?? join(homedir(), ".pi-workflow", "piwf.db"),
    modelRoutingFile: process.env.PI_WORKFLOW_MODEL_ROUTING_FILE,
  };
}
