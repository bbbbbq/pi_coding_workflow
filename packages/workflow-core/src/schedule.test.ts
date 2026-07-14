import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowSchedule } from "@pi-workflow/contracts";
import {
  advanceWorkflowSchedule,
  calculateNextRunAt,
  isWorkflowScheduleDue,
} from "./schedule.js";

test("keeps a future one-time schedule", () => {
  const next = calculateNextRunAt({
    frequency: "once",
    scheduledAt: "2026-08-01T10:30:00.000Z",
    after: new Date("2026-08-01T10:00:00.000Z"),
  });

  assert.equal(next, "2026-08-01T10:30:00.000Z");
});
test("advances daily and weekly schedules beyond the reference time", () => {
  assert.equal(calculateNextRunAt({
    frequency: "daily",
    scheduledAt: "2026-07-10T09:00:00.000Z",
    after: new Date("2026-07-12T09:01:00.000Z"),
  }), "2026-07-13T09:00:00.000Z");

  assert.equal(calculateNextRunAt({
    frequency: "weekly",
    scheduledAt: "2026-07-01T09:00:00.000Z",
    after: new Date("2026-07-15T09:00:00.000Z"),
  }), "2026-07-22T09:00:00.000Z");
});

test("marks a due one-time schedule complete after it runs", () => {
  const schedule: WorkflowSchedule = {
    id: "schedule-1",
    name: "Morning repair",
    workflowId: "coding-workflow",
    workflowName: "Coding workflow",
    workflowVersion: 1,
    repositoryPath: "/tmp/project",
    task: "Validate the repository",
    frequency: "once",
    scheduledAt: "2026-07-15T09:00:00.000Z",
    nextRunAt: "2026-07-15T09:00:00.000Z",
    timeZone: "Asia/Shanghai",
    enabled: true,
    createdAt: "2026-07-15T08:00:00.000Z",
    updatedAt: "2026-07-15T08:00:00.000Z",
  };

  const now = new Date("2026-07-15T09:00:01.000Z");
  assert.equal(isWorkflowScheduleDue(schedule, now), true);

  const advanced = advanceWorkflowSchedule(schedule, now);
  assert.equal(advanced.enabled, false);
  assert.equal(advanced.nextRunAt, undefined);
  assert.equal(advanced.lastRunAt, now.toISOString());
});
