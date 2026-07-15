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
  mode: "analyze" | "implement";
  persistSession?: boolean;
  modelRouting?: ModelRoutingConfig;
  routeId?: string;
  providerId?: string;
  modelId?: string;
}

export interface PiCodingRunResult {
  status: "completed";
  sessionId: string;
  messageCount: number;
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
      : SessionManager.create(input.cwd);

    const sessionOptions = selection
      ? {
          model: selection.piModel,
          authStorage: selection.authStorage,
          modelRegistry: selection.modelRegistry,
        }
      : {};
    const result = input.mode === "analyze"
      ? await createAgentSession({
          cwd: input.cwd,
          sessionManager,
          tools: ["read", "grep", "find", "ls"],
          ...sessionOptions,
        })
      : await createAgentSession({
          cwd: input.cwd,
          sessionManager,
          ...sessionOptions,
        });

    await result.session.prompt(input.prompt);

    return {
      status: "completed",
      sessionId: result.session.sessionId,
      messageCount: result.session.messages.length,
    };
  }
}
