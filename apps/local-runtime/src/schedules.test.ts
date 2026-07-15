import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowSchedule } from "@pi-workflow/contracts";
import { buildScheduleSpec, temporalScheduleId } from "./schedules.js";

const baseSchedule: WorkflowSchedule = {
  id: "schedule-1",
  name: "Nightly coding",
  workflowId: "coding-workflow",
  workflowName: "Coding workflow",
  workflowVersion: 2,
  repositoryPath: "/tmp/project",
  task: "Run the validation task",
  frequency: "daily",
  scheduledAt: "2026-07-20T09:30:45.000Z",
  timeZone: "Asia/Shanghai",
  enabled: true,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
};

test("builds a daily calendar in the schedule timezone", () => {
  const spec = buildScheduleSpec(baseSchedule);
  assert.equal(spec.timezone, "Asia/Shanghai");
  assert.deepEqual(spec.calendars, [{ second: 45, minute: 30, hour: 17 }]);
});

test("builds a bounded one-time calendar", () => {
  const spec = buildScheduleSpec({ ...baseSchedule, frequency: "once" });
  assert.deepEqual(spec.calendars, [{
    second: 45,
    minute: 30,
    hour: 17,
    dayOfMonth: 20,
    month: "JULY",
    year: 2026,
  }]);
  assert.equal(spec.endAt?.getTime(), spec.startAt!.getTime() + 1_000);
});

test("uses a stable Temporal schedule identifier", () => {
  assert.equal(temporalScheduleId(baseSchedule), "pi-schedule-1");
  assert.equal(temporalScheduleId({ ...baseSchedule, temporalScheduleId: "custom" }), "custom");
});
