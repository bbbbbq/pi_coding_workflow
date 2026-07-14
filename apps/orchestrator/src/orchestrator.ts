import { loadOrchestratorConfig } from "./config.js";
import { startApiServer } from "./server.js";
import { TemporalService } from "./temporal-service.js";
import { runWorker } from "./worker.js";

const config = loadOrchestratorConfig();
const service = await TemporalService.connect(config);
await startApiServer(service, config);

try {
  await runWorker();
} finally {
  await service.close();
}
