import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ApprovalDecision,
  RegisterTemporalScheduleRequest,
  StartTemporalRunRequest,
  TemporalApprovalRequest,
} from "@pi-workflow/contracts";
import { loadOrchestratorConfig, type OrchestratorConfig } from "./config.js";
import { TemporalService } from "./temporal-service.js";

export async function startApiServer(
  service: TemporalService,
  config: OrchestratorConfig = loadOrchestratorConfig(),
): Promise<ReturnType<typeof createServer>> {
  const server = createServer((request, response) => {
    void handleRequest(request, response, service, config);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.apiPort, config.apiHost, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  console.log(`Pi workflow API is listening on http://${config.apiHost}:${config.apiPort}`);

  const close = () => {
    server.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: TemporalService,
  config: OrchestratorConfig,
): Promise<void> {
  if (!applyCors(request, response, config)) return;
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, await service.health());
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/runs") {
      const body = await readJson<StartTemporalRunRequest>(request);
      requireString(body.runId, "runId");
      requireString(body.workflowId, "workflowId");
      requireString(body.repositoryPath, "repositoryPath");
      requireString(body.task, "task");
      sendJson(response, 201, await service.startRun(body));
      return;
    }

    const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/(pause|resume|cancel|approval)$/);
    if (request.method === "POST" && runMatch) {
      const workflowId = decodeURIComponent(runMatch[1]);
      const operation = runMatch[2];
      if (operation === "pause") await service.pauseRun(workflowId);
      if (operation === "resume") await service.resumeRun(workflowId);
      if (operation === "cancel") await service.cancelRun(workflowId);
      if (operation === "approval") {
        const body = await readJson<TemporalApprovalRequest>(request);
        const decision: ApprovalDecision = body.decision;
        if (typeof decision?.approved !== "boolean") throw badRequest("decision.approved is required");
        await service.approveRun(workflowId, decision);
      }
      sendJson(response, 204, undefined);
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/schedules") {
      const body = await readJson<RegisterTemporalScheduleRequest>(request);
      validateScheduleRequest(body);
      sendJson(response, 201, await service.registerSchedule(body));
      return;
    }

    const scheduleMatch = url.pathname.match(/^\/v1\/schedules\/([^/]+)(?:\/(pause|resume|trigger))?$/);
    if (scheduleMatch) {
      const scheduleId = decodeURIComponent(scheduleMatch[1]);
      const operation = scheduleMatch[2];
      if (request.method === "GET" && !operation) {
        sendJson(response, 200, await service.describeSchedule(scheduleId));
        return;
      }
      if (request.method === "POST" && operation === "pause") {
        sendJson(response, 200, await service.pauseSchedule(scheduleId));
        return;
      }
      if (request.method === "POST" && operation === "resume") {
        sendJson(response, 200, await service.resumeSchedule(scheduleId));
        return;
      }
      if (request.method === "POST" && operation === "trigger") {
        sendJson(response, 200, await service.triggerSchedule(scheduleId));
        return;
      }
      if (request.method === "DELETE" && !operation) {
        await service.deleteSchedule(scheduleId);
        sendJson(response, 204, undefined);
        return;
      }
    }

    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${request.method} ${url.pathname}: ${message}`);
    sendJson(response, status, { error: status === 500 ? "temporal_error" : "invalid_request", message });
  }
}

function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  config: OrchestratorConfig,
): boolean {
  const origin = request.headers.origin;
  if (origin && !config.allowedOrigins.has(origin)) {
    sendJson(response, 403, { error: "origin_not_allowed" });
    return false;
  }
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Vary", "Origin");
  return true;
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (Buffer.concat(chunks).length > 1_000_000) throw badRequest("Request body is too large");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
}

function validateScheduleRequest(body: RegisterTemporalScheduleRequest): void {
  if (!body?.schedule || typeof body.schedule !== "object") throw badRequest("schedule is required");
  requireString(body.schedule.id, "schedule.id");
  requireString(body.schedule.repositoryPath, "schedule.repositoryPath");
  requireString(body.schedule.task, "schedule.task");
  requireString(body.schedule.scheduledAt, "schedule.scheduledAt");
  requireString(body.schedule.timeZone, "schedule.timeZone");
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw badRequest(`${name} is required`);
}

function badRequest(message: string): ApiError {
  return new ApiError(400, message);
}

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  if (status === 204) {
    response.end();
    return;
  }
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const config = loadOrchestratorConfig();
  const service = await TemporalService.connect(config);
  const server = await startApiServer(service, config);
  server.once("close", () => {
    void service.close();
  });
}
