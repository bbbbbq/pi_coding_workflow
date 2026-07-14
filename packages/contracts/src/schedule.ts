export const workflowScheduleFrequencies = ["once", "daily", "weekly"] as const;

export type WorkflowScheduleFrequency = (typeof workflowScheduleFrequencies)[number];

export interface WorkflowSchedule {
  id: string;
  name: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
  repositoryPath: string;
  task: string;
  frequency: WorkflowScheduleFrequency;
  scheduledAt: string;
  nextRunAt?: string;
  lastRunAt?: string;
  temporalScheduleId?: string;
  timeZone: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
