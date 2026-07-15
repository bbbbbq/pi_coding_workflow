import {
  WorkflowApplicationError,
  WorkflowApplicationService,
  type AddWorkflowNodeInput,
  type ChangeOptions,
  type ConnectWorkflowEdgeInput,
  type UpdateWorkflowNodeInput,
} from "@pi-workflow/application-service";
import { SqliteWorkflowRepository } from "@pi-workflow/application-service/sqlite";
import type { WorkflowDefinition } from "@pi-workflow/contracts";
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
    readonly modelRouting: ModelRoutingService,
    private readonly closeDatabase?: () => void,
  ) {}

  static open(config: LocalRuntimeConfig = loadLocalRuntimeConfig()): LocalRuntime {
    const repository = new SqliteWorkflowRepository(config.workflowDatabasePath);
    return new LocalRuntime(
      new WorkflowApplicationService(repository),
      ModelRoutingService.load(config.modelRoutingFile),
      () => repository.close(),
    );
  }

  static createForTesting(
    workflows: WorkflowApplicationService,
    modelRouting = new ModelRoutingService({ providers: [], routes: [] }),
  ): LocalRuntime {
    return new LocalRuntime(workflows, modelRouting);
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
    this.closeDatabase?.();
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
  if (error instanceof LocalRuntimeInputError) {
    return { code: "input_invalid", message: error.message };
  }
  return {
    code: "runtime_error",
    message: error instanceof Error ? error.message : String(error),
  };
}

class LocalRuntimeInputError extends Error {}
