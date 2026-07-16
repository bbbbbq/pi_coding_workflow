import { spawn } from "node:child_process";
import {
  type CreateRunInput,
  type RunApplicationService,
  type RunStateCommitResult,
  type WorkflowApplicationService,
} from "@pi-workflow/application-service";
import type {
  ModelRoutingConfig,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowRunEvent,
  WorkflowRunRecord,
} from "@pi-workflow/contracts";
import {
  PiCodingAbortError,
  PiCodingExecutor,
  type PiCodingRunInput,
  type PiCodingRunResult,
} from "@pi-workflow/pi-adapter";
import {
  getDelayDurationMilliseconds,
  validateWorkflowDefinition,
  workflowNodePorts,
} from "@pi-workflow/workflow-core";
import jexl from "jexl";

const expressionEngine = new jexl.Jexl();
expressionEngine.addBinaryOp("===", 20, (left, right) => left === right);
expressionEngine.addBinaryOp("!==", 20, (left, right) => left !== right);

const terminalStatuses = new Set<WorkflowRunRecord["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

export interface WorkflowPiExecutor {
  run(input: PiCodingRunInput): Promise<PiCodingRunResult>;
}

export interface ActionExecutionInput {
  cwd: string;
  command: string;
  timeoutSeconds: number;
  signal: AbortSignal;
}

export interface ActionExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  passed: boolean;
}

export interface WorkflowActionExecutor {
  run(input: ActionExecutionInput): Promise<ActionExecutionResult>;
}

export interface WorkflowExecutionCoordinatorOptions {
  piExecutor?: WorkflowPiExecutor;
  actionExecutor?: WorkflowActionExecutor;
  modelRouting?: () => ModelRoutingConfig | undefined;
  idFactory?: () => string;
  maxNodeExecutions?: number;
}

export interface StartExecutionOptions {
  background?: boolean;
}

interface ActiveExecution {
  controller: AbortController;
  promise: Promise<WorkflowRunRecord>;
}

interface ExecutionToken {
  nodeId: string;
  input?: unknown;
}

interface ExecutionState {
  pending: ExecutionToken[];
  outputs: Record<string, unknown>;
  iterations: Record<string, number>;
  executionCount: number;
  endResults: Array<{ nodeId: string; result: string }>;
  validation?: { passed: boolean; checks: unknown[] };
}

type NodeExecutionResult =
  | { kind: "continue"; outcome: string; output?: unknown }
  | { kind: "terminal"; result: "success" | "failed" | "cancelled" | "escalated"; output?: unknown }
  | { kind: "suspended" };

export class WorkflowExecutionError extends Error {
  constructor(
    readonly code: "workflow_invalid" | "node_execution_failed" | "execution_limit",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "WorkflowExecutionError";
  }
}

export class WorkflowExecutionCoordinator {
  private readonly piExecutor: WorkflowPiExecutor;
  private readonly actionExecutor: WorkflowActionExecutor;
  private readonly modelRouting: () => ModelRoutingConfig | undefined;
  private readonly idFactory: () => string;
  private readonly maxNodeExecutions: number;
  private readonly active = new Map<string, ActiveExecution>();

  constructor(
    private readonly workflows: WorkflowApplicationService,
    private readonly runs: RunApplicationService,
    options: WorkflowExecutionCoordinatorOptions = {},
  ) {
    this.piExecutor = options.piExecutor ?? new PiCodingExecutor();
    this.actionExecutor = options.actionExecutor ?? new LocalActionExecutor();
    this.modelRouting = options.modelRouting ?? (() => undefined);
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.maxNodeExecutions = options.maxNodeExecutions ?? 1_000;
  }

  async createRun(input: CreateRunInput): Promise<RunStateCommitResult> {
    await this.loadExecutableDefinition(input.workflowId, input.workflowVersion);
    return this.runs.createRun(input);
  }

  async startRun(runId: string, options: StartExecutionOptions = {}): Promise<RunStateCommitResult> {
    const run = await this.runs.getRun(runId);
    const definition = await this.loadExecutableDefinition(run.workflowId, run.workflowVersion);
    const started = await this.runs.startRun(runId);
    const execution = this.launch(started.run, definition, []);
    if (options.background === false) await execution;
    return started;
  }

  async waitForRun(runId: string): Promise<WorkflowRunRecord> {
    return this.active.get(runId)?.promise ?? this.runs.getRun(runId);
  }

  async pauseRun(runId: string): Promise<RunStateCommitResult> {
    const active = this.active.get(runId);
    const result = await this.runs.pauseRun(runId);
    active?.controller.abort();
    await active?.promise;
    return result;
  }

  async resumeRun(runId: string, options: StartExecutionOptions = {}): Promise<RunStateCommitResult> {
    const current = await this.runs.getRun(runId);
    if (current.status === "running" && !this.active.has(runId)) {
      await this.runs.interruptRun(runId, { reason: "execution_owner_restarted" });
    }
    await this.runs.resumeRun(runId);
    return this.startRun(runId, options);
  }

  async cancelRun(runId: string, payload: unknown = { reason: "cancelled_by_user" }): Promise<RunStateCommitResult> {
    const active = this.active.get(runId);
    const result = await this.runs.cancelRun(runId, payload);
    active?.controller.abort();
    await active?.promise;
    return result;
  }

  async interruptRun(runId: string, payload?: unknown): Promise<RunStateCommitResult> {
    const active = this.active.get(runId);
    const result = await this.runs.interruptRun(runId, payload);
    active?.controller.abort();
    await active?.promise;
    return result;
  }

  async decideApproval(
    runId: string,
    approvalId: string,
    decision: { approved: boolean; note?: string },
    options: StartExecutionOptions = {},
  ): Promise<RunStateCommitResult> {
    const result = await this.runs.decideApproval(runId, approvalId, decision);
    if (result.run.status === "queued") {
      await this.startRun(runId, options);
    }
    return result;
  }

  abortAll(): void {
    for (const execution of this.active.values()) execution.controller.abort();
  }

  private launch(
    run: WorkflowRunRecord,
    definition: WorkflowDefinition,
    ancestors: string[],
  ): Promise<WorkflowRunRecord> {
    const current = this.active.get(run.id);
    if (current) return current.promise;
    const controller = new AbortController();
    const promise = this.executeRun(run, definition, controller.signal, ancestors)
      .finally(() => {
        if (this.active.get(run.id)?.controller === controller) this.active.delete(run.id);
      });
    this.active.set(run.id, { controller, promise });
    return promise;
  }

  private async executeRun(
    run: WorkflowRunRecord,
    definition: WorkflowDefinition,
    signal: AbortSignal,
    ancestors: string[],
  ): Promise<WorkflowRunRecord> {
    try {
      const events = await this.runs.listEvents(run.id);
      const state = restoreExecutionState(events, definition);
      while (state.pending.length > 0) {
        signal.throwIfAborted();
        const persistedRun = await this.runs.getRun(run.id);
        if (persistedRun.status !== "running") return persistedRun;
        if (state.executionCount >= this.maxNodeExecutions) {
          throw new WorkflowExecutionError(
            "execution_limit",
            `Run exceeded the ${this.maxNodeExecutions} node execution limit.`,
          );
        }

        const token = state.pending[0];
        const node = definition.nodes.find((candidate) => candidate.id === token.nodeId);
        if (!node) {
          throw new WorkflowExecutionError("node_execution_failed", `Node '${token.nodeId}' was not found.`);
        }
        state.executionCount += 1;
        await this.runs.recordNodeEvent(run.id, "node_started", node.id, {
          nodeType: node.type,
          state: executionSnapshot(state),
        });

        if (node.enabled === false) {
          try {
            const outcome = defaultOutcome(node);
            this.advance(definition, state, token, node, outcome, { skipped: true });
            await this.runs.recordNodeEvent(run.id, "node_skipped", node.id, {
              outcome,
              state: executionSnapshot(state),
            });
          } catch (error) {
            state.pending.shift();
            await this.runs.recordNodeEvent(run.id, "node_failed", node.id, {
              output: errorPayload(error),
              state: executionSnapshot(state),
            });
            throw error;
          }
          continue;
        }

        let result: NodeExecutionResult;
        try {
          result = await this.executeNode(run, definition, state, token, node, signal, ancestors);
        } catch (error) {
          if (isAbortError(error) || signal.aborted) throw error;
          const failureOutcome = failurePort(node);
          const output = errorPayload(error);
          if (failureOutcome && this.hasOutcomeEdge(definition, node.id, failureOutcome)) {
            this.advance(definition, state, token, node, failureOutcome, output);
            await this.runs.recordNodeEvent(run.id, "node_failed", node.id, {
              outcome: failureOutcome,
              output,
              state: executionSnapshot(state),
            });
            continue;
          }
          state.pending.shift();
          await this.runs.recordNodeEvent(run.id, "node_failed", node.id, {
            output,
            state: executionSnapshot(state),
          });
          throw new WorkflowExecutionError(
            "node_execution_failed",
            `Node '${node.id}' failed: ${errorMessage(error)}`,
            { nodeId: node.id, nodeType: node.type, cause: output },
          );
        }

        if (result.kind === "suspended") return this.runs.getRun(run.id);

        if (result.kind === "terminal") {
          state.pending.shift();
          state.outputs[node.id] = serializableOutput(result.output);
          state.endResults.push({ nodeId: node.id, result: result.result });
          await this.runs.recordNodeEvent(run.id, "node_completed", node.id, {
            outcome: result.result,
            output: result.output,
            state: executionSnapshot(state),
          });
          if (result.result !== "success") return this.finishTerminal(run.id, result.result, state);
          continue;
        }

        try {
          this.advance(definition, state, token, node, result.outcome, result.output);
        } catch (error) {
          state.pending.shift();
          await this.runs.recordNodeEvent(run.id, "node_failed", node.id, {
            outcome: result.outcome,
            output: errorPayload(error),
            state: executionSnapshot(state),
          });
          throw error;
        }
        await this.runs.recordNodeEvent(run.id, "node_completed", node.id, {
          outcome: result.outcome,
          output: result.output,
          state: executionSnapshot(state),
        });
      }

      return this.finishTerminal(run.id, aggregateEndResult(state), state);
    } catch (error) {
      const current = await this.runs.getRun(run.id);
      if (terminalStatuses.has(current.status) || current.status === "paused" || current.status === "waiting_for_approval") {
        return current;
      }
      if (isAbortError(error) || signal.aborted) {
        if (current.status === "running") {
          return (await this.runs.interruptRun(run.id, { reason: errorMessage(error) })).run;
        }
        return current;
      }
      if (current.status === "running") {
        return (await this.runs.failRun(run.id, errorPayload(error))).run;
      }
      return current;
    }
  }

  private async executeNode(
    run: WorkflowRunRecord,
    definition: WorkflowDefinition,
    state: ExecutionState,
    token: ExecutionToken,
    node: WorkflowNode,
    signal: AbortSignal,
    ancestors: string[],
  ): Promise<NodeExecutionResult> {
    const context = expressionContext(run, state, token);
    switch (node.type) {
      case "trigger":
        return { kind: "continue", outcome: "started", output: context.input };
      case "pi-agent": {
        const prompt = [node.config.prompt.trim(), run.task?.trim() ? `Task:\n${run.task.trim()}` : ""]
          .filter(Boolean)
          .join("\n\n");
        if (!prompt) throw new Error("Pi Agent prompt and Run task are both empty.");
        const routing = this.modelRouting();
        const output = await this.piExecutor.run({
          cwd: run.repository,
          prompt,
          mode: node.config.mode,
          tools: node.config.tools,
          maxTurns: node.config.maxTurns,
          timeoutSeconds: node.config.timeoutSeconds,
          signal,
          persistSession: true,
          continueSession: node.config.sessionStrategy === "continue",
          modelRouting: routing?.providers.length ? routing : undefined,
          routeId: node.config.routeId,
          providerId: node.config.providerId,
          modelId: node.config.modelId,
        });
        return { kind: "continue", outcome: "completed", output };
      }
      case "action": {
        if (!node.config.command.trim()) throw new Error("Action command is empty.");
        const output = await this.actionExecutor.run({
          cwd: run.repository,
          command: node.config.command,
          timeoutSeconds: node.config.timeoutSeconds,
          signal,
        });
        state.validation = {
          passed: output.passed,
          checks: [{ name: node.name || node.config.handler, ...output }],
        };
        return { kind: "continue", outcome: output.passed ? "success" : "failure", output };
      }
      case "condition": {
        const matched = Boolean(await evaluateExpression(node.config.expression, context));
        return { kind: "continue", outcome: matched ? "true" : "false", output: { matched } };
      }
      case "loop": {
        const iteration = state.iterations[node.id] ?? 0;
        state.iterations[node.id] = iteration;
        const shouldContinue = Boolean(await evaluateExpression(
          node.config.continueCondition,
          expressionContext(run, state, token),
        ));
        if (shouldContinue && iteration < node.config.maxIterations) {
          state.iterations[node.id] = iteration + 1;
          return {
            kind: "continue",
            outcome: "continue",
            output: { iteration: iteration + 1, maxIterations: node.config.maxIterations },
          };
        }
        if (shouldContinue && node.config.onExhausted === "fail") {
          throw new Error(`Loop exhausted after ${node.config.maxIterations} iterations.`);
        }
        return {
          kind: "continue",
          outcome: "exhausted",
          output: { iteration, exhausted: shouldContinue },
        };
      }
      case "parallel":
        return {
          kind: "continue",
          outcome: "completed",
          output: { joinStrategy: node.config.joinStrategy, execution: "sequential_branches" },
        };
      case "human": {
        const decision = await pendingApprovalOutcome(this.runs, run.id, node.id);
        if (decision) {
          return {
            kind: "continue",
            outcome: decision.approved ? "approved" : "rejected",
            output: decision,
          };
        }
        await this.runs.requestApproval(run.id, {
          nodeId: node.id,
          title: node.config.title || node.name || "Workflow approval",
        });
        return { kind: "suspended" };
      }
      case "delay":
        await sleep(getDelayDurationMilliseconds(node.config), signal);
        return { kind: "continue", outcome: "completed", output: { waitedMs: getDelayDurationMilliseconds(node.config) } };
      case "wait-event": {
        if (node.config.waitType === "duration") {
          const waitedMs = (node.config.durationSeconds ?? 60) * 1_000;
          await sleep(waitedMs, signal);
          return { kind: "continue", outcome: "completed", output: { waitedMs } };
        }
        if (node.config.waitType === "datetime") {
          const timestamp = Date.parse(node.config.eventName ?? "");
          if (!Number.isFinite(timestamp)) throw new Error("Wait-event datetime must be an ISO timestamp.");
          const waitedMs = Math.max(0, timestamp - Date.now());
          await sleep(waitedMs, signal);
          return { kind: "continue", outcome: "completed", output: { waitedMs } };
        }
        await this.runs.interruptRun(run.id, {
          nodeId: node.id,
          reason: `${node.config.waitType} wake-up is not available in the local runtime protocol.`,
        });
        return { kind: "suspended" };
      }
      case "subworkflow": {
        if (ancestors.includes(node.config.workflowId) || definition.id === node.config.workflowId) {
          throw new Error(`Recursive subworkflow '${node.config.workflowId}' is not allowed.`);
        }
        const childDefinition = await this.loadExecutableDefinition(
          node.config.workflowId,
          node.config.workflowVersion,
        );
        const childRunId = `RUN-${this.idFactory()}`;
        await this.runs.createRun({
          id: childRunId,
          workflowId: childDefinition.id,
          workflowVersion: childDefinition.version,
          title: `${run.title} / ${childDefinition.name}`,
          repository: run.repository,
          task: run.task,
        });
        const childStarted = await this.runs.startRun(childRunId);
        const cancelChild = () => {
          void this.cancelRun(childRunId, { reason: `Parent Run '${run.id}' stopped.` })
            .catch(() => undefined);
        };
        signal.addEventListener("abort", cancelChild, { once: true });
        let child: WorkflowRunRecord;
        try {
          child = await this.launch(
            childStarted.run,
            childDefinition,
            [...ancestors, definition.id],
          );
        } finally {
          signal.removeEventListener("abort", cancelChild);
        }
        if (!terminalStatuses.has(child.status)) {
          await this.cancelRun(child.id, { reason: "Parent subworkflow cannot suspend." });
          throw new Error(`Subworkflow '${childDefinition.id}' suspended in status '${child.status}'.`);
        }
        return {
          kind: "continue",
          outcome: child.status === "completed" ? "completed" : "failed",
          output: { childRunId, status: child.status, result: child.result },
        };
      }
      case "end":
        return { kind: "terminal", result: node.config.result, output: token.input };
    }
  }

  private advance(
    definition: WorkflowDefinition,
    state: ExecutionState,
    token: ExecutionToken,
    node: WorkflowNode,
    outcome: string,
    output: unknown,
  ): void {
    const next = definition.edges.filter(
      (edge) => edge.sourceNodeId === node.id && edge.sourcePort === outcome,
    );
    if (next.length === 0) {
      throw new WorkflowExecutionError(
        "node_execution_failed",
        `Node '${node.id}' outcome '${outcome}' has no outgoing connection.`,
        { nodeId: node.id, outcome },
      );
    }
    state.pending.shift();
    const value = serializableOutput(output);
    state.outputs[node.id] = value;
    for (const edge of next) state.pending.push({ nodeId: edge.targetNodeId, input: value ?? token.input });
  }

  private hasOutcomeEdge(definition: WorkflowDefinition, nodeId: string, outcome: string): boolean {
    return definition.edges.some((edge) => edge.sourceNodeId === nodeId && edge.sourcePort === outcome);
  }

  private async finishTerminal(
    runId: string,
    result: "success" | "failed" | "cancelled" | "escalated",
    state: ExecutionState,
  ): Promise<WorkflowRunRecord> {
    const payload = {
      result,
      outputs: state.outputs,
      nodeExecutions: state.executionCount,
    };
    if (result === "success") return (await this.runs.completeRun(runId, payload)).run;
    if (result === "cancelled") return (await this.runs.cancelRun(runId, payload)).run;
    if (result === "escalated") return (await this.runs.interruptRun(runId, payload)).run;
    return (await this.runs.failRun(runId, payload)).run;
  }

  private async loadExecutableDefinition(workflowId: string, version: number): Promise<WorkflowDefinition> {
    const definition = await this.workflows.getWorkflowVersion(workflowId, version);
    const validation = validateWorkflowDefinition(definition);
    if (!validation.valid) {
      throw new WorkflowExecutionError(
        "workflow_invalid",
        `Workflow '${workflowId}' version ${version} is invalid and cannot run.`,
        validation,
      );
    }
    return definition;
  }
}

export class LocalActionExecutor implements WorkflowActionExecutor {
  async run(input: ActionExecutionInput): Promise<ActionExecutionResult> {
    input.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = spawn(input.command, {
        cwd: input.cwd,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const outputLimit = 64 * 1024;
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      const append = (current: string, chunk: Buffer): string => (
        current.length >= outputLimit
          ? current
          : current + chunk.toString("utf8").slice(0, outputLimit - current.length)
      );
      child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      const abort = () => child.kill("SIGTERM");
      input.signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, Math.max(1, input.timeoutSeconds) * 1_000);
      const cleanup = () => {
        clearTimeout(timer);
        input.signal.removeEventListener("abort", abort);
      };
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (input.signal.aborted) {
          reject(new WorkflowExecutionAbortError("Action execution was cancelled."));
          return;
        }
        const exitCode = timedOut ? 124 : code ?? 1;
        resolve({ exitCode, stdout, stderr, timedOut, passed: exitCode === 0 });
      });
    });
  }
}

class WorkflowExecutionAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbortError";
  }
}

function restoreExecutionState(
  events: WorkflowRunEvent[],
  definition: WorkflowDefinition,
): ExecutionState {
  for (const event of [...events].reverse()) {
    if (!["node_started", "node_completed", "node_failed", "node_skipped"].includes(event.type)) continue;
    const state = event.payload && typeof event.payload === "object"
      ? (event.payload as { state?: unknown }).state
      : undefined;
    if (isExecutionState(state)) return structuredClone(state);
  }
  const trigger = definition.nodes.find((node) => node.type === "trigger");
  if (!trigger) throw new WorkflowExecutionError("workflow_invalid", "Workflow has no Trigger node.");
  return {
    pending: [{ nodeId: trigger.id }],
    outputs: {},
    iterations: {},
    executionCount: 0,
    endResults: [],
  };
}

function executionSnapshot(state: ExecutionState): ExecutionState {
  return structuredClone(state);
}

function isExecutionState(value: unknown): value is ExecutionState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExecutionState>;
  return Array.isArray(candidate.pending)
    && candidate.outputs !== undefined
    && candidate.iterations !== undefined
    && typeof candidate.executionCount === "number"
    && Array.isArray(candidate.endResults);
}

function expressionContext(
  run: WorkflowRunRecord,
  state: ExecutionState,
  token: ExecutionToken,
): Record<string, unknown> {
  return {
    input: token.input,
    last: token.input,
    nodes: state.outputs,
    validation: state.validation ?? { passed: false, checks: [] },
    iterations: state.iterations,
    run: {
      id: run.id,
      workflowId: run.workflowId,
      workflowVersion: run.workflowVersion,
      repository: run.repository,
      task: run.task,
      trigger: run.trigger,
    },
  };
}

async function evaluateExpression(expression: string, context: Record<string, unknown>): Promise<unknown> {
  if (!expression.trim()) throw new Error("Expression is empty.");
  return expressionEngine.eval(expression, context);
}

async function pendingApprovalOutcome(
  runs: RunApplicationService,
  runId: string,
  nodeId: string,
): Promise<{ approved: boolean; approvalId?: string } | undefined> {
  const events = await runs.listEvents(runId);
  const completed = [...events].reverse().find(
    (event) => event.nodeId === nodeId
      && (event.type === "node_completed" || event.type === "node_failed" || event.type === "node_skipped"),
  );
  const decision = [...events].reverse().find(
    (event) => event.sequence > (completed?.sequence ?? 0)
      && event.nodeId === nodeId
      && (event.type === "approval_approved" || event.type === "approval_rejected"),
  );
  if (!decision) return undefined;
  const approvalId = decision.payload && typeof decision.payload === "object"
    ? (decision.payload as { approvalId?: string }).approvalId
    : undefined;
  return { approved: decision.type === "approval_approved", approvalId };
}

function defaultOutcome(node: WorkflowNode): string {
  const outcome = workflowNodePorts[node.type].outputs[0];
  if (!outcome) {
    throw new WorkflowExecutionError(
      "node_execution_failed",
      `Disabled terminal node '${node.id}' cannot be skipped.`,
    );
  }
  return outcome;
}

function failurePort(node: WorkflowNode): string | undefined {
  if (node.type === "pi-agent" || node.type === "parallel" || node.type === "subworkflow") return "failed";
  if (node.type === "action") return "failure";
  if (node.type === "wait-event") return "timeout";
  return undefined;
}

function aggregateEndResult(state: ExecutionState): "success" | "failed" | "cancelled" | "escalated" {
  if (state.endResults.length === 0) {
    throw new WorkflowExecutionError("node_execution_failed", "Workflow finished without reaching an End node.");
  }
  if (state.endResults.some((item) => item.result === "failed")) return "failed";
  if (state.endResults.some((item) => item.result === "cancelled")) return "cancelled";
  if (state.endResults.some((item) => item.result === "escalated")) return "escalated";
  return "success";
}

function serializableOutput(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

function errorPayload(error: unknown): { error: string; code?: string; details?: unknown } {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
  const details = error instanceof WorkflowExecutionError ? error.details : undefined;
  return { error: errorMessage(error), code, details };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof PiCodingAbortError
    || (error instanceof Error && error.name === "AbortError");
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new WorkflowExecutionAbortError("Workflow wait was cancelled."));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
