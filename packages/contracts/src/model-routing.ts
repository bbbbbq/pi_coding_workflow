export const modelProviderTypes = [
  "openai-compatible",
  "anthropic",
  "google-gemini",
  "custom",
] as const;

export type ModelProviderType = (typeof modelProviderTypes)[number];

export const modelRouteStrategies = [
  "priority-fallback",
  "weighted-round-robin",
] as const;

export type ModelRouteStrategy = (typeof modelRouteStrategies)[number];

export type ProviderHealthStatus = "unknown" | "healthy" | "degraded" | "unavailable";

export interface ProviderModel {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  contextLength: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  enabled: boolean;
}

export interface ModelProvider {
  id: string;
  name: string;
  type: ModelProviderType;
  baseUrl: string;
  /** Only a reference is persisted here. The credential value is keychain-only. */
  secretRef: string;
  customHeaders: Record<string, string>;
  timeoutMs: number;
  enabled: boolean;
  models: ProviderModel[];
  createdAt: string;
  updatedAt: string;
}

export interface ModelRouteCandidate {
  id: string;
  providerId: string;
  modelId: string;
  priority: number;
  weight: number;
  maxRetries: number;
  enabled: boolean;
}

export interface ModelRoute {
  id: string;
  name: string;
  strategy: ModelRouteStrategy;
  enabled: boolean;
  candidates: ModelRouteCandidate[];
  createdAt: string;
  updatedAt: string;
}

export interface ModelRoutingConfig {
  providers: ModelProvider[];
  routes: ModelRoute[];
}

export interface ModelRouteDecisionAttempt {
  providerId: string;
  modelId: string;
  attempt: number;
  outcome: "selected" | "success" | "retryable_failure" | "fatal_failure";
  errorCode?: string;
  statusCode?: number;
  durationMs?: number;
}

export interface ModelRouteDecision {
  requestId: string;
  routeId?: string;
  strategy: ModelRouteStrategy | "direct";
  selectedProviderId?: string;
  selectedModelId?: string;
  attempts: ModelRouteDecisionAttempt[];
  createdAt: string;
}

export interface ProviderHealth {
  providerId: string;
  status: ProviderHealthStatus;
  checkedAt: string;
  latencyMs?: number;
  statusCode?: number;
  errorCode?: string;
  message?: string;
}

export function isValidModelBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateModelProvider(provider: ModelProvider): string[] {
  const issues: string[] = [];
  if (!provider.id.trim()) issues.push("provider_id_required");
  if (!provider.name.trim()) issues.push("provider_name_required");
  if (!isValidModelBaseUrl(provider.baseUrl)) issues.push("provider_base_url_invalid");
  if (!provider.secretRef.trim()) issues.push("provider_secret_ref_required");
  for (const headerName of Object.keys(provider.customHeaders)) {
    if (["authorization", "proxy-authorization", "api-key", "x-api-key"].includes(headerName.toLowerCase())) {
      issues.push("provider_sensitive_header");
    }
  }
  if (!Number.isInteger(provider.timeoutMs) || provider.timeoutMs < 1000 || provider.timeoutMs > 120000) {
    issues.push("provider_timeout_invalid");
  }
  const modelIds = new Set<string>();
  for (const model of provider.models) {
    if (!model.modelId.trim()) issues.push("model_id_required");
    if (modelIds.has(model.modelId)) issues.push("duplicate_model_id");
    modelIds.add(model.modelId);
    if (!Number.isInteger(model.contextLength) || model.contextLength < 1) issues.push("model_context_invalid");
  }
  return issues;
}

export function validateModelRoute(route: ModelRoute, config: ModelRoutingConfig): string[] {
  const issues: string[] = [];
  if (!route.id.trim()) issues.push("route_id_required");
  if (!route.name.trim()) issues.push("route_name_required");
  if (!route.enabled) return issues;
  const providers = new Map(config.providers.map((provider) => [provider.id, provider]));
  if (route.candidates.filter((candidate) => candidate.enabled).length === 0) {
    issues.push("route_candidate_required");
  }
  for (const candidate of route.candidates) {
    if (!Number.isInteger(candidate.priority) || candidate.priority < 0) issues.push("candidate_priority_invalid");
    if (!Number.isInteger(candidate.weight) || candidate.weight < 1 || candidate.weight > 100) issues.push("candidate_weight_invalid");
    if (!Number.isInteger(candidate.maxRetries) || candidate.maxRetries < 0 || candidate.maxRetries > 10) {
      issues.push("candidate_retries_invalid");
    }
    const provider = providers.get(candidate.providerId);
    if (!provider) {
      issues.push("candidate_provider_missing");
    } else if (!provider.models.some((model) => model.modelId === candidate.modelId)) {
      issues.push("candidate_model_missing");
    }
  }
  return issues;
}
