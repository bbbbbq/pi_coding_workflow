import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WorkflowSchedule,
  WorkflowScheduleFrequency,
} from "@pi-workflow/contracts";
import {
  advanceWorkflowSchedule,
  calculateNextRunAt,
  isWorkflowScheduleDue,
} from "@pi-workflow/workflow-core";

const storageKey = "pi-workflow.schedules.v1";

export interface CreateWorkflowScheduleInput {
  name: string;
  workflowId: string;
  workflowName: string;
  frequency: WorkflowScheduleFrequency;
  scheduledAt: string;
  timeZone: string;
}
export function useWorkflowSchedules(
  onDue: (schedule: WorkflowSchedule) => void,
) {
  const [schedules, setSchedules] = useState<WorkflowSchedule[]>(loadSchedules);
  const schedulesRef = useRef(schedules);
  const onDueRef = useRef(onDue);
  onDueRef.current = onDue;

  const replaceSchedules = useCallback((next: WorkflowSchedule[]) => {
    schedulesRef.current = next;
    setSchedules(next);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  }, []);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const dueIds = new Set(
        schedulesRef.current
          .filter((schedule) => isWorkflowScheduleDue(schedule, now))
          .map((schedule) => schedule.id),
      );
      if (dueIds.size === 0) return;

      const dueSchedules = schedulesRef.current.filter((schedule) => dueIds.has(schedule.id));
      replaceSchedules(schedulesRef.current.map((schedule) => (
        dueIds.has(schedule.id) ? advanceWorkflowSchedule(schedule, now) : schedule
      )));
      dueSchedules.forEach((schedule) => onDueRef.current(schedule));
    };

    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [replaceSchedules]);

  const createSchedule = useCallback((input: CreateWorkflowScheduleInput) => {
    const now = new Date();
    const nextRunAt = calculateNextRunAt({
      frequency: input.frequency,
      scheduledAt: input.scheduledAt,
      after: now,
    });
    if (!nextRunAt) return false;

    const schedule: WorkflowSchedule = {
      id: `schedule-${crypto.randomUUID()}`,
      ...input,
      nextRunAt,
      enabled: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    replaceSchedules([schedule, ...schedulesRef.current]);
    return true;
  }, [replaceSchedules]);

  const toggleSchedule = useCallback((scheduleId: string) => {
    const now = new Date();
    replaceSchedules(schedulesRef.current.map((schedule) => {
      if (schedule.id !== scheduleId) return schedule;
      if (schedule.enabled) {
        return { ...schedule, enabled: false, updatedAt: now.toISOString() };
      }

      const nextRunAt = calculateNextRunAt({
        frequency: schedule.frequency,
        scheduledAt: schedule.scheduledAt,
        after: now,
        hasRun: schedule.frequency === "once" && Boolean(schedule.lastRunAt),
      });
      if (!nextRunAt) return schedule;
      return { ...schedule, enabled: true, nextRunAt, updatedAt: now.toISOString() };
    }));
  }, [replaceSchedules]);

  const deleteSchedule = useCallback((scheduleId: string) => {
    replaceSchedules(schedulesRef.current.filter((schedule) => schedule.id !== scheduleId));
  }, [replaceSchedules]);

  return { schedules, createSchedule, toggleSchedule, deleteSchedule };
}

function loadSchedules(): WorkflowSchedule[] {
  const saved = window.localStorage.getItem(storageKey);
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWorkflowSchedule);
  } catch {
    window.localStorage.removeItem(storageKey);
    return [];
  }
}

function isWorkflowSchedule(value: unknown): value is WorkflowSchedule {
  if (!value || typeof value !== "object") return false;
  const schedule = value as Partial<WorkflowSchedule>;
  return typeof schedule.id === "string"
    && typeof schedule.workflowId === "string"
    && typeof schedule.workflowName === "string"
    && typeof schedule.scheduledAt === "string"
    && (schedule.frequency === "once" || schedule.frequency === "daily" || schedule.frequency === "weekly");
}
