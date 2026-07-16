import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryRunStateRepository,
  RunApplicationError,
  RunApplicationService,
} from "./run-service.js";

test("run state machine records ordered lifecycle events", async () => {
  let tick = 0;
  const service = new RunApplicationService(new InMemoryRunStateRepository(), {
    now: () => `2026-07-15T00:00:0${tick++}.000Z`,
    idFactory: () => `id-${tick}`,
  });
  await service.createRun({
    id: "RUN-1",
    workflowId: "workflow",
    workflowVersion: 3,
    title: "Test run",
    repository: "/repo",
  });
  await service.startRun("RUN-1");
  await service.pauseRun("RUN-1");
  await service.resumeRun("RUN-1");
  const run = await service.getRun("RUN-1");
  assert.equal(run.status, "queued");
  assert.deepEqual((await service.listEvents("RUN-1")).map((event) => event.type), [
    "run_created",
    "run_started",
    "run_paused",
    "run_resumed",
  ]);
});

test("approval decision is committed with the next run state", async () => {
  const service = new RunApplicationService(new InMemoryRunStateRepository(), {
    now: () => "2026-07-15T00:00:00.000Z",
    idFactory: () => "fixed-id",
  });
  await service.createRun({ id: "RUN-2", workflowId: "workflow", workflowVersion: 1, title: "Approval", repository: "/repo" });
  await service.startRun("RUN-2");
  const requested = await service.requestApproval("RUN-2", { id: "APPROVAL-1", title: "Review plan" });
  assert.equal(requested.run.status, "waiting_for_approval");
  const decided = await service.decideApproval("RUN-2", "APPROVAL-1", { approved: true, note: "Proceed" });
  assert.equal(decided.run.status, "queued");
  assert.equal(decided.approval?.status, "approved");
});

test("rejected approvals resume through the workflow rejected edge", async () => {
  const service = new RunApplicationService(new InMemoryRunStateRepository());
  await service.createRun({ id: "RUN-REJECT", workflowId: "workflow", workflowVersion: 1, title: "Approval", repository: "/repo" });
  await service.startRun("RUN-REJECT");
  await service.requestApproval("RUN-REJECT", { id: "APPROVAL-REJECT", nodeId: "human", title: "Review" });
  const decided = await service.decideApproval("RUN-REJECT", "APPROVAL-REJECT", { approved: false });
  assert.equal(decided.run.status, "queued");
  assert.equal(decided.approval?.status, "rejected");
});

test("node events and terminal results are persisted on the Run", async () => {
  const service = new RunApplicationService(new InMemoryRunStateRepository());
  await service.createRun({ id: "RUN-NODE", workflowId: "workflow", workflowVersion: 1, title: "Node events", repository: "/repo" });
  await service.startRun("RUN-NODE");
  await service.recordNodeEvent("RUN-NODE", "node_started", "agent", { attempt: 1 });
  await service.recordNodeEvent("RUN-NODE", "node_completed", "agent", { output: "done" });
  const completed = await service.completeRun("RUN-NODE", { output: "done" });
  assert.deepEqual(completed.run.result, { output: "done" });
  assert.deepEqual((await service.listEvents("RUN-NODE")).map((event) => event.type), [
    "run_created",
    "run_started",
    "node_started",
    "node_completed",
    "run_completed",
  ]);
});

test("invalid terminal transitions are rejected", async () => {
  const service = new RunApplicationService(new InMemoryRunStateRepository());
  await service.createRun({ id: "RUN-3", workflowId: "workflow", workflowVersion: 1, title: "Terminal", repository: "/repo" });
  await service.cancelRun("RUN-3");
  await assert.rejects(
    service.startRun("RUN-3"),
    (error: unknown) => error instanceof RunApplicationError && error.code === "run_transition_invalid",
  );
});
