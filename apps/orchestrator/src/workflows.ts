import {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type {
  ApprovalDecision,
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
  retry: { maximumAttempts: 2 },
});

export const approvePlanSignal = defineSignal<[ApprovalDecision]>("approvePlan");

export async function codingWorkflow(
  input: CodingWorkflowInput,
): Promise<CodingWorkflowResult> {
  const workspace = await prepareWorkspace(input);
  let approval: ApprovalDecision | undefined;
  let latestSessionId: string | undefined;

  setHandler(approvePlanSignal, (decision) => {
    approval = decision;
  });

  try {
    const plan = await analyzeWithPi(workspace, input);
    latestSessionId = plan.piSessionId;

    if (input.requirePlanApproval !== false) {
      await condition(() => approval !== undefined);
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
      const codingResult = await implementWithPi(workspace, input, attempt);
      latestSessionId = codingResult.piSessionId;
      const validation = await validateWorkspace(workspace);

      if (validation.passed) {
        return {
          taskId: input.taskId,
          status: "completed",
          attempts: attempt,
          piSessionId: latestSessionId,
          validation,
        };
      }
    }

    return {
      taskId: input.taskId,
      status: "failed",
      attempts: maxAttempts,
      piSessionId: latestSessionId,
    };
  } finally {
    await cleanupWorkspace(workspace);
  }
}
