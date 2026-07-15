import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  OrchestratorApplicationService,
  OrchestratorClientError,
  type RunControlOperation,
  type ScheduleControlOperation,
} from "@pi-workflow/application-service/orchestrator-client";
import {
  WorkflowApplicationError,
  WorkflowApplicationService,
  type AddWorkflowNodeInput,
  type ChangeOptions,
  type ConnectWorkflowEdgeInput,
  type UpdateWorkflowNodeInput,
  type WorkflowRecord,
  type WorkflowRepository,
  type WorkflowSaveOptions,
} from "@pi-workflow/application-service";
import type { SqliteWorkflowRepository } from "@pi-workflow/application-service/sqlite";
import type {
  ApprovalDecision,
  RegisterTemporalScheduleRequest,
  StartTemporalRunRequest,
  WorkflowDefinition,
  WorkflowNodeType,
} from "@pi-workflow/contracts";
import { Command, CommanderError, Option } from "commander";
import { readInlineOrReferencedInput, readStructuredInput, writeError, writeOutput } from "./io.js";

export const cliExitCodes = {
  success: 0,
  failure: 1,
  usage: 2,
  notFound: 3,
  validation: 4,
  conflict: 5,
  remote: 6,
} as const;

interface GlobalOptions {
  json?: boolean;
  dryRun?: boolean;
  ifVersion?: number;
  database: string;
  apiUrl: string;
}

interface CliContext {
  workflows: WorkflowApplicationService;
  orchestrator: OrchestratorApplicationService;
}

class CliExit extends Error {
  constructor(readonly exitCode: number) {
    super(`CLI exited with code ${exitCode}.`);
    this.name = "CliExit";
  }
}

export function createProgram(context: CliContext): Command {
  const program = new Command()
    .name("piwf")
    .description("Manage Pi coding workflows from scripts and terminals.")
    .version("0.1.0")
    .option("--json", "write machine-readable JSON to stdout")
    .option("--dry-run", "validate and preview mutations without writing or starting work")
    .addOption(new Option("--if-version <version>", "require the current workflow version").argParser(parseInteger))
    .option("--database <path>", "workflow SQLite database", defaultDatabasePath())
    .option("--api-url <url>", "Orchestrator API URL", process.env.PIWF_API_URL ?? "http://127.0.0.1:8787")
    .configureOutput({ writeErr: () => undefined })
    .showSuggestionAfterError();

  addWorkflowCommands(program, context);
  addNodeCommands(program, context);
  addEdgeCommands(program, context);
  addRunCommands(program, context);
  addScheduleCommands(program, context);
  addModelCommands(program, context);
  return program;
}

export async function runCli(argv = process.argv): Promise<number> {
  let repository: LazyWorkflowRepository | undefined;
  let json = argv.includes("--json");
  try {
    const bootstrap = readBootstrapOptions(argv);
    json = bootstrap.json === true;
    repository = new LazyWorkflowRepository(bootstrap.database);
    const context: CliContext = {
      workflows: new WorkflowApplicationService(repository),
      orchestrator: new OrchestratorApplicationService(bootstrap.apiUrl),
    };
    const program = createProgram(context);
    program.exitOverride();
    await program.parseAsync(argv);
    return cliExitCodes.success;
  } catch (error) {
    const failure = classifyError(error);
    if (!failure.silent) {
      writeError({ error: { code: failure.code, message: failure.message, details: failure.details } }, json);
    }
    return failure.exitCode;
  } finally {
    repository?.close();
  }
}

function addWorkflowCommands(program: Command, context: CliContext): void {
  const workflow = program.command("workflow").description("Create, validate, publish, and inspect workflows.");

  workflow.command("list").action(async (_options, command) => {
    output(await context.workflows.listWorkflows(), command);
  });

  workflow.command("show <workflow-id>").action(async (workflowId: string, _options, command) => {
    output(await context.workflows.getWorkflow(workflowId), command);
  });

  workflow.command("create")
    .requiredOption("--file <path>", "workflow JSON/YAML file, or - for stdin")
    .action(async (options: { file: string }, command) => {
      const definition = await readDefinition(options.file);
      output(await context.workflows.createWorkflow(definition, mutationOptions(command)), command);
    });

  workflow.command("apply")
    .requiredOption("--file <path>", "workflow JSON/YAML file, or - for stdin")
    .action(async (options: { file: string }, command) => {
      const definition = await readDefinition(options.file);
      output(await context.workflows.applyWorkflow(definition, mutationOptions(command)), command);
    });

  workflow.command("validate <workflow-id>").action(async (workflowId: string, _options, command) => {
    const validation = await context.workflows.validateWorkflow(workflowId);
    output(validation, command);
    if (!validation.valid) throw new CliExit(cliExitCodes.validation);
  });

  workflow.command("publish <workflow-id>").action(async (workflowId: string, _options, command) => {
    output(await context.workflows.publishWorkflow(workflowId, mutationOptions(command)), command);
  });

  workflow.command("delete <workflow-id>").action(async (workflowId: string, _options, command) => {
    output(await context.workflows.deleteWorkflow(workflowId, mutationOptions(command)), command);
  });
}

function addNodeCommands(program: Command, context: CliContext): void {
  const node = program.command("node").description("Modify workflow nodes using optimistic version checks.");

  node.command("add <workflow-id>")
    .requiredOption("--type <type>", "workflow node type")
    .option("--config <json-or-reference>", "node config as JSON/YAML, @file, or -")
    .option("--id <node-id>")
    .option("--name <name>")
    .option("--x <number>", "canvas x coordinate", parseNumber)
    .option("--y <number>", "canvas y coordinate", parseNumber)
    .action(async (workflowId: string, options: {
      type: WorkflowNodeType;
      config?: string;
      id?: string;
      name?: string;
      x?: number;
      y?: number;
    }, command) => {
      const input: AddWorkflowNodeInput = {
        id: options.id,
        type: options.type,
        name: options.name,
        position: options.x !== undefined || options.y !== undefined
          ? { x: options.x ?? 0, y: options.y ?? 0 }
          : undefined,
        config: options.config ? asObject(await readInlineOrReferencedInput(options.config), "node config") : undefined,
      };
      output(await context.workflows.addNode(workflowId, input, mutationOptions(command)), command);
    });

  node.command("update <workflow-id> <node-id>")
    .requiredOption("--config <json-or-reference>", "node patch as JSON/YAML, @file, or -")
    .action(async (workflowId: string, nodeId: string, options: { config: string }, command) => {
      const value = asObject(await readInlineOrReferencedInput(options.config), "node patch");
      const patch = isNodePatch(value)
        ? value as UpdateWorkflowNodeInput
        : { config: value };
      output(await context.workflows.updateNode(workflowId, nodeId, patch, mutationOptions(command)), command);
    });

  for (const [name, enabled] of [["enable", true], ["disable", false]] as const) {
    node.command(`${name} <workflow-id> <node-id>`)
      .action(async (workflowId: string, nodeId: string, _options, command) => {
        output(await context.workflows.setNodeEnabled(workflowId, nodeId, enabled, mutationOptions(command)), command);
      });
  }

  node.command("remove <workflow-id> <node-id>")
    .action(async (workflowId: string, nodeId: string, _options, command) => {
      output(await context.workflows.removeNode(workflowId, nodeId, mutationOptions(command)), command);
    });
}

function addEdgeCommands(program: Command, context: CliContext): void {
  program.command("edge")
    .description("Connect workflow nodes.")
    .command("connect <workflow-id> <source-node> <target-node>")
    .option("--id <edge-id>")
    .option("--source-port <port>")
    .option("--target-port <port>")
    .action(async (
      workflowId: string,
      sourceNodeId: string,
      targetNodeId: string,
      options: { id?: string; sourcePort?: string; targetPort?: string },
      command,
    ) => {
      const input: ConnectWorkflowEdgeInput = { ...options, sourceNodeId, targetNodeId };
      output(await context.workflows.connectEdge(workflowId, input, mutationOptions(command)), command);
    });
}

function addRunCommands(program: Command, context: CliContext): void {
  const run = program.command("run").description("Start and control Temporal coding runs.");

  run.command("start <workflow-id>")
    .requiredOption("--input <json-or-reference>", "run input as JSON/YAML, @file, or -")
    .action(async (workflowId: string, options: { input: string }, command) => {
      const input = asObject(await readInlineOrReferencedInput(options.input), "run input");
      const workflow = await context.workflows.getWorkflow(workflowId);
      const request: StartTemporalRunRequest = {
        ...(input as unknown as StartTemporalRunRequest),
        runId: typeof input.runId === "string" ? input.runId : `RUN-${randomUUID()}`,
        workflowId,
        workflowVersion: workflow.definition.version,
      };
      if (globalOptions(command).dryRun) return output({ dryRun: true, request }, command);
      output(await context.orchestrator.startRun(request), command);
    });

  run.command("list").action(async (_options, command) => {
    output(await context.orchestrator.listRuns(), command);
  });

  run.command("inspect <workflow-id>").action(async (workflowId: string, _options, command) => {
    output(await context.orchestrator.inspectRun(workflowId), command);
  });

  for (const operation of ["pause", "resume", "cancel"] as RunControlOperation[]) {
    run.command(`${operation} <workflow-id>`).action(async (workflowId: string, _options, command) => {
      if (globalOptions(command).dryRun) return output({ dryRun: true, workflowId, operation }, command);
      await context.orchestrator.controlRun(workflowId, operation);
      output({ workflowId, operation, accepted: true }, command);
    });
  }

  run.command("approve <workflow-id>")
    .option("--reject", "reject instead of approve")
    .option("--note <note>")
    .action(async (workflowId: string, options: { reject?: boolean; note?: string }, command) => {
      const decision: ApprovalDecision = { approved: !options.reject, note: options.note };
      if (globalOptions(command).dryRun) return output({ dryRun: true, workflowId, decision }, command);
      await context.orchestrator.approveRun(workflowId, decision);
      output({ workflowId, decision, accepted: true }, command);
    });
}

function addScheduleCommands(program: Command, context: CliContext): void {
  const schedule = program.command("schedule").description("Register and control Temporal schedules.");

  schedule.command("create")
    .requiredOption("--file <path>", "schedule request JSON/YAML, or - for stdin")
    .action(async (options: { file: string }, command) => {
      const request = await readStructuredInput(options.file) as RegisterTemporalScheduleRequest;
      if (globalOptions(command).dryRun) return output({ dryRun: true, request }, command);
      output(await context.orchestrator.registerSchedule(request), command);
    });

  schedule.command("inspect <schedule-id>").action(async (scheduleId: string, _options, command) => {
    output(await context.orchestrator.describeSchedule(scheduleId), command);
  });

  for (const operation of ["pause", "resume", "trigger"] as ScheduleControlOperation[]) {
    schedule.command(`${operation} <schedule-id>`).action(async (scheduleId: string, _options, command) => {
      if (globalOptions(command).dryRun) return output({ dryRun: true, scheduleId, operation }, command);
      output(await context.orchestrator.controlSchedule(scheduleId, operation), command);
    });
  }

  schedule.command("delete <schedule-id>").action(async (scheduleId: string, _options, command) => {
    if (globalOptions(command).dryRun) return output({ dryRun: true, scheduleId, operation: "delete" }, command);
    await context.orchestrator.deleteSchedule(scheduleId);
    output({ scheduleId, deleted: true }, command);
  });
}

function addModelCommands(program: Command, context: CliContext): void {
  const provider = program.command("provider").description("Inspect Orchestrator model providers.");
  provider.command("list").action(async (_options, command) => {
    output(await context.orchestrator.listProviders(), command);
  });
  provider.command("test <provider-id>").action(async (providerId: string, _options, command) => {
    output(await context.orchestrator.testProvider(providerId), command);
  });

  const route = program.command("route").description("Inspect and resolve Orchestrator model routes.");
  route.command("list").action(async (_options, command) => {
    output(await context.orchestrator.listRoutes(), command);
  });
  route.command("resolve <route-id>").action(async (routeId: string, _options, command) => {
    output(await context.orchestrator.resolveRoute(routeId), command);
  });
}

function output(value: unknown, command: Command): void {
  writeOutput(value, globalOptions(command).json === true);
}

function mutationOptions(command: Command): ChangeOptions {
  const options = globalOptions(command);
  return { dryRun: options.dryRun, ifVersion: options.ifVersion };
}

function globalOptions(command: Command): GlobalOptions {
  return command.optsWithGlobals<GlobalOptions>();
}

function readBootstrapOptions(argv: string[]): GlobalOptions {
  return {
    json: argv.includes("--json"),
    dryRun: argv.includes("--dry-run"),
    ifVersion: optionNumber(argv, "--if-version"),
    database: optionValue(argv, "--database") ?? process.env.PIWF_DATABASE ?? defaultDatabasePath(),
    apiUrl: optionValue(argv, "--api-url") ?? process.env.PIWF_API_URL ?? "http://127.0.0.1:8787",
  };
}

function optionValue(argv: string[], name: string): string | undefined {
  const prefixed = argv.find((value) => value.startsWith(`${name}=`));
  if (prefixed) return prefixed.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function optionNumber(argv: string[], name: string): number | undefined {
  const value = optionValue(argv, name);
  return value === undefined ? undefined : parseInteger(value);
}

async function readDefinition(reference: string): Promise<WorkflowDefinition> {
  const input = await readStructuredInput(reference);
  const definition = asObject(input, "workflow definition") as unknown as WorkflowDefinition;
  if (!Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
    throw new WorkflowApplicationError("input_invalid", "Workflow nodes and edges must be arrays.");
  }
  return definition;
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowApplicationError("input_invalid", `${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function isNodePatch(value: Record<string, unknown>): boolean {
  return ["name", "enabled", "position", "config"].some((key) => Object.hasOwn(value, key));
}

function parseInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Expected a non-negative integer, received '${value}'.`);
  return parsed;
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a number, received '${value}'.`);
  return parsed;
}

function defaultDatabasePath(): string {
  return process.env.PIWF_DATABASE ?? join(homedir(), ".pi-workflow", "piwf.db");
}

function classifyError(error: unknown): {
  code: string;
  message: string;
  details?: unknown;
  exitCode: number;
  silent?: boolean;
} {
  if (error instanceof CommanderError) {
    return {
      code: "usage_error",
      message: error.message,
      exitCode: error.code === "commander.helpDisplayed" || error.code === "commander.version"
        ? cliExitCodes.success
        : cliExitCodes.usage,
      silent: error.code === "commander.helpDisplayed" || error.code === "commander.version",
    };
  }
  if (error instanceof CliExit) {
    return { code: "command_failed", message: error.message, exitCode: error.exitCode, silent: true };
  }
  if (error instanceof WorkflowApplicationError) {
    const exitCode = error.code === "workflow_not_found" || error.code === "node_not_found"
      ? cliExitCodes.notFound
      : error.code === "version_conflict" || error.code === "workflow_exists"
        ? cliExitCodes.conflict
        : error.code === "validation_failed"
          ? cliExitCodes.validation
          : cliExitCodes.usage;
    return { code: error.code, message: error.message, details: error.details, exitCode };
  }
  if (error instanceof OrchestratorClientError) {
    return { code: error.code, message: error.message, details: error.details, exitCode: cliExitCodes.remote };
  }
  return {
    code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
    exitCode: cliExitCodes.failure,
  };
}

class LazyWorkflowRepository implements WorkflowRepository {
  private repository?: SqliteWorkflowRepository;

  constructor(private readonly databasePath: string) {}

  async list(): Promise<WorkflowRecord[]> {
    return (await this.getRepository()).list();
  }

  async get(workflowId: string): Promise<WorkflowRecord | undefined> {
    return (await this.getRepository()).get(workflowId);
  }

  async save(record: WorkflowRecord, options?: WorkflowSaveOptions): Promise<void> {
    await (await this.getRepository()).save(record, options);
  }

  async delete(workflowId: string, options?: WorkflowSaveOptions): Promise<void> {
    await (await this.getRepository()).delete(workflowId, options);
  }

  close(): void {
    this.repository?.close();
  }

  private async getRepository(): Promise<SqliteWorkflowRepository> {
    if (!this.repository) {
      const { SqliteWorkflowRepository } = await import("@pi-workflow/application-service/sqlite");
      this.repository = new SqliteWorkflowRepository(this.databasePath);
    }
    return this.repository;
  }
}
