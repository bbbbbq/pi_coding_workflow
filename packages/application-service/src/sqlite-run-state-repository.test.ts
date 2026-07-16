import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RunApplicationService } from "./run-service.js";
import { SqliteRunStateRepository } from "./sqlite-run-state-repository.js";

test("SQLite persists node events, results, and approval state atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwf-run-state-"));
  const databasePath = join(directory, "runtime.db");
  try {
    const firstRepository = new SqliteRunStateRepository(databasePath);
    const first = new RunApplicationService(firstRepository);
    await first.createRun({ id: "RUN-SQLITE", workflowId: "workflow", workflowVersion: 1, title: "SQLite", repository: "/repo" });
    await first.startRun("RUN-SQLITE");
    await first.recordNodeEvent("RUN-SQLITE", "node_started", "human");
    await first.requestApproval("RUN-SQLITE", { id: "APPROVAL-SQLITE", title: "Review" });
    await first.decideApproval("RUN-SQLITE", "APPROVAL-SQLITE", { approved: true });
    await first.startRun("RUN-SQLITE");
    await first.recordNodeEvent("RUN-SQLITE", "node_completed", "human", { outcome: "approved" });
    await first.completeRun("RUN-SQLITE", { delivered: true });
    firstRepository.close();

    const secondRepository = new SqliteRunStateRepository(databasePath);
    const second = new RunApplicationService(secondRepository);
    const stored = await second.getRun("RUN-SQLITE");
    assert.equal(stored.status, "completed");
    assert.deepEqual(stored.result, { delivered: true });
    assert.equal((await second.listEvents("RUN-SQLITE")).length, 8);
    assert.equal((await second.listApprovals("RUN-SQLITE"))[0].status, "approved");
    secondRepository.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
