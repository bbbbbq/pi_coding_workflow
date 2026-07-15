import { randomUUID } from "node:crypto";
import {
  AuthStorage,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai/compat";
import {
  anthropicMessagesApi,
  googleGenerativeAIApi,
  openAICompletionsApi,
} from "@earendil-works/pi-ai/compat";
import type {
  ModelProvider,
  ModelRoute,
  ModelRouteCandidate,
  ModelRouteDecision,
  ModelRouteDecisionAttempt,
  ModelRouteStrategy,
  ModelRoutingConfig,
  ProviderModel,
} from "@pi-workflow/contracts";
import { validateModelProvider, validateModelRoute } from "@pi-workflow/contracts";

export interface ModelSelection {
  provider: ModelProvider;
  model: ProviderModel;
  candidate: ModelRouteCandidate;
  piModel: Model<any>;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
}

export interface ModelRouteRequest {
  routeId?: string;
  providerId?: string;
  modelId?: string;
  requestId?: string;
}

export interface ModelRouteExecutionResult<Result> {
  result: Result;
  decision: ModelRouteDecision;
}

export type ModelSecretResolver = (secretRef: string) => Promise<string | undefined>;

export interface ModelRouterOptions {
  secretResolver?: ModelSecretResolver;
  now?: () => string;
}

export type ModelRoutingErrorCode =
  | "invalid_provider"
  | "invalid_route"
  | "route_disabled"
  | "provider_disabled"
  | "model_disabled"
  | "secret_missing"
  | "model_unavailable"
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "provider_error"
  | "network_error";

export class ModelRoutingError extends Error {
  readonly code: ModelRoutingErrorCode;
  readonly statusCode?: number;
  readonly decision?: ModelRouteDecision;

  constructor(
    code: ModelRoutingErrorCode,
    message: string,
    options: { statusCode?: number; decision?: ModelRouteDecision } = {},
  ) {
    super(message);
    this.name = "ModelRoutingError";
    this.code = code;
    this.statusCode = options.statusCode;
    this.decision = options.decision;
  }
}

export { validateModelProvider, validateModelRoute } from "@pi-workflow/contracts";

export function createEnvironmentSecretResolver(): ModelSecretResolver {
  return async (secretRef) => {
    const key = `PI_WORKFLOW_SECRET_${secretRef.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
    return process.env[key];
  };
}

export class ModelRouter {
  private readonly secretResolver: ModelSecretResolver;
  private readonly now: () => string;
  private weightedCursor = 0;

  constructor(
    private readonly config: ModelRoutingConfig,
    options: ModelRouterOptions = {},
  ) {
    if (config.providers.some((provider) => validateModelProvider(provider).length > 0)) {
      throw new ModelRoutingError("invalid_provider", "Model provider configuration is invalid.");
    }
    if (config.routes.some((route) => validateModelRoute(route, config).length > 0)) {
      throw new ModelRoutingError("invalid_route", "Model route configuration is invalid.");
    }
    this.secretResolver = options.secretResolver ?? createEnvironmentSecretResolver();
    this.now = options.now ?? (() => new Date().toISOString());
  }

  resolve(request: ModelRouteRequest): ModelSelection {
    const candidates = this.resolveCandidates(request);
    const candidate = candidates[0];
    if (!candidate) {
      throw new ModelRoutingError("model_unavailable", "No enabled model is available for this route.");
    }
    return this.createSelection(candidate);
  }

  async execute<Result>(
    request: ModelRouteRequest,
    action: (selection: ModelSelection) => Promise<Result>,
  ): Promise<ModelRouteExecutionResult<Result>> {
    const requestId = request.requestId ?? randomUUID();
    const { candidates, strategy, routeId } = this.resolveCandidatePlan(request);
    const decision: ModelRouteDecision = {
      requestId,
      routeId,
      strategy,
      attempts: [],
      createdAt: this.now(),
    };

    for (const candidate of candidates) {
      const provider = this.config.providers.find((item) => item.id === candidate.providerId);
      const model = provider?.models.find((item) => item.modelId === candidate.modelId);
      if (!provider || !model) continue;
      const maxAttempts = Math.min(Math.max(candidate.maxRetries, 0) + 1, 11);

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const startedAt = Date.now();
        try {
          const selection = await this.createSelectionAsync(candidate, provider, model);
          decision.selectedProviderId = provider.id;
          decision.selectedModelId = model.modelId;
          const result = await action(selection);
          decision.attempts.push({
            providerId: provider.id,
            modelId: model.modelId,
            attempt,
            outcome: "success",
            durationMs: Date.now() - startedAt,
          });
          return { result, decision };
        } catch (error) {
          const classification = classifyModelError(error);
          const attemptRecord: ModelRouteDecisionAttempt = {
            providerId: provider.id,
            modelId: model.modelId,
            attempt,
            outcome: classification.retryable ? "retryable_failure" : "fatal_failure",
            errorCode: classification.code,
            statusCode: classification.statusCode,
            durationMs: Date.now() - startedAt,
          };
          decision.attempts.push(attemptRecord);
          if (!classification.retryable) {
            throw new ModelRoutingError(classification.code, classification.message, {
              statusCode: classification.statusCode,
              decision,
            });
          }
        }
      }
    }

    throw new ModelRoutingError(
      "model_unavailable",
      "All enabled models failed after their configured retry limits.",
      { decision },
    );
  }

  private resolveCandidates(request: ModelRouteRequest): ModelRouteCandidate[] {
    return this.resolveCandidatePlan(request).candidates;
  }

  private resolveCandidatePlan(request: ModelRouteRequest): {
    candidates: ModelRouteCandidate[];
    strategy: ModelRouteStrategy | "direct";
    routeId?: string;
  } {
    const providers = new Map(this.config.providers.map((provider) => [provider.id, provider]));
    if (request.providerId || request.modelId) {
      if (!request.providerId || !request.modelId) {
        throw new ModelRoutingError("invalid_provider", "Both providerId and modelId are required for direct selection.");
      }
      const provider = providers.get(request.providerId);
      if (!provider) throw new ModelRoutingError("invalid_provider", "The selected provider does not exist.");
      if (!provider.enabled) throw new ModelRoutingError("provider_disabled", "The selected provider is disabled.");
      const model = provider.models.find((item) => item.modelId === request.modelId);
      if (!model) throw new ModelRoutingError("model_unavailable", "The selected model does not exist.");
      if (!model.enabled) throw new ModelRoutingError("model_disabled", "The selected model is disabled.");
      return {
        candidates: [{ id: `direct-${provider.id}-${model.modelId}`, providerId: provider.id, modelId: model.modelId, priority: 0, weight: 1, maxRetries: 0, enabled: true }],
        strategy: "direct",
      };
    }

    if (!request.routeId) throw new ModelRoutingError("invalid_route", "A routeId or direct provider/model selection is required.");
    const route = this.config.routes.find((item) => item.id === request.routeId);
    if (!route) throw new ModelRoutingError("invalid_route", "The selected model route does not exist.");
    if (!route.enabled) throw new ModelRoutingError("route_disabled", "The selected model route is disabled.");
    const available = route.candidates.filter((candidate) => {
      const provider = providers.get(candidate.providerId);
      const model = provider?.models.find((item) => item.modelId === candidate.modelId);
      return candidate.enabled && provider?.enabled === true && model?.enabled === true;
    });
    if (available.length === 0) throw new ModelRoutingError("model_unavailable", "The route has no enabled provider models.");
    const candidates = route.strategy === "priority-fallback"
      ? [...available].sort((a, b) => a.priority - b.priority)
      : this.weightedOrder(available);
    return { candidates, strategy: route.strategy, routeId: route.id };
  }

  private weightedOrder(candidates: ModelRouteCandidate[]): ModelRouteCandidate[] {
    const expanded = candidates.flatMap((candidate) => Array.from({ length: Math.min(candidate.weight, 100) }, () => candidate));
    const start = this.weightedCursor % expanded.length;
    this.weightedCursor += 1;
    const result: ModelRouteCandidate[] = [];
    const seen = new Set<string>();
    for (let offset = 0; offset < expanded.length && result.length < candidates.length; offset += 1) {
      const candidate = expanded[(start + offset) % expanded.length];
      if (!seen.has(candidate.id)) {
        seen.add(candidate.id);
        result.push(candidate);
      }
    }
    return result;
  }

  private createSelection(candidate: ModelRouteCandidate): ModelSelection {
    const provider = this.config.providers.find((item) => item.id === candidate.providerId);
    const model = provider?.models.find((item) => item.modelId === candidate.modelId);
    if (!provider || !model) throw new ModelRoutingError("model_unavailable", "The selected provider model is unavailable.");
    const authStorage = AuthStorage.inMemory();
    return {
      provider,
      model,
      candidate,
      piModel: undefined as unknown as Model<any>,
      authStorage,
      modelRegistry: ModelRegistry.inMemory(authStorage),
    };
  }

  private async createSelectionAsync(
    candidate: ModelRouteCandidate,
    provider: ModelProvider,
    model: ProviderModel,
  ): Promise<ModelSelection> {
    const secret = await this.secretResolver(provider.secretRef);
    if (!secret) throw new ModelRoutingError("secret_missing", "The provider credential is not available.");
    const authStorage = AuthStorage.inMemory();
    authStorage.set(provider.id, { type: "api_key", key: secret });
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    modelRegistry.registerProvider(provider.id, {
      api: apiForProvider(provider),
      apiKey: secret,
      baseUrl: provider.baseUrl,
      headers: provider.customHeaders,
      streamSimple: (registeredModel, context, options) => providerStream(provider)(registeredModel, context, {
        ...options,
        headers: { ...provider.customHeaders, ...options?.headers },
        maxRetries: 0,
        timeoutMs: provider.timeoutMs,
      }),
      models: [toPiModel(provider, model)],
    });
    const piModel = modelRegistry.find(provider.id, model.modelId);
    if (!piModel) throw new ModelRoutingError("model_unavailable", "The provider model could not be registered with Pi.");
    return { provider, model, candidate, piModel, authStorage, modelRegistry };
  }
}

function providerStream(provider: ModelProvider) {
  if (provider.type === "anthropic") return anthropicMessagesApi().streamSimple;
  if (provider.type === "google-gemini") return googleGenerativeAIApi().streamSimple;
  return openAICompletionsApi().streamSimple;
}

function apiForProvider(provider: ModelProvider): "openai-completions" | "anthropic-messages" | "google-generative-ai" {
  if (provider.type === "anthropic") return "anthropic-messages";
  if (provider.type === "google-gemini") return "google-generative-ai";
  return "openai-completions";
}

function toPiModel(provider: ModelProvider, model: ProviderModel): {
  id: string;
  name: string;
  api: "openai-completions" | "anthropic-messages" | "google-generative-ai";
  baseUrl: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
} {
  return {
    id: model.modelId,
    name: model.displayName,
    api: apiForProvider(provider),
    baseUrl: provider.baseUrl,
    reasoning: false,
    input: model.supportsVision ? ["text", "image"] : ["text"],
    cost: {
      input: model.inputPricePerMillion ?? 0,
      output: model.outputPricePerMillion ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: model.contextLength,
    maxTokens: Math.min(model.contextLength, 32768),
  };
}

function classifyModelError(error: unknown): {
  retryable: boolean;
  code: ModelRoutingErrorCode;
  statusCode?: number;
  message: string;
} {
  if (error instanceof ModelRoutingError) {
    return {
      retryable: error.code === "network_error" || error.code === "rate_limited" || error.code === "provider_error",
      code: error.code,
      statusCode: error.statusCode,
      message: error.message,
    };
  }
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    name?: unknown;
    message?: unknown;
    cause?: { code?: unknown };
  } | undefined;
  const statusCode = typeof candidate?.statusCode === "number"
    ? candidate.statusCode
    : typeof candidate?.status === "number"
      ? candidate.status
      : undefined;
  if (statusCode === 400) return { retryable: false, code: "bad_request", statusCode, message: "The provider rejected the request (400)." };
  if (statusCode === 401) return { retryable: false, code: "unauthorized", statusCode, message: "The provider rejected the credential (401)." };
  if (statusCode === 403) return { retryable: false, code: "forbidden", statusCode, message: "The provider denied access (403)." };
  if (statusCode === 429) return { retryable: true, code: "rate_limited", statusCode, message: "The provider rate limited the request." };
  if (statusCode !== undefined && statusCode >= 500) return { retryable: true, code: "provider_error", statusCode, message: "The provider returned a server error." };
  const codeValue = candidate?.code ?? candidate?.cause?.code;
  const code = typeof codeValue === "string" ? codeValue.toUpperCase() : "";
  const name = typeof candidate?.name === "string" ? candidate.name.toLowerCase() : "";
  const message = typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";
  if (
    ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code)
    || name.includes("timeout")
    || name === "aborterror"
    || error instanceof TypeError
    || ["network", "fetch failed", "socket", "connection reset"].some((value) => message.includes(value))
  ) {
    return { retryable: true, code: "network_error", message: "The provider request timed out or could not connect." };
  }
  return { retryable: false, code: "provider_error", message: "The provider request failed." };
}
