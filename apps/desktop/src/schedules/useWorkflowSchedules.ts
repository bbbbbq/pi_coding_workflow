import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ModelRoutingConfig,
  WorkflowSchedule,
  WorkflowScheduleFrequency,
} from "@pi-workflow/contracts";
import {
  deleteScheduleRecord,
  listSchedules,
  saveSchedule,
} from "../storage/repository";
import {
  describeTemporalSchedule,
  deleteTemporalSchedule,
  pauseTemporalSchedule,
  registerTemporalSchedule,
  resumeTemporalSchedule,
} from "../temporal/client";

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

export function useWorkflowSchedules(routing?: {
  modelRouting: ModelRoutingConfig;
  routeId?: string;
  providerId?: string;
  modelId?: string;
}) {
  const [schedules, setSchedules] = useState<WorkflowSchedule[]>([]);
  const schedulesRef = useRef(schedules);

  const replaceSchedules = useCallback((next: WorkflowSchedule[]) => {
    schedulesRef.current = next;
    setSchedules(next);
  }, []);

  const refreshTemporalSchedules = useCallback(async () => {
    const current = schedulesRef.current;
    const remoteSchedules = await Promise.allSettled(current.map(async (schedule) => {
      if (!schedule.temporalScheduleId) return schedule;
      const remote = await describeTemporalSchedule(schedule.temporalScheduleId);
      return {
        ...schedule,
        enabled: !remote.paused && remote.remainingActions !== 0,
        nextRunAt: remote.nextRunAt,
        lastRunAt: remote.lastRunAt ?? schedule.lastRunAt,
      };
    }));
    const changed: WorkflowSchedule[] = [];
    const next = remoteSchedules.map((result, index) => {
      if (result.status === "rejected") {
        reportScheduleStorageError(result.reason);
        return current[index];
      }
      const previous = current[index];
      const refreshed = result.value;
      if (
        previous.enabled !== refreshed.enabled
        || previous.nextRunAt !== refreshed.nextRunAt
        || previous.lastRunAt !== refreshed.lastRunAt
      ) changed.push(refreshed);
      return refreshed;
    });
    if (changed.length === 0) return;
    replaceSchedules(next);
    await Promise.all(changed.map((schedule) => saveSchedule(schedule)))
      .catch(reportScheduleStorageError);
  }, [replaceSchedules]);

  useEffect(() => {
    let cancelled = false;
    void listSchedules().then((savedSchedules) => {
      if (!cancelled) {
        replaceSchedules(savedSchedules);
        void refreshTemporalSchedules();
      }
    }).catch(reportScheduleStorageError);
    return () => {
      cancelled = true;
    };
  }, [refreshTemporalSchedules, replaceSchedules]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshTemporalSchedules();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshTemporalSchedules]);

  const createSchedule = useCallback(async (input: CreateWorkflowScheduleInput): Promise<boolean> => {
    const now = new Date();
    const scheduledAt = new Date(input.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt <= now) return false;

    let schedule: WorkflowSchedule = {
      id: `schedule-${crypto.randomUUID()}`,
      ...input,
      nextRunAt: scheduledAt.toISOString(),
      enabled: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    try {
      const remote = await registerTemporalSchedule({
        schedule,
        modelRouting: routing?.modelRouting,
        routeId: routing?.routeId,
        providerId: routing?.providerId,
        modelId: routing?.modelId,
      });
      schedule = {
        ...schedule,
        temporalScheduleId: remote.scheduleId,
        enabled: !remote.paused && remote.remainingActions !== 0,
        nextRunAt: remote.nextRunAt ?? schedule.nextRunAt,
        lastRunAt: remote.lastRunAt,
      };
    } catch (error) {
      reportScheduleStorageError(error);
      return false;
    }
    replaceSchedules([schedule, ...schedulesRef.current]);
    await saveSchedule(schedule).catch(reportScheduleStorageError);
    return true;
  }, [replaceSchedules, routing]);

  const toggleSchedule = useCallback(async (scheduleId: string): Promise<void> => {
    const current = schedulesRef.current.find((schedule) => schedule.id === scheduleId);
    if (!current?.temporalScheduleId) return;
    try {
      const remote = current.enabled
        ? await pauseTemporalSchedule(current.temporalScheduleId)
        : await resumeTemporalSchedule(current.temporalScheduleId);
      const updatedSchedule: WorkflowSchedule = {
        ...current,
        enabled: !remote.paused && remote.remainingActions !== 0,
        nextRunAt: remote.nextRunAt,
        lastRunAt: remote.lastRunAt ?? current.lastRunAt,
        updatedAt: new Date().toISOString(),
      };
      replaceSchedules(schedulesRef.current.map((schedule) => (
        schedule.id === scheduleId ? updatedSchedule : schedule
      )));
      await saveSchedule(updatedSchedule).catch(reportScheduleStorageError);
    } catch (error) {
      reportScheduleStorageError(error);
    }
  }, [replaceSchedules]);

  const deleteSchedule = useCallback(async (scheduleId: string): Promise<void> => {
    const schedule = schedulesRef.current.find((item) => item.id === scheduleId);
    try {
      if (schedule?.temporalScheduleId) await deleteTemporalSchedule(schedule.temporalScheduleId);
      replaceSchedules(schedulesRef.current.filter((item) => item.id !== scheduleId));
      await deleteScheduleRecord(scheduleId).catch(reportScheduleStorageError);
    } catch (error) {
      reportScheduleStorageError(error);
    }
  }, [replaceSchedules]);

  return { schedules, createSchedule, toggleSchedule, deleteSchedule };
}

function reportScheduleStorageError(error: unknown): void {
  console.error("Failed to persist Temporal workflow schedule", error);
}
