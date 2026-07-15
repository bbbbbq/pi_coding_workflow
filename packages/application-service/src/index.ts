import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowValidationResult,
} from "@pi-workflow/contracts";
import { workflowNodeTypes } from "@pi-workflow/contracts";
import {
  createWorkflowNode,
  validateWorkflowDefinition,
  workflowNodePorts,
} from "@pi-workflow/workflow-core";

export type WorkflowLifecycleStatus = "draft" | "published";

export interface WorkflowRecord {
  definition: WorkflowDefinition;
  status: WorkflowLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  version: number;
  status: WorkflowLifecycleStatus;
  updatedAt: string;
  publishedAt?: string;
}

export interface WorkflowSaveOptions {
  /** null means the workflow must not exist; a number is an optimistic lock. */
  expectedVersion?: number | null;
}

export interface WorkflowRepository {
  list(): Promise<WorkflowRecord[]>;
  get(workflowId: string): Promise<WorkflowRecord | undefined>;
  save(record: WorkflowRecord, options?: WorkflowSaveOptions): Promise<void>;
  delete(workflowId: string, options?: WorkflowSaveOptions): Promise<void>;
}

export class RepositoryVersionConflictError extends Error {
  constructor(
    readonly expectedVersion: number | null,
    readonly actualVersion: number | undefined,
  ) {
    super(`Workflow version conflict: expected ${expectedVersion ?? "new"}, found ${actualVersion ?? "missing"}.`);
    this.name = "RepositoryVersionConflictError";
  }
}

export type WorkflowApplicationErrorCode =
  | "workflow_not_found"
  | "workflow_exists"
  | "version_conflict"
  | "validation_failed"
  | "node_not_found"
  | "edge_invalid"
  | "input_invalid";

export class WorkflowApplicationError extends Error {
  constructor(
    readonly code: WorkflowApplicationErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "WorkflowApplicationError";
  }
}

export interface WorkflowChangeResult {
  workflow: WorkflowRecord;
  validation: WorkflowValidationResult;
  changed: boolean;
  dryRun: boolean;
}

export interface ChangeOptions {
  dryRun?: boolean;
  ifVersion?: number;
}

export interface AddWorkflowNodeInput {
  id?: string;
  type: WorkflowNodeType;
  name?: string;
  enabled?: boolean;
  position?: { x: number; y: number };
  config?: Record<string, unknown>;
}

export interface UpdateWorkflowNodeInput {
  name?: string;
  enabled?: boolean;
  position?: { x: number; y: number };
  config?: Record<string, unknown>;
}

export interface ConnectWorkflowEdgeInput {
  id?: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort?: string;
  targetPort?: string;
}

export interface WorkflowApplicationServiceOptions {
  now?: () => string;
  idFactory?: () => string;
}

export class WorkflowApplicationService {
  private readonly now: () => string;
  private readonly idFactory: () => string;

  constructor(
    private readonly repository: WorkflowRepository,
    options: WorkflowApplicationServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  async listWorkflows(): Promise<WorkflowSummary[]> {
    const records = await this.repository.list();
    return records.map(toSummary);
  }

  async getWorkflow(workflowId: string): Promise<WorkflowRecord> {
    const record = await this.repository.get(workflowId);
    if (!record) {
      throw new WorkflowApplicationError("workflow_not_found", `Workflow '${workflowId}' was not found.`);
    }
    return cloneRecord(record);
  }

  async createWorkflow(
    definition: WorkflowDefinition,
    options: Pick<ChangeOptions, "dryRun"> = {},
  ): Promise<WorkflowChangeResult> {
    assertDefinitionIdentity(definition);
    if (await this.repository.get(definition.id)) {
      throw new WorkflowApplicationError("workflow_exists", `Workflow '${definition.id}' already exists.`);
    }
    const now = this.now();
    const normalized = normalizeDefinition(definition, 1, now);
    const record: WorkflowRecord = {
      definition: normalized,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };
    if (!options.dryRun) {
      await this.persist(record, { expectedVersion: null });
    }
    return changeResult(record, true, options.dryRun);
  }

  async applyWorkflow(
    definition: WorkflowDefinition,
    options: ChangeOptions = {},
  ): Promise<WorkflowChangeResult> {
    assertDefinitionIdentity(definition);
    const current = await this.repository.get(definition.id);
    if (!current) {
      if (options.ifVersion !== undefined && options.ifVersion !== 0) {
        throw versionConflict(options.ifVersion, undefined);
      }
      return this.createWorkflow(definition, options);
    }
    assertVersion(current, options.ifVersion);
    if (definitionContent(current.definition) === definitionContent(definition)) {
      return changeResult(current, false, options.dryRun);
    }

    const now = this.now();
    const next: WorkflowRecord = {
      ...current,
      definition: normalizeDefinition(definition, current.definition.version + 1, now),
      status: "draft",
      updatedAt: now,
      publishedAt: undefined,
    };
    if (!options.dryRun) {
      await this.persist(next, { expectedVersion: current.definition.version });
    }
    return changeResult(next, true, options.dryRun);
  }

  async validateWorkflow(workflow: string | WorkflowDefinition): Promise<WorkflowValidationResult> {
    const definition = typeof workflow === "string"
      ? (await this.getWorkflow(workflow)).definition
      : normalizeDefinition(workflow, workflow.version, workflow.updatedAt);
    return validateWorkflowDefinition(definition);
  }

  async publishWorkflow(workflowId: string, options: ChangeOptions = {}): Promise<WorkflowChangeResult> {
    const current = await this.getWorkflow(workflowId);
    assertVersion(current, options.ifVersion);
    const validation = validateWorkflowDefinition(current.definition);
    if (!validation.valid) {
      throw new WorkflowApplicationError(
        "validation_failed",
        `Workflow '${workflowId}' cannot be published because validation failed.`,
        validation,
      );
    }
    if (current.status === "published") {
      return { workflow: current, validation, changed: false, dryRun: options.dryRun === true };
    }
    const now = this.now();
    const next: WorkflowRecord = {
      ...current,
      status: "published",
      updatedAt: now,
      publishedAt: now,
    };
    if (!options.dryRun) {
      await this.persist(next, { expectedVersion: current.definition.version });
    }
    return { workflow: cloneRecord(next), validation, changed: true, dryRun: options.dryRun === true };
  }

  async deleteWorkflow(workflowId: string, options: ChangeOptions = {}): Promise<{ id: string; deleted: boolean; dryRun: boolean }> {
    const current = await this.getWorkflow(workflowId);
    assertVersion(current, options.ifVersion);
    if (!options.dryRun) {
      await this.deletePersisted(workflowId, { expectedVersion: current.definition.version });
    }
    return { id: workflowId, deleted: true, dryRun: options.dryRun === true };
  }

  async addNode(
    workflowId: string,
    input: AddWorkflowNodeInput,
    options: ChangeOptions = {},
  ): Promise<WorkflowChangeResult> {
    if (!workflowNodeTypes.includes(input.type)) {
      throw new WorkflowApplicationError("input_invalid", `Unsupported node type '${input.type}'.`);
    }
    return this.mutate(workflowId, options, (definition) => {
      const node = createWorkflowNode({
        id: input.id ?? `${input.type}-${this.idFactory().slice(0, 8)}`,
        type: input.type,
        name: input.name ?? "",
        position: input.position ?? nextNodePosition(definition),
      });
      if (definition.nodes.some((candidate) => candidate.id === node.id)) {
        throw new WorkflowApplicationError("input_invalid", `Node '${node.id}' already exists.`);
      }
      node.enabled = input.enabled ?? true;
      if (input.config) {
        node.config = { ...node.config, ...input.config } as typeof node.config;
      }
      definition.nodes.push(node);
    });
  }

  async updateNode(
    workflowId: string,
    nodeId: string,
    input: UpdateWorkflowNodeInput,
    options: ChangeOptions = {},
  ): Promise<WorkflowChangeResult> {
    return this.mutate(workflowId, options, (definition) => {
      const node = findNode(definition, nodeId);
      if (input.name !== undefined) node.name = input.name;
      if (input.enabled !== undefined) node.enabled = input.enabled;
      if (input.position !== undefined) node.position = input.position;
      if (input.config !== undefined) {
        node.config = { ...node.config, ...input.config } as typeof node.config;
      }
    });
  }

  setNodeEnabled(
    workflowId: string,
    nodeId: string,
    enabled: boolean,
    options: ChangeOptions = {},
  ): Promise<WorkflowChangeResult> {
    return this.updateNode(workflowId, nodeId, { enabled }, options);
  }

  async removeNode(
    workflowId: string,
    nodeId: string,
    options: ChangeOptions = {},
  ): Promise<WorkflowChangeResult> {
    return this.mutate(workflowId, options, (definition) => {
      findNode(definition, nodeId);
      definition.nodes = definition.nodes.filter((node) => node.id !== nodeId);
      definition.edges = definition.edges.filter(
        (edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId,
      );
    });
  }

  async connectEdge(
    workflowId: string,
    input: ConnectWorkflowEdgeInput,
    options: ChangeOptions = {},
  ): Promise<WorkflowChangeResult> {
    return this.mutate(workflowId, options, (definition) => {
      const source = findNode(definition, input.sourceNodeId);
      const target = findNode(definition, input.targetNodeId);
      const sourcePort = input.sourcePort ?? workflowNodePorts[source.type].outputs[0];
      const targetPort = input.targetPort ?? workflowNodePorts[target.type].inputs[0];
      if (!sourcePort || !workflowNodePorts[source.type].outputs.includes(sourcePort)) {
        throw new WorkflowApplicationError("edge_invalid", `Invalid source port for node '${source.id}'.`);
      }
      if (!targetPort || !workflowNodePorts[target.type].inputs.includes(targetPort)) {
        throw new WorkflowApplicationError("edge_invalid", `Invalid target port for node '${target.id}'.`);
      }
      const id = input.id ?? `edge-${this.idFactory().slice(0, 8)}`;
      if (definition.edges.some((edge) => edge.id === id)) {
        throw new WorkflowApplicationError("edge_invalid", `Edge '${id}' already exists.`);
      }
      definition.edges.push({
        id,
        sourceNodeId: source.id,
        sourcePort,
        targetNodeId: target.id,
        targetPort,
      });
    });
  }

  private async mutate(
    workflowId: string,
    options: ChangeOptions,
    update: (definition: WorkflowDefinition) => void,
  ): Promise<WorkflowChangeResult> {
    const current = await this.getWorkflow(workflowId);
    assertVersion(current, options.ifVersion);
    const definition = structuredClone(current.definition);
    update(definition);
    return this.applyWorkflow(definition, {
      ...options,
      ifVersion: current.definition.version,
    });
  }

  private async persist(record: WorkflowRecord, options: WorkflowSaveOptions): Promise<void> {
    try {
      await this.repository.save(record, options);
    } catch (error) {
      if (error instanceof RepositoryVersionConflictError) {
        throw versionConflict(error.expectedVersion, error.actualVersion);
      }
      throw error;
    }
  }

  private async deletePersisted(workflowId: string, options: WorkflowSaveOptions): Promise<void> {
    try {
      await this.repository.delete(workflowId, options);
    } catch (error) {
      if (error instanceof RepositoryVersionConflictError) {
        throw versionConflict(error.expectedVersion, error.actualVersion);
      }
      throw error;
    }
  }
}

export class InMemoryWorkflowRepository implements WorkflowRepository {
  private readonly records = new Map<string, WorkflowRecord>();

  constructor(records: WorkflowRecord[] = []) {
    for (const record of records) this.records.set(record.definition.id, cloneRecord(record));
  }

  async list(): Promise<WorkflowRecord[]> {
    return [...this.records.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(cloneRecord);
  }

  async get(workflowId: string): Promise<WorkflowRecord | undefined> {
    const record = this.records.get(workflowId);
    return record ? cloneRecord(record) : undefined;
  }

  async save(record: WorkflowRecord, options: WorkflowSaveOptions = {}): Promise<void> {
    const existing = this.records.get(record.definition.id);
    assertRepositoryVersion(options.expectedVersion, existing?.definition.version);
    this.records.set(record.definition.id, cloneRecord(record));
  }

  async delete(workflowId: string, options: WorkflowSaveOptions = {}): Promise<void> {
    const existing = this.records.get(workflowId);
    assertRepositoryVersion(options.expectedVersion, existing?.definition.version);
    this.records.delete(workflowId);
  }
}

function assertDefinitionIdentity(definition: WorkflowDefinition): void {
  if (!definition.id?.trim()) {
    throw new WorkflowApplicationError("input_invalid", "Workflow ID is required.");
  }
  if (!definition.name?.trim()) {
    throw new WorkflowApplicationError("input_invalid", "Workflow name is required.");
  }
}

function assertVersion(record: WorkflowRecord, expected: number | undefined): void {
  if (expected !== undefined && record.definition.version !== expected) {
    throw versionConflict(expected, record.definition.version);
  }
}

function assertRepositoryVersion(expected: number | null | undefined, actual: number | undefined): void {
  if (expected === undefined) return;
  if (expected === null ? actual !== undefined : actual !== expected) {
    throw new RepositoryVersionConflictError(expected, actual);
  }
}

function versionConflict(expected: number | null, actual: number | undefined): WorkflowApplicationError {
  return new WorkflowApplicationError(
    "version_conflict",
    `Workflow version conflict: expected ${expected ?? "new"}, found ${actual ?? "missing"}.`,
    { expectedVersion: expected, actualVersion: actual },
  );
}

function findNode(definition: WorkflowDefinition, nodeId: string): WorkflowNode {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new WorkflowApplicationError("node_not_found", `Node '${nodeId}' was not found.`);
  }
  return node;
}

function normalizeDefinition(
  definition: WorkflowDefinition,
  version: number,
  updatedAt: string,
): WorkflowDefinition {
  const normalized = structuredClone(definition);
  normalized.version = version;
  normalized.updatedAt = updatedAt;
  normalized.nodes = normalized.nodes.map((node) => ({
    ...node,
    enabled: node.enabled !== false,
  } as WorkflowNode));
  return normalized;
}

function definitionContent(definition: WorkflowDefinition): string {
  return JSON.stringify({
    id: definition.id,
    name: definition.name,
    nodes: definition.nodes.map((node) => ({ ...node, enabled: node.enabled !== false })),
    edges: definition.edges,
  });
}

function nextNodePosition(definition: WorkflowDefinition): { x: number; y: number } {
  const index = definition.nodes.length;
  return {
    x: 100 + (index % 4) * 240,
    y: 120 + Math.floor(index / 4) * 180,
  };
}

function changeResult(record: WorkflowRecord, changed: boolean, dryRun = false): WorkflowChangeResult {
  const workflow = cloneRecord(record);
  return {
    workflow,
    validation: validateWorkflowDefinition(workflow.definition),
    changed,
    dryRun,
  };
}

function toSummary(record: WorkflowRecord): WorkflowSummary {
  return {
    id: record.definition.id,
    name: record.definition.name,
    version: record.definition.version,
    status: record.status,
    updatedAt: record.updatedAt,
    publishedAt: record.publishedAt,
  };
}

function cloneRecord(record: WorkflowRecord): WorkflowRecord {
  return structuredClone(record);
}
