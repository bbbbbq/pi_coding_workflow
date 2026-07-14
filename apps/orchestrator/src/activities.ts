import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import type {
  CodingAttemptResult,
  CodingPlan,
  CodingWorkflowInput,
  ValidationResult,
  WorkspaceRef,
} from "@pi-workflow/contracts";
import { PiCodingExecutor } from "@pi-workflow/pi-adapter";

const execFileAsync = promisify(execFile);
const pi = new PiCodingExecutor();

export async function prepareWorkspace(
  input: CodingWorkflowInput,
): Promise<WorkspaceRef> {
  const workspace = await stat(input.repositoryPath);
  if (!workspace.isDirectory()) {
    throw new Error(`Repository path is not a directory: ${input.repositoryPath}`);
  }

  return {
    id: randomUUID(),
    path: input.repositoryPath,
  };
}

export async function analyzeWithPi(
  workspace: WorkspaceRef,
  input: CodingWorkflowInput,
): Promise<CodingPlan> {
  const result = await pi.run({
    cwd: workspace.path,
    mode: "analyze",
    persistSession: true,
    prompt: [
      "Analyze the requested coding task without modifying files.",
      "Return a concise implementation plan, risks, and validation strategy.",
      `Task: ${input.task}`,
    ].join("\n\n"),
  });

  return {
    summary: "Pi analysis session completed. The transcript is the initial plan artifact.",
    piSessionId: result.sessionId,
  };
}

export async function implementWithPi(
  workspace: WorkspaceRef,
  input: CodingWorkflowInput,
  attempt: number,
): Promise<CodingAttemptResult> {
  const result = await pi.run({
    cwd: workspace.path,
    mode: "implement",
    persistSession: true,
    prompt: [
      `Implement the coding task. This is attempt ${attempt}.`,
      "Keep the change focused. Inspect the repository before editing.",
      "Run relevant validation commands and report any remaining failures.",
      `Task: ${input.task}`,
    ].join("\n\n"),
  });

  return {
    status: "completed",
    piSessionId: result.sessionId,
    messageCount: result.messageCount,
    attempt,
  };
}

export async function validateWorkspace(
  workspace: WorkspaceRef,
): Promise<ValidationResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["diff", "--check"], {
      cwd: workspace.path,
    });

    return {
      passed: true,
      checks: [{ name: "git diff --check", passed: true, output: stdout || stderr }],
    };
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error);
    return {
      passed: false,
      checks: [{ name: "git diff --check", passed: false, output }],
    };
  }
}

export async function cleanupWorkspace(_workspace: WorkspaceRef): Promise<void> {
  // The first scaffold operates on an existing local repository. Worktree and
  // sandbox cleanup will be implemented when isolated execution is added.
}
