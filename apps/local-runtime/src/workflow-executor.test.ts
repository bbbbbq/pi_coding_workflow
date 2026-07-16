import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  InMemoryRunStateRepository,
  InMemoryWorkflowRepository,
  RunApplicationService,
  WorkflowApplicationService,
} from "@pi-workflow/application-service";
import type {
  WorkflowDefinition,
  WorkflowNode,
} from "@pi-workflow/contracts";
import { createWorkflowNode } from "@pi-workflow/workflow-core";
import {
  LocalActionExecutor,
  WorkflowExecutionCoordinator,
  type WorkflowPiExecutor,
} from "./workflow-executor.js";

test("executes a graph, evaluates branches and persists node events", async () => {
  const workflows = new WorkflowApplicationService(new InMemoryWorkflowRepository());
  const definition = loopWorkflow();
  await workflows.createWorkflow(definition);
  const runs = createRunService();
  const actionCalls: string[] = [];
  const coordinator = new WorkflowExecutionCoordinator(
    workflows,
    runs,
    {
      actionExecutor: {
        async run(input) {
          actionCalls.push(input.command);
          return { exitCode: 0, stdout: "ok", stderr: "", timedOut: false, passed: true };
        },
      },
    },
  );

  await coordinator.createRun(runInput("RUN-GRAPH", definition));
  await coordinator.startRun("RUN-GRAPH", { background: false });
  const final = await coordinator.waitForRun("RUN-GRAPH");
  assert.equal(final.status, "completed");
  assert.deepEqual(actionCalls, ["npm test"]);

  const events = await runs.listEvents("RUN-GRAPH");
  assert.equal(events.filter((event) => event.type === "node_started").length, 7);
  assert.equal(events.filter((event) => event.type === "node_completed" && event.nodeId === "loop").length, 3);
  assert.deepEqual(events.slice(-1).map((event) => event.type), ["run_completed"]);
});

test("executes Pi Agent nodes through the injected Pi executor", async () => {
  const workflows = new WorkflowApplicationService(new InMemoryWorkflowRepository());
  const definition = piWorkflow();
  await workflows.createWorkflow(definition);
  const calls: Array<{ cwd: string; prompt: string; mode: string }> = [];
  const piExecutor: WorkflowPiExecutor = {
    async run(input) {
      calls.push({ cwd: input.cwd, prompt: input.prompt, mode: input.mode });
      return {
        status: "completed",
        sessionId: "session-1",
        messageCount: 2,
        output: "implemented",
      };
    },
  };
  const coordinator = new WorkflowExecutionCoordinator(
    workflows,
    createRunService(),
    { piExecutor },
  );

  await coordinator.createRun({
    ...runInput("RUN-PI", definition),
    task: "Fix the failing test",
  });
  await coordinator.startRun("RUN-PI", { background: false });
  assert.equal((await coordinator.waitForRun("RUN-PI")).status, "completed");
  assert.deepEqual(calls, [{
    cwd: "/repo",
    prompt: "Inspect and implement\n\nTask:\nFix the failing test",
    mode: "implement",
  }]);
});

test("suspends for approval and resumes along the approved edge", async () => {
  const workflows = new WorkflowApplicationService(new InMemoryWorkflowRepository());
  const definition = approvalWorkflow();
  await workflows.createWorkflow(definition);
  const runs = createRunService();
  const coordinator = new WorkflowExecutionCoordinator(workflows, runs);

  await coordinator.createRun(runInput("RUN-APPROVAL", definition));
  await coordinator.startRun("RUN-APPROVAL", { background: false });
  assert.equal((await runs.getRun("RUN-APPROVAL")).status, "waiting_for_approval");
  const approval = (await runs.listApprovals("RUN-APPROVAL"))[0];
  assert.ok(approval);

  await coordinator.decideApproval(
    "RUN-APPROVAL",
    approval.id,
    { approved: true, note: "Proceed" },
    { background: false },
  );
  const final = await runs.getRun("RUN-APPROVAL");
  assert.equal(final.status, "completed");
  const completedHuman = (await runs.listEvents(final.id)).find(
    (event) => event.type === "node_completed" && event.nodeId === "approval",
  );
  assert.equal((completedHuman?.payload as { outcome?: string }).outcome, "approved");
});

test("local action executor runs commands in the requested repository", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwf-action-"));
  try {
    const output = await new LocalActionExecutor().run({
      cwd: directory,
      command: "printf 'workflow-ok'",
      timeoutSeconds: 5,
      signal: new AbortController().signal,
    });
    assert.equal(output.passed, true);
    assert.equal(output.stdout, "workflow-ok");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reclaims a stale running Run and resumes from durable state", async () => {
  const workflows = new WorkflowApplicationService(new InMemoryWorkflowRepository());
  const trigger = createNode("trigger", "trigger");
  const end = createNode("end", "end");
  const workflow = definition("resume-workflow", [trigger, end], [["trigger", "started", "end"]]);
  await workflows.createWorkflow(workflow);
  const runs = createRunService();
  const coordinator = new WorkflowExecutionCoordinator(workflows, runs);
  await coordinator.createRun(runInput("RUN-STALE", workflow));
  await runs.startRun("RUN-STALE");

  await coordinator.resumeRun("RUN-STALE", { background: false });
  assert.equal((await runs.getRun("RUN-STALE")).status, "completed");
  assert.deepEqual((await runs.listEvents("RUN-STALE")).map((event) => event.type).slice(0, 5), [
    "run_created",
    "run_started",
    "run_interrupted",
    "run_resumed",
    "run_started",
  ]);
});

function createRunService() {
  return new RunApplicationService(new InMemoryRunStateRepository());
}

function runInput(id: string, definition: WorkflowDefinition) {
  return {
    id,
    workflowId: definition.id,
    workflowVersion: definition.version,
    title: id,
    repository: "/repo",
  };
}

function loopWorkflow(): WorkflowDefinition {
  const trigger = createNode("trigger", "trigger");
  const action = createNode("action", "action");
  action.config.command = "npm test";
  const condition = createNode("condition", "condition");
  condition.config.expression = "validation.passed === true";
  const loop = createNode("loop", "loop");
  loop.config.maxIterations = 2;
  loop.config.continueCondition = "iterations.loop < 2";
  const end = createNode("end", "end");
  return definition("graph-workflow", [trigger, action, condition, loop, end], [
    ["trigger", "started", "action"],
    ["action", "success", "condition"],
    ["condition", "true", "loop"],
    ["condition", "false", "end"],
    ["loop", "continue", "loop"],
    ["loop", "exhausted", "end"],
  ]);
}

function piWorkflow(): WorkflowDefinition {
  const trigger = createNode("trigger", "trigger");
  const agent = createNode("agent", "pi-agent");
  agent.config.prompt = "Inspect and implement";
  const end = createNode("end", "end");
  return definition("pi-workflow", [trigger, agent, end], [
    ["trigger", "started", "agent"],
    ["agent", "completed", "end"],
  ]);
}

function approvalWorkflow(): WorkflowDefinition {
  const trigger = createNode("trigger", "trigger");
  const approval = createNode("approval", "human");
  const success = createNode("success", "end");
  const rejected = createNode("rejected", "end");
  rejected.config.result = "failed";
  return definition("approval-workflow", [trigger, approval, success, rejected], [
    ["trigger", "started", "approval"],
    ["approval", "approved", "success"],
    ["approval", "rejected", "rejected"],
  ]);
}

function createNode<Type extends WorkflowNode["type"]>(id: string, type: Type): Extract<WorkflowNode, { type: Type }> {
  return createWorkflowNode({ id, type, name: "", position: { x: 0, y: 0 } }) as Extract<WorkflowNode, { type: Type }>;
}

function definition(
  id: string,
  nodes: WorkflowNode[],
  edges: Array<[source: string, port: string, target: string]>,
): WorkflowDefinition {
  return {
    id,
    name: id,
    version: 1,
    updatedAt: new Date(0).toISOString(),
    nodes,
    edges: edges.map(([sourceNodeId, sourcePort, targetNodeId], index) => ({
      id: `edge-${index}`,
      sourceNodeId,
      sourcePort,
      targetNodeId,
      targetPort: "input",
    })),
  };
}
