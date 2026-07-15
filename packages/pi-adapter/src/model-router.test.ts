import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ModelProvider,
  ModelRoute,
  ModelRoutingConfig,
  ProviderModel,
} from "@pi-workflow/contracts";
import {
  ModelRouter,
  ModelRoutingError,
  validateModelProvider,
} from "./model-router.js";

const providerModel = (providerId: string, modelId: string, enabled = true): ProviderModel => ({
  id: `${providerId}-${modelId}`,
  providerId,
  modelId,
  displayName: modelId,
  contextLength: 32_000,
  supportsTools: true,
  supportsVision: false,
  supportsStructuredOutput: true,
  enabled,
});

const provider = (id: string, enabled = true, modelEnabled = true): ModelProvider => ({
  id,
  name: id,
  type: "openai-compatible",
  baseUrl: "https://example.test/v1",
  secretRef: `keychain:${id}`,
  customHeaders: {},
  timeoutMs: 10_000,
  enabled,
  models: [providerModel(id, "model-a", modelEnabled)],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const route = (strategy: ModelRoute["strategy"], candidates: ModelRoute["candidates"]): ModelRoute => ({
  id: "coding-default",
  name: "Coding default",
  strategy,
  enabled: true,
  candidates,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

function config(routeConfig: ModelRoute, providers: ModelProvider[] = [provider("primary"), provider("backup")]): ModelRoutingConfig {
  return { providers, routes: [routeConfig] };
}

test("validates provider base URL and timeout without accepting secrets", () => {
  const invalid = { ...provider("primary"), baseUrl: "not-a-url", timeoutMs: 0, customHeaders: { Authorization: "secret-value" } };
  const issues = validateModelProvider(invalid);
  assert.ok(issues.includes("provider_base_url_invalid"));
  assert.ok(issues.includes("provider_timeout_invalid"));
  assert.ok(issues.includes("provider_sensitive_header"));
  assert.equal("apiKey" in invalid, false);
  assert.equal(JSON.stringify(invalid).includes("apiKey"), false);
});

test("priority fallback moves to the next model after a retryable failure", async () => {
  const router = new ModelRouter(config(route("priority-fallback", [
    { id: "primary-candidate", providerId: "primary", modelId: "model-a", priority: 1, weight: 1, maxRetries: 0, enabled: true },
    { id: "backup-candidate", providerId: "backup", modelId: "model-a", priority: 2, weight: 1, maxRetries: 0, enabled: true },
  ])), { secretResolver: async () => "secret-value" });
  let calls = 0;
  const result = await router.execute({ routeId: "coding-default", requestId: "req-1" }, async (selection) => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("server unavailable"), { status: 503 });
    return selection.provider.id;
  });

  assert.equal(result.result, "backup");
  assert.deepEqual(result.decision.attempts.map((attempt) => attempt.outcome), ["retryable_failure", "success"]);
  assert.equal(JSON.stringify(result.decision).includes("secret-value"), false);
});

test("timeout, 429 and 5xx failures trigger fallback", async () => {
  const failures = [
    Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
    Object.assign(new Error("rate limited"), { statusCode: 429 }),
    Object.assign(new Error("upstream failed"), { statusCode: 502 }),
  ];
  for (const failure of failures) {
    const router = new ModelRouter(config(route("priority-fallback", [
      { id: "primary-candidate", providerId: "primary", modelId: "model-a", priority: 1, weight: 1, maxRetries: 0, enabled: true },
      { id: "backup-candidate", providerId: "backup", modelId: "model-a", priority: 2, weight: 1, maxRetries: 0, enabled: true },
    ])), { secretResolver: async () => "secret-value" });
    let calls = 0;
    const result = await router.execute({ routeId: "coding-default" }, async (selection) => {
      calls += 1;
      if (calls === 1) throw failure;
      return selection.provider.id;
    });
    assert.equal(result.result, "backup");
    assert.equal(result.decision.attempts.length, 2);
  }
});

test("weighted round robin distributes the first four selections by weight", () => {
  const router = new ModelRouter(config(route("weighted-round-robin", [
    { id: "primary-candidate", providerId: "primary", modelId: "model-a", priority: 1, weight: 3, maxRetries: 0, enabled: true },
    { id: "backup-candidate", providerId: "backup", modelId: "model-a", priority: 1, weight: 1, maxRetries: 0, enabled: true },
  ])));
  const selected = Array.from({ length: 4 }, () => router.resolve({ routeId: "coding-default" }).provider.id);
  assert.deepEqual(selected, ["primary", "primary", "primary", "backup"]);
});

test("400, 401 and 403 are reported as fatal errors without fallback", async () => {
  for (const status of [400, 401, 403]) {
    const router = new ModelRouter(config(route("priority-fallback", [
      { id: "primary-candidate", providerId: "primary", modelId: "model-a", priority: 1, weight: 1, maxRetries: 3, enabled: true },
      { id: "backup-candidate", providerId: "backup", modelId: "model-a", priority: 2, weight: 1, maxRetries: 0, enabled: true },
    ])), { secretResolver: async () => "secret-value" });
    await assert.rejects(
      router.execute({ routeId: "coding-default" }, async () => {
        throw Object.assign(new Error("provider error"), { status });
      }),
      (error: unknown) => error instanceof ModelRoutingError && error.statusCode === status && error.decision?.attempts.length === 1,
    );
  }
});

test("disabled providers and models are never selected", () => {
  const disabledProviderConfig = config(route("priority-fallback", [
    { id: "disabled-provider", providerId: "primary", modelId: "model-a", priority: 1, weight: 1, maxRetries: 0, enabled: true },
  ]), [provider("primary", false)]);
  assert.throws(() => new ModelRouter(disabledProviderConfig).resolve({ routeId: "coding-default" }), /no enabled provider models/i);

  const disabledModelConfig = config(route("priority-fallback", [
    { id: "disabled-model", providerId: "primary", modelId: "model-a", priority: 1, weight: 1, maxRetries: 0, enabled: true },
  ]), [provider("primary", true, false)]);
  assert.throws(() => new ModelRouter(disabledModelConfig).resolve({ routeId: "coding-default" }), /no enabled provider models/i);
});

test("configuration survives JSON persistence without embedding an API key", () => {
  const original = config(route("priority-fallback", [
    { id: "primary-candidate", providerId: "primary", modelId: "model-a", priority: 1, weight: 1, maxRetries: 1, enabled: true },
  ]), [provider("primary")]);
  const serialized = JSON.stringify(original);
  const restored = JSON.parse(serialized) as ModelRoutingConfig;
  assert.deepEqual(restored, original);
  assert.equal(serialized.includes("apiKey"), false);
  assert.equal(restored.providers[0].secretRef, "keychain:primary");
});
