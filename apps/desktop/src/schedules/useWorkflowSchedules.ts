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
import {
  deleteScheduleRecord,
  listSchedules,
  saveSchedule,
} from "../storage/repository";

export interface CreateWorkflowScheduleInput {
  name: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
  frequency: WorkflowScheduleFrequency;
  scheduledAt: string;
  timeZone: string;
}
export function useWorkflowSchedules(
  onDue: (schedule: WorkflowSchedule) => void,
) {
  const [schedules, setSchedules] = useState<WorkflowSchedule[]>([]);
  const schedulesRef = useRef(schedules);
  const onDueRef = useRef(onDue);
  onDueRef.current = onDue;

  const replaceSchedules = useCallback((next: WorkflowSchedule[]) => {
    schedulesRef.current = next;
    setSchedules(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listSchedules().then((savedSchedules) => {
      if (!cancelled) replaceSchedules(savedSchedules);
    }).catch(reportScheduleStorageError);
    return () => {
      cancelled = true;
    };
  }, [replaceSchedules]);

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
      const next = schedulesRef.current.map((schedule) => (
        dueIds.has(schedule.id) ? advanceWorkflowSchedule(schedule, now) : schedule
      ));
      replaceSchedules(next);
      next.filter((schedule) => dueIds.has(schedule.id)).forEach((schedule) => {
        void saveSchedule(schedule).catch(reportScheduleStorageError);
      });
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
    void saveSchedule(schedule).catch(reportScheduleStorageError);
    return true;
  }, [replaceSchedules]);

  const toggleSchedule = useCallback((scheduleId: string) => {
    const now = new Date();
    let updatedSchedule: WorkflowSchedule | undefined;
    const next = schedulesRef.current.map((schedule) => {
      if (schedule.id !== scheduleId) return schedule;
      if (schedule.enabled) {
        updatedSchedule = { ...schedule, enabled: false, updatedAt: now.toISOString() };
        return updatedSchedule;
      }

      const nextRunAt = calculateNextRunAt({
        frequency: schedule.frequency,
        scheduledAt: schedule.scheduledAt,
        after: now,
        hasRun: schedule.frequency === "once" && Boolean(schedule.lastRunAt),
      });
      if (!nextRunAt) return schedule;
      updatedSchedule = { ...schedule, enabled: true, nextRunAt, updatedAt: now.toISOString() };
      return updatedSchedule;
    });
    replaceSchedules(next);
    if (updatedSchedule) void saveSchedule(updatedSchedule).catch(reportScheduleStorageError);
  }, [replaceSchedules]);

  const deleteSchedule = useCallback((scheduleId: string) => {
    replaceSchedules(schedulesRef.current.filter((schedule) => schedule.id !== scheduleId));
    void deleteScheduleRecord(scheduleId).catch(reportScheduleStorageError);
  }, [replaceSchedules]);

  return { schedules, createSchedule, toggleSchedule, deleteSchedule };
}

function reportScheduleStorageError(error: unknown): void {
  console.error("Failed to persist workflow schedule", error);
}
