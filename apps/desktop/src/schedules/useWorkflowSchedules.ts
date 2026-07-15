import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WorkflowSchedule,
  WorkflowScheduleFrequency,
} from "@pi-workflow/contracts";
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
  repositoryPath: string;
  task: string;
  frequency: WorkflowScheduleFrequency;
  scheduledAt: string;
  timeZone: string;
}

export function useWorkflowSchedules() {
  const [schedules, setSchedules] = useState<WorkflowSchedule[]>([]);
  const schedulesRef = useRef(schedules);

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

  const createSchedule = useCallback(async (input: CreateWorkflowScheduleInput): Promise<boolean> => {
    const now = new Date();
    const scheduledAt = new Date(input.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt <= now) return false;

    const schedule: WorkflowSchedule = {
      id: `schedule-${crypto.randomUUID()}`,
      ...input,
      nextRunAt: scheduledAt.toISOString(),
      enabled: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    replaceSchedules([schedule, ...schedulesRef.current]);
    await saveSchedule(schedule).catch(reportScheduleStorageError);
    return true;
  }, [replaceSchedules]);

  const toggleSchedule = useCallback(async (scheduleId: string): Promise<void> => {
    const current = schedulesRef.current.find((schedule) => schedule.id === scheduleId);
    if (!current) return;
    const updatedSchedule: WorkflowSchedule = {
      ...current,
      enabled: !current.enabled,
      updatedAt: new Date().toISOString(),
    };
    replaceSchedules(schedulesRef.current.map((schedule) => (
      schedule.id === scheduleId ? updatedSchedule : schedule
    )));
    await saveSchedule(updatedSchedule).catch(reportScheduleStorageError);
  }, [replaceSchedules]);

  const deleteSchedule = useCallback(async (scheduleId: string): Promise<void> => {
    replaceSchedules(schedulesRef.current.filter((item) => item.id !== scheduleId));
    await deleteScheduleRecord(scheduleId).catch(reportScheduleStorageError);
  }, [replaceSchedules]);

  return { schedules, createSchedule, toggleSchedule, deleteSchedule };
}

function reportScheduleStorageError(error: unknown): void {
  console.error("Failed to persist local workflow schedule", error);
}
