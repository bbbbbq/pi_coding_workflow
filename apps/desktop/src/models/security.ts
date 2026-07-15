import { invoke } from "@tauri-apps/api/core";
import type { ModelProvider, ProviderHealth } from "@pi-workflow/contracts";

export async function storeModelSecret(secretRef: string, secret: string): Promise<void> {
  await invoke("store_model_secret", { request: { secretRef, secret } });
}

export async function deleteModelSecret(secretRef: string): Promise<void> {
  await invoke("delete_model_secret", { secretRef });
}

export async function hasModelSecret(secretRef: string): Promise<boolean> {
  return invoke<boolean>("has_model_secret", { secretRef });
}

export async function testModelProvider(provider: ModelProvider): Promise<ProviderHealth> {
  return invoke<ProviderHealth>("test_model_provider", {
    provider: {
      id: provider.id,
      type: provider.type,
      baseUrl: provider.baseUrl,
      secretRef: provider.secretRef,
      customHeaders: provider.customHeaders,
      timeoutMs: provider.timeoutMs,
    },
  });
}
