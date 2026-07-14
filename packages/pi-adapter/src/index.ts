import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

export interface PiCodingRunInput {
  cwd: string;
  prompt: string;
  mode: "analyze" | "implement";
  persistSession?: boolean;
}

export interface PiCodingRunResult {
  status: "completed";
  sessionId: string;
  messageCount: number;
}

export class PiCodingExecutor {
  async run(input: PiCodingRunInput): Promise<PiCodingRunResult> {
    const sessionManager = input.persistSession === false
      ? SessionManager.inMemory(input.cwd)
      : SessionManager.create(input.cwd);

    const result = input.mode === "analyze"
      ? await createAgentSession({
          cwd: input.cwd,
          sessionManager,
          tools: ["read", "grep", "find", "ls"],
        })
      : await createAgentSession({
          cwd: input.cwd,
          sessionManager,
        });

    await result.session.prompt(input.prompt);

    return {
      status: "completed",
      sessionId: result.session.sessionId,
      messageCount: result.session.messages.length,
    };
  }
}
