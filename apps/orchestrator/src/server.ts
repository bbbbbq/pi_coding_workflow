import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ApprovalDecision,
  RegisterTemporalScheduleRequest,
  StartTemporalRunRequest,
  TemporalApprovalRequest,
  WorkflowDefinition,
} from "@pi-workflow/contracts";
import {
  WorkflowApplicationError,
  WorkflowApplicationService,
  type AddWorkflowNodeInput,
  type ChangeOptions,
  type ConnectWorkflowEdgeInput,
  type UpdateWorkflowNodeInput,
} from "@pi-workflow/application-service";
import { SqliteWorkflowRepository } from "@pi-workflow/application-service/sqlite";
import { loadOrchestratorConfig, type OrchestratorConfig } from "./config.js";
import { ModelRoutingService } from "./model-routing-service.js";
import { TemporalService } from "./temporal-service.js";

export async function startApiServer(
  service: TemporalService,
  config: OrchestratorConfig = loadOrchestratorConfig(),
  modelRouting: ModelRoutingService = ModelRoutingService.load(config.modelRoutingFile),
  workflowApplication?: WorkflowApplicationService,
): Promise<ReturnType<typeof createServer>> {
  const ownedWorkflowRepository = workflowApplication
    ? undefined
    : new SqliteWorkflowRepository(config.workflowDatabasePath);
  const workflows = workflowApplication
    ?? new WorkflowApplicationService(ownedWorkflowRepository!);
  const server = createServer((request, response) => {
    void handleRequest(request, response, service, modelRouting, workflows, config);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.apiPort, config.apiHost, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const listeningPort = address && typeof address === "object" ? address.port : config.apiPort;
  console.log(`Pi workflow API is listening on http://${config.apiHost}:${listeningPort}`);

  const close = () => {
    server.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  server.once("close", () => {
    ownedWorkflowRepository?.close();
    process.removeListener("SIGINT", close);
    process.removeListener("SIGTERM", close);
  });
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: TemporalService,
  modelRouting: ModelRoutingService,
  workflows: WorkflowApplicationService,
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

    if (await handleWorkflowRequest(request, response, url, workflows)) return;

    if (request.method === "POST" && url.pathname === "/v1/runs") {
      const body = await readJson<StartTemporalRunRequest>(request);
      requireString(body.runId, "runId");
      requireString(body.workflowId, "workflowId");
      requireString(body.repositoryPath, "repositoryPath");
      requireString(body.task, "task");
      sendJson(response, 201, await service.startRun(body));
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/runs") {
      sendJson(response, 200, await service.listRuns());
      return;
    }

    const runDescriptionMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)$/);
    if (request.method === "GET" && runDescriptionMatch) {
      sendJson(response, 200, await service.describeRun(decodeURIComponent(runDescriptionMatch[1])));
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

    if (request.method === "GET" && url.pathname === "/v1/providers") {
      sendJson(response, 200, modelRouting.listProviders());
      return;
    }

    const providerTestMatch = url.pathname.match(/^\/v1\/providers\/([^/]+)\/test$/);
    if (request.method === "POST" && providerTestMatch) {
      const providerId = decodeURIComponent(providerTestMatch[1]);
      if (!modelRouting.listProviders().some((provider) => provider.id === providerId)) {
        throw new ApiError(404, `Provider '${providerId}' was not found.`);
      }
      sendJson(response, 200, await modelRouting.testProvider(providerId));
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/routes") {
      sendJson(response, 200, modelRouting.listRoutes());
      return;
    }

    const routeResolveMatch = url.pathname.match(/^\/v1\/routes\/([^/]+)\/resolve$/);
    if (request.method === "POST" && routeResolveMatch) {
      const routeId = decodeURIComponent(routeResolveMatch[1]);
      if (!modelRouting.listRoutes().some((route) => route.id === routeId)) {
        throw new ApiError(404, `Route '${routeId}' was not found.`);
      }
      sendJson(response, 200, modelRouting.resolveRoute(routeId));
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
    const status = error instanceof ApiError
      ? error.status
      : error instanceof WorkflowApplicationError
        ? workflowErrorStatus(error)
        : 500;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${request.method} ${url.pathname}: ${message}`);
    sendJson(response, status, {
      error: error instanceof WorkflowApplicationError
        ? error.code
        : status === 500
          ? "temporal_error"
          : "invalid_request",
      message,
      details: error instanceof WorkflowApplicationError ? error.details : undefined,
    });
  }
}

async function handleWorkflowRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  workflows: WorkflowApplicationService,
): Promise<boolean> {
  if (url.pathname === "/v1/workflows") {
    if (request.method === "GET") {
      sendJson(response, 200, await workflows.listWorkflows());
      return true;
    }
    if (request.method === "POST") {
      const body = await readJson<{
        definition: WorkflowDefinition;
        options?: Pick<ChangeOptions, "dryRun">;
      }>(request);
      requireObject(body, "request body");
      requireWorkflowDefinition(body.definition);
      sendJson(response, 201, await workflows.createWorkflow(body.definition, body.options));
      return true;
    }
  }

  const nodeToggleMatch = url.pathname.match(
    /^\/v1\/workflows\/([^/]+)\/nodes\/([^/]+)\/(enable|disable)$/,
  );
  if (request.method === "POST" && nodeToggleMatch) {
    const body = await readJson<{ options?: ChangeOptions }>(request);
    requireObject(body, "request body");
    sendJson(response, 200, await workflows.setNodeEnabled(
      decodeURIComponent(nodeToggleMatch[1]),
      decodeURIComponent(nodeToggleMatch[2]),
      nodeToggleMatch[3] === "enable",
      body.options,
    ));
    return true;
  }

  const nodeMatch = url.pathname.match(/^\/v1\/workflows\/([^/]+)\/nodes\/([^/]+)$/);
  if (nodeMatch) {
    const workflowId = decodeURIComponent(nodeMatch[1]);
    const nodeId = decodeURIComponent(nodeMatch[2]);
    if (request.method === "PATCH") {
      const body = await readJson<{ input: UpdateWorkflowNodeInput; options?: ChangeOptions }>(request);
      requireObject(body, "request body");
      requireObject(body.input, "input");
      sendJson(response, 200, await workflows.updateNode(workflowId, nodeId, body.input, body.options));
      return true;
    }
    if (request.method === "DELETE") {
      const body = await readJson<{ options?: ChangeOptions }>(request);
      requireObject(body, "request body");
      sendJson(response, 200, await workflows.removeNode(workflowId, nodeId, body.options));
      return true;
    }
  }

  const nodesMatch = url.pathname.match(/^\/v1\/workflows\/([^/]+)\/nodes$/);
  if (request.method === "POST" && nodesMatch) {
    const body = await readJson<{ input: AddWorkflowNodeInput; options?: ChangeOptions }>(request);
    requireObject(body, "request body");
    requireObject(body.input, "input");
    sendJson(response, 200, await workflows.addNode(
      decodeURIComponent(nodesMatch[1]),
      body.input,
      body.options,
    ));
    return true;
  }

  const edgesMatch = url.pathname.match(/^\/v1\/workflows\/([^/]+)\/edges$/);
  if (request.method === "POST" && edgesMatch) {
    const body = await readJson<{ input: ConnectWorkflowEdgeInput; options?: ChangeOptions }>(request);
    requireObject(body, "request body");
    requireObject(body.input, "input");
    sendJson(response, 200, await workflows.connectEdge(
      decodeURIComponent(edgesMatch[1]),
      body.input,
      body.options,
    ));
    return true;
  }

  const actionMatch = url.pathname.match(/^\/v1\/workflows\/([^/]+)\/(validate|publish)$/);
  if (request.method === "POST" && actionMatch) {
    const workflowId = decodeURIComponent(actionMatch[1]);
    if (actionMatch[2] === "validate") {
      sendJson(response, 200, await workflows.validateWorkflow(workflowId));
    } else {
      const body = await readJson<{ options?: ChangeOptions }>(request);
      requireObject(body, "request body");
      sendJson(response, 200, await workflows.publishWorkflow(workflowId, body.options));
    }
    return true;
  }

  const workflowMatch = url.pathname.match(/^\/v1\/workflows\/([^/]+)$/);
  if (workflowMatch) {
    const workflowId = decodeURIComponent(workflowMatch[1]);
    if (request.method === "GET") {
      sendJson(response, 200, await workflows.getWorkflow(workflowId));
      return true;
    }
    if (request.method === "PUT") {
      const body = await readJson<{ definition: WorkflowDefinition; options?: ChangeOptions }>(request);
      requireObject(body, "request body");
      requireWorkflowDefinition(body.definition);
      if (body.definition.id !== workflowId) throw badRequest("Workflow ID does not match the request path");
      sendJson(response, 200, await workflows.applyWorkflow(body.definition, body.options));
      return true;
    }
    if (request.method === "DELETE") {
      const body = await readJson<{ options?: ChangeOptions }>(request);
      requireObject(body, "request body");
      sendJson(response, 200, await workflows.deleteWorkflow(workflowId, body.options));
      return true;
    }
  }

  return false;
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
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
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

function requireObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(`${name} must be an object`);
  }
}

function requireWorkflowDefinition(value: unknown): asserts value is WorkflowDefinition {
  requireObject(value, "definition");
  requireString(value.id, "definition.id");
  requireString(value.name, "definition.name");
  if (!Array.isArray(value.nodes)) throw badRequest("definition.nodes must be an array");
  if (!Array.isArray(value.edges)) throw badRequest("definition.edges must be an array");
}

function badRequest(message: string): ApiError {
  return new ApiError(400, message);
}

function workflowErrorStatus(error: WorkflowApplicationError): number {
  if (error.code === "workflow_not_found" || error.code === "node_not_found") return 404;
  if (error.code === "workflow_exists" || error.code === "version_conflict") return 409;
  if (error.code === "validation_failed") return 422;
  return 400;
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
