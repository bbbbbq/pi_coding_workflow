import { readFileSync } from "node:fs";
import type {
  ModelProvider,
  ModelRoute,
  ModelRoutingConfig,
  ProviderHealth,
} from "@pi-workflow/contracts";
import {
  ModelRouter,
  createEnvironmentSecretResolver,
} from "@pi-workflow/pi-adapter";

const emptyConfig: ModelRoutingConfig = { providers: [], routes: [] };

export class ModelRoutingService {
  private readonly router: ModelRouter;

  constructor(private readonly config: ModelRoutingConfig) {
    this.router = new ModelRouter(config);
  }

  static load(filePath?: string): ModelRoutingService {
    if (!filePath) return new ModelRoutingService(emptyConfig);
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as ModelRoutingConfig;
    if (!Array.isArray(parsed.providers) || !Array.isArray(parsed.routes)) {
      throw new Error("PI_WORKFLOW_MODEL_ROUTING_FILE must contain providers and routes arrays.");
    }
    return new ModelRoutingService(parsed);
  }

  listProviders(): ModelProvider[] {
    return structuredClone(this.config.providers);
  }

  listRoutes(): ModelRoute[] {
    return structuredClone(this.config.routes);
  }

  resolveRoute(routeId: string): { routeId: string; providerId: string; modelId: string } {
    const selection = this.router.resolve({ routeId });
    return {
      routeId,
      providerId: selection.provider.id,
      modelId: selection.model.modelId,
    };
  }

  async testProvider(providerId: string): Promise<ProviderHealth> {
    const provider = this.config.providers.find((candidate) => candidate.id === providerId);
    if (!provider) throw new Error(`Provider '${providerId}' was not found.`);
    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    const secret = await createEnvironmentSecretResolver()(provider.secretRef);
    if (!secret) {
      return {
        providerId,
        status: "unavailable",
        checkedAt,
        latencyMs: Date.now() - startedAt,
        errorCode: "secret_missing",
        message: "The provider credential is not available to the Orchestrator.",
      };
    }

    const headers = new Headers(provider.customHeaders);
    let url = providerEndpoint(provider);
    if (provider.type === "anthropic") {
      headers.set("x-api-key", secret);
      headers.set("anthropic-version", "2023-06-01");
    } else if (provider.type === "google-gemini") {
      const parsed = new URL(url);
      parsed.searchParams.set("key", secret);
      url = parsed.toString();
    } else {
      headers.set("authorization", `Bearer ${secret}`);
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(provider.timeoutMs),
      });
      return {
        providerId,
        status: response.ok ? "healthy" : "unavailable",
        checkedAt,
        latencyMs: Date.now() - startedAt,
        statusCode: response.status,
        errorCode: response.ok ? undefined : "provider_http_error",
        message: response.ok ? undefined : `Provider returned HTTP ${response.status}.`,
      };
    } catch (error) {
      return {
        providerId,
        status: "unavailable",
        checkedAt,
        latencyMs: Date.now() - startedAt,
        errorCode: error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network_error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function providerEndpoint(provider: ModelProvider): string {
  const base = provider.baseUrl.replace(/\/$/, "");
  if (provider.type === "anthropic") return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
  if (provider.type === "google-gemini") return base.endsWith("/v1beta") ? `${base}/models` : `${base}/v1beta/models`;
  return `${base}/models`;
}
