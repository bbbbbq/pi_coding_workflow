import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ModelRoutingConfig, ModelRouteDecision } from "@pi-workflow/contracts";
import {
  ModelRouter,
  type ModelSecretResolver,
} from "./model-router.js";

export * from "./model-router.js";

export interface PiCodingRunInput {
  cwd: string;
  prompt: string;
  mode: "analyze" | "plan" | "implement" | "repair" | "review";
  tools?: string[];
  maxTurns?: number;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  persistSession?: boolean;
  continueSession?: boolean;
  modelRouting?: ModelRoutingConfig;
  routeId?: string;
  providerId?: string;
  modelId?: string;
}

export interface PiCodingRunResult {
  status: "completed";
  sessionId: string;
  messageCount: number;
  output: string;
  routeDecision?: ModelRouteDecision;
}

export class PiCodingExecutor {
  private routedConfigKey?: string;
  private routedModelRouter?: ModelRouter;

  constructor(private readonly secretResolver?: ModelSecretResolver) {}

  async run(input: PiCodingRunInput): Promise<PiCodingRunResult> {
    if (input.modelRouting && (input.routeId || input.providerId || input.modelId)) {
      const configKey = JSON.stringify(input.modelRouting);
      if (configKey !== this.routedConfigKey || !this.routedModelRouter) {
        this.routedConfigKey = configKey;
        this.routedModelRouter = new ModelRouter(input.modelRouting, { secretResolver: this.secretResolver });
      }
      const router = this.routedModelRouter;
      const routed = await router.execute(
        {
          routeId: input.routeId,
          providerId: input.providerId,
          modelId: input.modelId,
        },
        (selection) => this.runWithModel(input, selection),
      );
      return { ...routed.result, routeDecision: routed.decision };
    }

    return this.runWithModel(input);
  }

  private async runWithModel(
    input: PiCodingRunInput,
    selection?: Parameters<Parameters<ModelRouter["execute"]>[1]>[0],
  ): Promise<PiCodingRunResult> {
    const sessionManager = input.persistSession === false
      ? SessionManager.inMemory(input.cwd)
      : input.continueSession
        ? SessionManager.continueRecent(input.cwd)
        : SessionManager.create(input.cwd);

    const sessionOptions = selection
      ? {
          model: selection.piModel,
          authStorage: selection.authStorage,
          modelRegistry: selection.modelRegistry,
        }
      : {};
    const readOnlyMode = input.mode === "analyze" || input.mode === "plan" || input.mode === "review";
    const result = await createAgentSession({
      cwd: input.cwd,
      sessionManager,
      tools: input.tools?.length ? input.tools : readOnlyMode ? ["read", "grep", "find", "ls"] : undefined,
      ...sessionOptions,
    });
    const session = result.session;
    const maxTurns = Math.max(1, input.maxTurns ?? 20);
    let turnCount = 0;
    let turnLimitReached = false;
    let timedOut = false;
    const unsubscribe = session.subscribe((event) => {
      if (event.type !== "turn_end") return;
      turnCount += 1;
      if (
        turnCount >= maxTurns
        && event.message.role === "assistant"
        && event.message.stopReason === "toolUse"
      ) {
        turnLimitReached = true;
        session.agent.abort();
      }
    });
    const abort = () => {
      void session.abort().catch(() => undefined);
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    const timeout = input.timeoutSeconds && input.timeoutSeconds > 0
      ? setTimeout(() => {
          timedOut = true;
          abort();
        }, input.timeoutSeconds * 1_000)
      : undefined;

    try {
      await session.prompt(input.prompt);
      if (input.signal?.aborted) throw new PiCodingAbortError("Pi coding run was cancelled.");
      if (timedOut) throw new PiCodingAbortError(`Pi coding run timed out after ${input.timeoutSeconds} seconds.`);
      if (turnLimitReached) throw new Error(`Pi coding run exceeded the ${maxTurns} turn limit.`);
      const lastAssistant = [...session.messages].reverse().find((message) => message.role === "assistant");
      if (lastAssistant?.role === "assistant" && lastAssistant.stopReason === "error") {
        throw new Error(lastAssistant.errorMessage ?? "Pi coding run failed.");
      }
      return {
        status: "completed",
        sessionId: session.sessionId,
        messageCount: session.messages.length,
        output: assistantText(lastAssistant),
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      unsubscribe();
      session.dispose();
    }
  }
}

export class PiCodingAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiCodingAbortError";
  }
}

function assistantText(message: unknown): string {
  if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "assistant") return "";
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((item) => (
    item && typeof item === "object"
      && (item as { type?: unknown }).type === "text"
      && typeof (item as { text?: unknown }).text === "string"
      ? [(item as { text: string }).text]
      : []
  )).join("\n");
}
