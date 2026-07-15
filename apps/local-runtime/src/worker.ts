import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.js";
import { loadOrchestratorConfig } from "./config.js";

export async function runWorker(): Promise<void> {
  const config = loadOrchestratorConfig();
  const connection = await NativeConnection.connect({ address: config.temporalAddress });

  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: config.taskQueue,
    workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
    activities,
  });

  console.log(`Pi workflow worker is listening on task queue: ${config.taskQueue}`);
  try {
    await worker.run();
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runWorker();
}
