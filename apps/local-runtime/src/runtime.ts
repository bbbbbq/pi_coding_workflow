import {
  InMemoryRunStateRepository,
  RunApplicationError,
  RunApplicationService,
  WorkflowApplicationError,
  WorkflowApplicationService,
  type AddWorkflowNodeInput,
  type ChangeOptions,
  type ConnectWorkflowEdgeInput,
  type CreateRunInput,
  type RequestRunApprovalInput,
  type UpdateWorkflowNodeInput,
} from "@pi-workflow/application-service";
import { SqliteRunStateRepository } from "@pi-workflow/application-service/sqlite-run-state";
import { SqliteWorkflowRepository } from "@pi-workflow/application-service/sqlite";
import type { ApprovalDecision, WorkflowDefinition } from "@pi-workflow/contracts";
import { loadLocalRuntimeConfig, type LocalRuntimeConfig } from "./config.js";
import { ModelRoutingService } from "./model-routing-service.js";
import type {
  LocalRuntimeErrorPayload,
  LocalRuntimeRequest,
  LocalRuntimeResponse,
} from "./protocol.js";

export class LocalRuntime implements Disposable {
  private constructor(
    readonly workflows: WorkflowApplicationService,
    readonly runs: RunApplicationService,
    readonly modelRouting: ModelRoutingService,
    private readonly closeDatabases?: () => void,
  ) {}

  static open(config: LocalRuntimeConfig = loadLocalRuntimeConfig()): LocalRuntime {
    const repository = new SqliteWorkflowRepository(config.workflowDatabasePath);
    const runRepository = new SqliteRunStateRepository(config.workflowDatabasePath);
    return new LocalRuntime(
      new WorkflowApplicationService(repository),
      new RunApplicationService(runRepository),
      ModelRoutingService.load(config.modelRoutingFile),
      () => {
        runRepository.close();
        repository.close();
      },
    );
  }

  static createForTesting(
    workflows: WorkflowApplicationService,
    runs = new RunApplicationService(new InMemoryRunStateRepository()),
    modelRouting = new ModelRoutingService({ providers: [], routes: [] }),
  ): LocalRuntime {
    return new LocalRuntime(workflows, runs, modelRouting);
  }

  async request(request: LocalRuntimeRequest): Promise<LocalRuntimeResponse> {
    try {
      return { id: request.id, ok: true, result: await this.execute(request) };
    } catch (error) {
      return { id: request.id, ok: false, error: runtimeError(error) };
    }
  }

  async execute(request: LocalRuntimeRequest): Promise<unknown> {
    const params = request.params ?? {};
    const options = (params.options ?? {}) as ChangeOptions;
    switch (request.method) {
      case "runtime.health":
        return { status: "ok", transport: "stdio" };
      case "workflow.list":
        return this.workflows.listWorkflows();
      case "workflow.get":
        return this.workflows.getWorkflow(requiredString(params.workflowId, "workflowId"));
      case "workflow.create":
        return this.workflows.createWorkflow(requiredDefinition(params.definition), options);
      case "workflow.apply":
        return this.workflows.applyWorkflow(requiredDefinition(params.definition), options);
      case "workflow.validate":
        return this.workflows.validateWorkflow(requiredString(params.workflowId, "workflowId"));
      case "workflow.publish":
        return this.workflows.publishWorkflow(requiredString(params.workflowId, "workflowId"), options);
      case "workflow.delete":
        return this.workflows.deleteWorkflow(requiredString(params.workflowId, "workflowId"), options);
      case "node.add":
        return this.workflows.addNode(
          requiredString(params.workflowId, "workflowId"),
          requiredObject(params.input, "input") as unknown as AddWorkflowNodeInput,
          options,
        );
      case "node.update":
        return this.workflows.updateNode(
          requiredString(params.workflowId, "workflowId"),
          requiredString(params.nodeId, "nodeId"),
          requiredObject(params.input, "input") as UpdateWorkflowNodeInput,
          options,
        );
      case "node.enable":
      case "node.disable":
        return this.workflows.setNodeEnabled(
          requiredString(params.workflowId, "workflowId"),
          requiredString(params.nodeId, "nodeId"),
          request.method === "node.enable",
          options,
        );
      case "node.remove":
        return this.workflows.removeNode(
          requiredString(params.workflowId, "workflowId"),
          requiredString(params.nodeId, "nodeId"),
          options,
        );
      case "edge.connect":
        return this.workflows.connectEdge(
          requiredString(params.workflowId, "workflowId"),
          requiredObject(params.input, "input") as unknown as ConnectWorkflowEdgeInput,
          options,
        );
      case "run.list":
        return this.runs.listRuns(optionalInteger(params.limit, "limit") ?? 100);
      case "run.get":
        return this.runs.getRun(requiredString(params.runId, "runId"));
      case "run.events":
        return this.runs.listEvents(requiredString(params.runId, "runId"));
      case "run.create":
        return this.runs.createRun(
          requiredObject(params.input, "input") as unknown as CreateRunInput,
        );
      case "run.start":
        return this.runs.startRun(requiredString(params.runId, "runId"));
      case "run.pause":
        return this.runs.pauseRun(requiredString(params.runId, "runId"));
      case "run.resume":
        return this.runs.resumeRun(requiredString(params.runId, "runId"));
      case "run.cancel":
        return this.runs.cancelRun(requiredString(params.runId, "runId"), params.payload);
      case "run.interrupt":
        return this.runs.interruptRun(requiredString(params.runId, "runId"), params.payload);
      case "run.complete":
        return this.runs.completeRun(requiredString(params.runId, "runId"), params.payload);
      case "run.fail":
        return this.runs.failRun(requiredString(params.runId, "runId"), params.payload);
      case "approval.list":
        return this.runs.listApprovals(requiredString(params.runId, "runId"));
      case "approval.request":
        return this.runs.requestApproval(
          requiredString(params.runId, "runId"),
          requiredObject(params.input, "input") as unknown as RequestRunApprovalInput,
        );
      case "approval.decide":
        return this.runs.decideApproval(
          requiredString(params.runId, "runId"),
          requiredString(params.approvalId, "approvalId"),
          requiredObject(params.decision, "decision") as unknown as ApprovalDecision,
        );
      case "provider.list":
        return this.modelRouting.listProviders();
      case "provider.test":
        return this.modelRouting.testProvider(requiredString(params.providerId, "providerId"));
      case "route.list":
        return this.modelRouting.listRoutes();
      case "route.resolve":
        return this.modelRouting.resolveRoute(requiredString(params.routeId, "routeId"));
    }
  }

  close(): void {
    this.closeDatabases?.();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LocalRuntimeInputError(`${name} is required.`);
  }
  return value;
}

function requiredObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalRuntimeInputError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new LocalRuntimeInputError(`${name} must be a positive integer.`);
  }
  return value as number;
}

function requiredDefinition(value: unknown): WorkflowDefinition {
  const definition = requiredObject(value, "definition") as unknown as WorkflowDefinition;
  if (!Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
    throw new LocalRuntimeInputError("definition nodes and edges must be arrays.");
  }
  return definition;
}

function runtimeError(error: unknown): LocalRuntimeErrorPayload {
  if (error instanceof WorkflowApplicationError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof RunApplicationError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof LocalRuntimeInputError) {
    return { code: "input_invalid", message: error.message };
  }
  return {
    code: "runtime_error",
    message: error instanceof Error ? error.message : String(error),
  };
}

class LocalRuntimeInputError extends Error {}
