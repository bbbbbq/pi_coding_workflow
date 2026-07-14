import {
  CancellationScope,
  condition,
  defineSignal,
  defineQuery,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type {
  ApprovalDecision,
  CodingRunPhase,
  CodingWorkflowInput,
  CodingWorkflowResult,
} from "@pi-workflow/contracts";
import type * as activities from "./activities.js";

const {
  prepareWorkspace,
  analyzeWithPi,
  implementWithPi,
  validateWorkspace,
  cleanupWorkspace,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  retry: {
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
    maximumAttempts: 3,
  },
});

export const approvePlanSignal = defineSignal<[ApprovalDecision]>("approvePlan");
export const pauseWorkflowSignal = defineSignal("pauseWorkflow");
export const resumeWorkflowSignal = defineSignal("resumeWorkflow");
export const runStateQuery = defineQuery<CodingRunState>("runState");

export interface CodingRunState {
  phase: CodingRunPhase;
  attempt: number;
  paused: boolean;
}

export async function codingWorkflow(
  input: CodingWorkflowInput,
): Promise<CodingWorkflowResult> {
  let state: CodingRunState = { phase: "preparing", attempt: 0, paused: false };
  let workspace: Awaited<ReturnType<typeof prepareWorkspace>> | undefined;
  let approval: ApprovalDecision | undefined;
  let latestSessionId: string | undefined;

  setHandler(approvePlanSignal, (decision) => {
    approval = decision;
  });
  setHandler(pauseWorkflowSignal, () => {
    state = { ...state, paused: true };
  });
  setHandler(resumeWorkflowSignal, () => {
    state = { ...state, paused: false };
  });
  setHandler(runStateQuery, () => state);

  try {
    await waitUntilResumed();
    state = { ...state, phase: "preparing" };
    workspace = await prepareWorkspace(input);

    await waitUntilResumed();
    state = { ...state, phase: "planning" };
    const plan = await analyzeWithPi(workspace, input);
    latestSessionId = plan.piSessionId;

    if (input.requirePlanApproval !== false) {
      state = { ...state, phase: "waiting_for_approval" };
      await condition(() => approval !== undefined && !state.paused);
      if (!approval?.approved) {
        return {
          taskId: input.taskId,
          status: "rejected",
          attempts: 0,
          piSessionId: latestSessionId,
        };
      }
    }

    const maxAttempts = input.maxAttempts ?? 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await waitUntilResumed();
      state = { ...state, phase: "implementing", attempt };
      const codingResult = await implementWithPi(workspace, input, attempt);
      latestSessionId = codingResult.piSessionId;
      state = { ...state, phase: "validating", attempt };
      const validation = await validateWorkspace(workspace);

      if (validation.passed) {
        state = { ...state, phase: "completed", attempt };
        return {
          taskId: input.taskId,
          status: "completed",
          attempts: attempt,
          piSessionId: latestSessionId,
          validation,
        };
      }
    }

    state = { ...state, phase: "failed", attempt: maxAttempts };
    return {
      taskId: input.taskId,
      status: "failed",
      attempts: maxAttempts,
      piSessionId: latestSessionId,
    };
  } finally {
    if (workspace) {
      await CancellationScope.nonCancellable(() => cleanupWorkspace(workspace!));
    }
  }

  async function waitUntilResumed(): Promise<void> {
    await condition(() => !state.paused);
  }
}
