import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRoutingConfig } from "@pi-workflow/contracts";
import { ModelRoutingService } from "./model-routing-service.js";

const config: ModelRoutingConfig = {
  providers: [{
    id: "provider-a",
    name: "Provider A",
    type: "openai-compatible",
    baseUrl: "https://models.example.test/v1",
    secretRef: "provider-a",
    customHeaders: {},
    timeoutMs: 5_000,
    enabled: true,
    models: [{
      id: "provider-a:model-a",
      providerId: "provider-a",
      modelId: "model-a",
      displayName: "Model A",
      contextLength: 32_000,
      supportsTools: true,
      supportsVision: false,
      supportsStructuredOutput: true,
      enabled: true,
    }],
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  }],
  routes: [{
    id: "coding-default",
    name: "Coding default",
    strategy: "priority-fallback",
    enabled: true,
    candidates: [{
      id: "candidate-a",
      providerId: "provider-a",
      modelId: "model-a",
      priority: 0,
      weight: 1,
      maxRetries: 1,
      enabled: true,
    }],
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  }],
};

test("lists providers and resolves configured routes without exposing credentials", () => {
  const service = new ModelRoutingService(config);
  assert.equal(service.listProviders()[0].secretRef, "provider-a");
  assert.deepEqual(service.resolveRoute("coding-default"), {
    routeId: "coding-default",
    providerId: "provider-a",
    modelId: "model-a",
  });
});

test("provider test reports a missing Orchestrator credential before network access", async () => {
  delete process.env.PI_WORKFLOW_SECRET_PROVIDER_A;
  const service = new ModelRoutingService(config);
  const health = await service.testProvider("provider-a");
  assert.equal(health.status, "unavailable");
  assert.equal(health.errorCode, "secret_missing");
});
