import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.js";

const connection = await NativeConnection.connect({
  address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
});

const worker = await Worker.create({
  connection,
  namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "pi-coding-workflow",
  workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
  activities,
});

console.log("Pi workflow worker is listening on task queue: pi-coding-workflow");
await worker.run();
