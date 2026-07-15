import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RunApplicationService } from "./run-service.js";
import { SqliteRunStateRepository } from "./sqlite-run-state-repository.js";

test("SQLite persists run, event, and approval state atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "piwf-run-state-"));
  const databasePath = join(directory, "runtime.db");
  try {
    const firstRepository = new SqliteRunStateRepository(databasePath);
    const first = new RunApplicationService(firstRepository);
    await first.createRun({ id: "RUN-SQLITE", workflowId: "workflow", workflowVersion: 1, title: "SQLite", repository: "/repo" });
    await first.startRun("RUN-SQLITE");
    await first.requestApproval("RUN-SQLITE", { id: "APPROVAL-SQLITE", title: "Review" });
    firstRepository.close();

    const secondRepository = new SqliteRunStateRepository(databasePath);
    const second = new RunApplicationService(secondRepository);
    assert.equal((await second.getRun("RUN-SQLITE")).status, "waiting_for_approval");
    assert.equal((await second.listEvents("RUN-SQLITE")).length, 3);
    assert.equal((await second.listApprovals("RUN-SQLITE"))[0].status, "pending");
    secondRepository.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
