import type {
  WorkflowSchedule,
  WorkflowScheduleFrequency,
} from "@pi-workflow/contracts";

export function calculateNextRunAt(input: {
  frequency: WorkflowScheduleFrequency;
  scheduledAt: string;
  after: Date;
  hasRun?: boolean;
}): string | undefined {
  const candidate = new Date(input.scheduledAt);
  if (Number.isNaN(candidate.getTime()) || Number.isNaN(input.after.getTime())) {
    return undefined;
  }

  if (input.frequency === "once") {
    return !input.hasRun && candidate.getTime() > input.after.getTime()
      ? candidate.toISOString()
      : undefined;
  }

  const dayStep = input.frequency === "daily" ? 1 : 7;
  while (candidate.getTime() <= input.after.getTime()) {
    candidate.setDate(candidate.getDate() + dayStep);
  }

  return candidate.toISOString();
}
export function isWorkflowScheduleDue(
  schedule: WorkflowSchedule,
  now = new Date(),
): boolean {
  if (!schedule.enabled || !schedule.nextRunAt) return false;
  const nextRunAt = new Date(schedule.nextRunAt);
  return !Number.isNaN(nextRunAt.getTime()) && nextRunAt.getTime() <= now.getTime();
}

export function advanceWorkflowSchedule(
  schedule: WorkflowSchedule,
  ranAt = new Date(),
): WorkflowSchedule {
  const nextRunAt = calculateNextRunAt({
    frequency: schedule.frequency,
    scheduledAt: schedule.scheduledAt,
    after: ranAt,
    hasRun: true,
  });

  return {
    ...schedule,
    enabled: schedule.frequency === "once" ? false : schedule.enabled,
    lastRunAt: ranAt.toISOString(),
    nextRunAt,
    updatedAt: ranAt.toISOString(),
  };
}
