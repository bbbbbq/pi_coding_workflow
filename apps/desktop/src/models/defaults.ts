import type { ModelProvider, ModelRoute } from "@pi-workflow/contracts";

export function createModelProvider(type: ModelProvider["type"] = "openai-compatible"): ModelProvider {
  const now = new Date().toISOString();
  const id = `provider-${crypto.randomUUID().slice(0, 8)}`;
  const modelId = type === "anthropic" ? "claude-sonnet-4-20250514" : type === "google-gemini" ? "gemini-2.5-pro" : "gpt-4o-mini";
  return {
    id,
    name: "New provider",
    type,
    baseUrl: type === "anthropic"
      ? "https://api.anthropic.com"
      : type === "google-gemini"
        ? "https://generativelanguage.googleapis.com"
        : "https://api.openai.com/v1",
    secretRef: `keychain:${id}`,
    customHeaders: {},
    timeoutMs: 30_000,
    enabled: true,
    models: [{
      id: `${id}-model`,
      providerId: id,
      modelId,
      displayName: modelId,
      contextLength: 128_000,
      supportsTools: true,
      supportsVision: true,
      supportsStructuredOutput: true,
      enabled: true,
    }],
    createdAt: now,
    updatedAt: now,
  };
}

export function createModelRoute(providers: ModelProvider[] = []): ModelRoute {
  const now = new Date().toISOString();
  const model = providers.find((provider) => provider.enabled && provider.models.some((item) => item.enabled));
  const selectedModel = model?.models.find((item) => item.enabled);
  return {
    id: "coding-default",
    name: "Coding default",
    strategy: "priority-fallback",
    enabled: true,
    candidates: model && selectedModel ? [{
      id: `candidate-${crypto.randomUUID().slice(0, 8)}`,
      providerId: model.id,
      modelId: selectedModel.modelId,
      priority: 1,
      weight: 1,
      maxRetries: 1,
      enabled: true,
    }] : [],
    createdAt: now,
    updatedAt: now,
  };
}
