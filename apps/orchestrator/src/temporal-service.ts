import {
  Client,
  Connection,
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
  WorkflowExecutionAlreadyStartedError,
  type ScheduleOptions,
} from "@temporalio/client";
import type {
  ApprovalDecision,
  CodingWorkflowInput,
  RegisterTemporalScheduleRequest,
  StartTemporalRunRequest,
  TemporalHealth,
  TemporalRunRef,
  TemporalScheduleRef,
  WorkflowSchedule,
} from "@pi-workflow/contracts";
import type { OrchestratorConfig } from "./config.js";
import { buildScheduleSpec, temporalScheduleId } from "./schedules.js";

export class TemporalService {
  private constructor(
    private readonly connection: Connection,
    private readonly client: Client,
    private readonly config: OrchestratorConfig,
  ) {}

  static async connect(config: OrchestratorConfig): Promise<TemporalService> {
    const connection = await Connection.connect({ address: config.temporalAddress });
    const client = new Client({ connection, namespace: config.temporalNamespace });
    return new TemporalService(connection, client, config);
  }

  async close(): Promise<void> {
    await this.connection.close();
  }

  async health(): Promise<TemporalHealth> {
    await this.connection.ensureConnected();
    return {
      status: "ok",
      namespace: this.config.temporalNamespace,
      taskQueue: this.config.taskQueue,
    };
  }

  async startRun(request: StartTemporalRunRequest): Promise<TemporalRunRef> {
    const workflowId = `pi-run-${request.runId}`;
    const input: CodingWorkflowInput = {
      taskId: request.runId,
      repositoryPath: request.repositoryPath,
      task: request.task,
      maxAttempts: request.maxAttempts,
      requirePlanApproval: request.requirePlanApproval,
    };
    try {
      const handle = await this.client.workflow.start("codingWorkflow", {
        taskQueue: this.config.taskQueue,
        workflowId,
        args: [input],
        retry: workflowRetryPolicy,
        memo: {
          appWorkflowId: request.workflowId,
          appWorkflowVersion: request.workflowVersion,
          appRunId: request.runId,
        },
      });
      return { workflowId, runId: handle.firstExecutionRunId };
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
      const existing = await this.client.workflow.getHandle(workflowId).describe();
      return { workflowId, runId: existing.runId };
    }
  }

  async registerSchedule(request: RegisterTemporalScheduleRequest): Promise<TemporalScheduleRef> {
    const scheduleId = temporalScheduleId(request.schedule);
    const options = scheduleOptions(scheduleId, request, this.config.taskQueue);
    const handle = this.client.schedule.getHandle(scheduleId);

    try {
      await this.client.schedule.create(options);
    } catch (error) {
      if (!(error instanceof ScheduleAlreadyRunning)) throw error;
      await handle.update(() => ({
        spec: options.spec,
        action: options.action,
        policies: options.policies,
        state: options.state ?? {},
      }));
    }

    return this.describeSchedule(scheduleId);
  }

  async describeSchedule(scheduleId: string): Promise<TemporalScheduleRef> {
    const description = await this.client.schedule.getHandle(scheduleId).describe();
    const latest = description.info.recentActions.at(-1);
    return {
      scheduleId,
      paused: description.state.paused,
      nextRunAt: description.info.nextActionTimes[0]?.toISOString(),
      lastRunAt: latest?.takenAt.toISOString(),
      remainingActions: description.state.remainingActions,
    };
  }

  async pauseSchedule(scheduleId: string): Promise<TemporalScheduleRef> {
    const handle = this.client.schedule.getHandle(scheduleId);
    await handle.pause("Paused from Pi Workflow desktop");
    return this.describeSchedule(scheduleId);
  }

  async resumeSchedule(scheduleId: string): Promise<TemporalScheduleRef> {
    const handle = this.client.schedule.getHandle(scheduleId);
    await handle.unpause("Resumed from Pi Workflow desktop");
    return this.describeSchedule(scheduleId);
  }

  async triggerSchedule(scheduleId: string): Promise<TemporalScheduleRef> {
    const handle = this.client.schedule.getHandle(scheduleId);
    await handle.trigger(ScheduleOverlapPolicy.BUFFER_ONE);
    return this.describeSchedule(scheduleId);
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    try {
      await this.client.schedule.getHandle(scheduleId).delete();
    } catch (error) {
      if (!(error instanceof ScheduleNotFoundError)) throw error;
    }
  }

  async pauseRun(workflowId: string): Promise<void> {
    await this.client.workflow.getHandle(workflowId).signal("pauseWorkflow");
  }

  async resumeRun(workflowId: string): Promise<void> {
    await this.client.workflow.getHandle(workflowId).signal("resumeWorkflow");
  }

  async cancelRun(workflowId: string): Promise<void> {
    await this.client.workflow.getHandle(workflowId).cancel();
  }

  async approveRun(workflowId: string, decision: ApprovalDecision): Promise<void> {
    await this.client.workflow.getHandle(workflowId).signal("approvePlan", decision);
  }
}

const workflowRetryPolicy = {
  initialInterval: "5 seconds",
  backoffCoefficient: 2,
  maximumInterval: "1 minute",
  maximumAttempts: 3,
} as const;

function scheduleOptions(
  scheduleId: string,
  request: RegisterTemporalScheduleRequest,
  taskQueue: string,
): ScheduleOptions {
  const { schedule } = request;
  const input: CodingWorkflowInput = {
    taskId: schedule.id,
    repositoryPath: schedule.repositoryPath,
    task: schedule.task,
    maxAttempts: request.maxAttempts,
    requirePlanApproval: request.requirePlanApproval ?? false,
  };

  return {
    scheduleId,
    spec: buildScheduleSpec(schedule),
    action: {
      type: "startWorkflow",
      workflowType: "codingWorkflow",
      taskQueue,
      args: [input],
      workflowId: `${scheduleId}-workflow`,
      retry: workflowRetryPolicy,
      memo: scheduleMemo(schedule),
    },
    policies: {
      overlap: ScheduleOverlapPolicy.BUFFER_ONE,
      catchupWindow: "24 hours",
      pauseOnFailure: true,
    },
    state: {
      paused: !schedule.enabled,
      note: schedule.enabled ? "Managed by Pi Workflow" : "Paused from Pi Workflow desktop",
      remainingActions: schedule.frequency === "once" ? 1 : undefined,
    },
    memo: scheduleMemo(schedule),
  };
}

function scheduleMemo(schedule: WorkflowSchedule): Record<string, unknown> {
  return {
    appScheduleId: schedule.id,
    appWorkflowId: schedule.workflowId,
    appWorkflowVersion: schedule.workflowVersion,
    scheduleName: schedule.name,
  };
}
