import { useEffect, useMemo, useState } from "react";
import type {
  ModelProvider,
  ModelRoute,
  ModelRouteCandidate,
  ProviderHealth,
  ProviderModel,
} from "@pi-workflow/contracts";
import { validateModelProvider, validateModelRoute } from "@pi-workflow/contracts";
import { Check, ChevronRight, CircleAlert, Plus, Save, Server, ShieldCheck, Trash2, Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  deleteModelProvider,
  deleteModelRoute,
  saveModelProvider,
  saveModelRoute,
} from "../storage/repository";
import {
  deleteModelSecret,
  hasModelSecret,
  storeModelSecret,
  testModelProvider,
} from "./security";
import { createModelProvider, createModelRoute } from "./defaults";
import "./modelRouting.css";

interface ModelRoutingManagerProps {
  providers: ModelProvider[];
  routes: ModelRoute[];
  onProvidersChange: (providers: ModelProvider[]) => void;
  onRoutesChange: (routes: ModelRoute[]) => void;
}

export function ModelRoutingManager({
  providers,
  routes,
  onProvidersChange,
  onRoutesChange,
}: ModelRoutingManagerProps) {
  const { t } = useTranslation();
  const [selectedProviderId, setSelectedProviderId] = useState(providers[0]?.id);
  const [selectedRouteId, setSelectedRouteId] = useState(routes[0]?.id);
  const [secretDraft, setSecretDraft] = useState("");
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [headersText, setHeadersText] = useState("{}");
  const [providerStatus, setProviderStatus] = useState<ProviderHealth>();
  const [message, setMessage] = useState<string>();
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const selectedRoute = routes.find((route) => route.id === selectedRouteId);

  useEffect(() => {
    if (!selectedProvider) {
      setSelectedProviderId(providers[0]?.id);
      return;
    }
    setHeadersText(JSON.stringify(selectedProvider.customHeaders, null, 2));
    setSecretDraft("");
    setProviderStatus(undefined);
    void hasModelSecret(selectedProvider.secretRef)
      .then(setSecretConfigured)
      .catch(() => setSecretConfigured(false));
  }, [selectedProviderId]);

  useEffect(() => {
    if (!selectedRoute) setSelectedRouteId(routes[0]?.id);
  }, [selectedRoute, routes]);

  const routeIssues = useMemo(
    () => selectedRoute ? validateModelRoute(selectedRoute, { providers, routes }) : [],
    [providers, routes, selectedRoute],
  );

  function updateProvider(patch: Partial<ModelProvider>) {
    if (!selectedProvider) return;
    onProvidersChange(providers.map((provider) => provider.id === selectedProvider.id
      ? { ...provider, ...patch, updatedAt: new Date().toISOString() }
      : provider));
  }

  function updateModel(modelId: string, patch: Partial<ProviderModel>) {
    if (!selectedProvider) return;
    updateProvider({
      models: selectedProvider.models.map((model) => model.id === modelId ? { ...model, ...patch } : model),
    });
  }

  async function saveProvider() {
    if (!selectedProvider) return;
    let customHeaders: Record<string, string>;
    try {
      const parsed = JSON.parse(headersText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("headers");
      customHeaders = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
    } catch {
      setMessage(t("models.messages.headersInvalid"));
      return;
    }
    const saved = { ...selectedProvider, customHeaders, updatedAt: new Date().toISOString() };
    onProvidersChange(providers.map((provider) => provider.id === saved.id ? saved : provider));
    if (validateModelProvider(saved).length > 0) {
      setMessage(t("models.messages.providerInvalid"));
      return;
    }
    await saveModelProvider(saved);
    if (secretDraft.trim()) {
      await storeModelSecret(saved.secretRef, secretDraft.trim());
      setSecretConfigured(true);
      setSecretDraft("");
    }
    setMessage(t("models.messages.saved"));
  }

  async function removeProvider() {
    if (!selectedProvider) return;
    await deleteModelProvider(selectedProvider.id);
    await deleteModelSecret(selectedProvider.secretRef).catch(() => undefined);
    onProvidersChange(providers.filter((provider) => provider.id !== selectedProvider.id));
    const updatedRoutes = routes.map((route) => ({
      ...route,
      candidates: route.candidates.filter((candidate) => candidate.providerId !== selectedProvider.id),
    }));
    onRoutesChange(updatedRoutes);
    await Promise.all(updatedRoutes.filter((route, index) => route.candidates.length !== routes[index].candidates.length).map(saveModelRoute));
    setMessage(t("models.messages.deleted"));
  }

  async function testProvider() {
    if (!selectedProvider) return;
    setProviderStatus(undefined);
    try {
      const health = await testModelProvider(selectedProvider);
      setProviderStatus(health);
      setMessage(health.status === "healthy" ? t("models.messages.connectionHealthy") : health.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("models.messages.connectionFailed"));
    }
  }

  function addProvider() {
    const next = createModelProvider();
    onProvidersChange([...providers, next]);
    setSelectedProviderId(next.id);
  }

  async function saveRoute() {
    if (!selectedRoute) return;
    if (routeIssues.length > 0) {
      setMessage(t("models.messages.routeInvalid"));
      return;
    }
    await saveModelRoute(selectedRoute);
    setMessage(t("models.messages.saved"));
  }

  function addRoute() {
    const base = createModelRoute(providers);
    const id = routes.some((route) => route.id === base.id) ? `route-${crypto.randomUUID().slice(0, 8)}` : base.id;
    const next = { ...base, id, name: id };
    onRoutesChange([...routes, next]);
    setSelectedRouteId(next.id);
  }

  async function removeRoute() {
    if (!selectedRoute) return;
    await deleteModelRoute(selectedRoute.id);
    onRoutesChange(routes.filter((route) => route.id !== selectedRoute.id));
    setMessage(t("models.messages.deleted"));
  }

  function updateRoute(patch: Partial<ModelRoute>) {
    if (!selectedRoute) return;
    onRoutesChange(routes.map((route) => route.id === selectedRoute.id
      ? { ...route, ...patch, updatedAt: new Date().toISOString() }
      : route));
  }

  function updateRouteId(id: string) {
    if (!selectedRoute || !id.trim()) return;
    onRoutesChange(routes.map((route) => route.id === selectedRoute.id ? { ...route, id, updatedAt: new Date().toISOString() } : route));
    setSelectedRouteId(id);
  }

  function updateCandidate(candidateId: string, patch: Partial<ModelRouteCandidate>) {
    if (!selectedRoute) return;
    updateRoute({
      candidates: selectedRoute.candidates.map((candidate) => candidate.id === candidateId ? { ...candidate, ...patch } : candidate),
    });
  }

  function addCandidate() {
    if (!selectedRoute) return;
    const firstProvider = providers.find((provider) => provider.enabled && provider.models.some((model) => model.enabled));
    const firstModel = firstProvider?.models.find((model) => model.enabled);
    if (!firstProvider || !firstModel) {
      setMessage(t("models.messages.noCandidateModel"));
      return;
    }
    updateRoute({
      candidates: [...selectedRoute.candidates, {
        id: `candidate-${crypto.randomUUID().slice(0, 8)}`,
        providerId: firstProvider.id,
        modelId: firstModel.modelId,
        priority: selectedRoute.candidates.length + 1,
        weight: 1,
        maxRetries: 1,
        enabled: true,
      }],
    });
  }

  return (
    <section className="model-routing-page">
      <header className="model-page-heading">
        <div>
          <p className="section-index">{t("models.index")}</p>
          <h2>{t("models.title")}</h2>
          <p>{t("models.subtitle")}</p>
        </div>
        <div className="model-page-stats">
          <span><Server size={15} /> {providers.length} {t("models.providerCount")}</span>
          <span><Wifi size={15} /> {routes.filter((route) => route.enabled).length} {t("models.activeRoutes")}</span>
        </div>
      </header>

      <div className="model-routing-grid">
        <section className="model-panel provider-panel">
          <div className="model-panel-header">
            <div><p className="section-index">{t("models.providers.index")}</p><h3>{t("models.providers.title")}</h3></div>
            <button className="icon-button" onClick={addProvider} title={t("models.actions.addProvider")} type="button"><Plus size={16} /></button>
          </div>
          <div className="provider-list">
            {providers.length === 0 && <p className="model-empty">{t("models.providers.empty")}</p>}
            {providers.map((provider) => (
              <button
                className={`provider-list-item ${provider.id === selectedProviderId ? "is-selected" : ""}`}
                key={provider.id}
                onClick={() => setSelectedProviderId(provider.id)}
                type="button"
              >
                <span className={`provider-status ${provider.enabled ? "is-on" : ""}`} />
                <span><strong>{provider.name || t("models.providers.unnamed")}</strong><small>{provider.type} · {provider.models.length} {t("models.models")}</small></span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        </section>

        <section className="model-panel provider-editor">
          {selectedProvider ? (
            <>
              <div className="model-panel-header"><div><p className="section-index">{t("models.providers.editorIndex")}</p><h3>{selectedProvider.name || t("models.providers.unnamed")}</h3></div><button className="danger-icon-button" onClick={() => void removeProvider()} title={t("models.actions.deleteProvider")} type="button"><Trash2 size={16} /></button></div>
              <div className="model-form-grid">
                <label><span>{t("models.fields.providerName")}</span><input value={selectedProvider.name} onChange={(event) => updateProvider({ name: event.target.value })} /></label>
                <label><span>{t("models.fields.providerType")}</span><select value={selectedProvider.type} onChange={(event) => updateProvider({ type: event.target.value as ModelProvider["type"] })}><option value="openai-compatible">OpenAI Compatible</option><option value="anthropic">Anthropic</option><option value="google-gemini">Google Gemini</option><option value="custom">{t("models.providerTypes.custom")}</option></select></label>
                <label className="field-wide"><span>{t("models.fields.baseUrl")}</span><input value={selectedProvider.baseUrl} onChange={(event) => updateProvider({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label>
                <label><span>{t("models.fields.timeout")}</span><input min={1000} max={120000} type="number" value={selectedProvider.timeoutMs} onChange={(event) => updateProvider({ timeoutMs: Number(event.target.value) })} /></label>
                <label><span>{t("models.fields.apiKey")}</span><input type="password" value={secretDraft} onChange={(event) => setSecretDraft(event.target.value)} placeholder={secretConfigured ? "••••••••  " + t("models.fields.keyConfigured") : t("models.fields.keyPlaceholder")} autoComplete="new-password" /></label>
                <label className="toggle-field"><span>{t("models.fields.enabled")}</span><input checked={selectedProvider.enabled} onChange={(event) => updateProvider({ enabled: event.target.checked })} type="checkbox" /></label>
                <label className="field-wide"><span>{t("models.fields.headers")}</span><textarea rows={3} value={headersText} onChange={(event) => setHeadersText(event.target.value)} /></label>
              </div>
              <div className="model-editor-actions"><button className="secondary-button" onClick={() => void testProvider()} type="button"><Wifi size={15} /> {t("models.actions.testConnection")}</button><button className="primary-button" onClick={() => void saveProvider()} type="button"><Save size={15} /> {t("models.actions.saveProvider")}</button>{providerStatus && <span className={`health-message ${providerStatus.status === "healthy" ? "is-healthy" : ""}`}>{providerStatus.status === "healthy" ? <Check size={14} /> : <CircleAlert size={14} />} {providerStatus.message ?? t(`models.health.${providerStatus.status}`)}</span>}</div>
              <div className="models-subsection"><div className="subsection-heading"><div><p className="section-index">{t("models.providerModels.index")}</p><h4>{t("models.providerModels.title")}</h4></div><button className="icon-button" onClick={() => updateProvider({ models: [...selectedProvider.models, { id: `${selectedProvider.id}-${crypto.randomUUID().slice(0, 6)}`, providerId: selectedProvider.id, modelId: "", displayName: "", contextLength: 128000, supportsTools: true, supportsVision: false, supportsStructuredOutput: true, enabled: true }] })} title={t("models.actions.addModel")} type="button"><Plus size={15} /></button></div>
                <div className="model-table">{selectedProvider.models.map((model) => <ModelRow key={model.id} model={model} onChange={(patch) => updateModel(model.id, patch)} onDelete={() => updateProvider({ models: selectedProvider.models.filter((item) => item.id !== model.id) })} t={t} />)}</div></div>
            </>
          ) : <div className="model-empty large"><ShieldCheck size={23} /><h3>{t("models.providers.emptyTitle")}</h3><p>{t("models.providers.emptyDescription")}</p><button className="primary-button" onClick={addProvider} type="button"><Plus size={15} /> {t("models.actions.addProvider")}</button></div>}
        </section>
      </div>

      <section className="model-panel routes-panel">
        <div className="model-panel-header"><div><p className="section-index">{t("models.routes.index")}</p><h3>{t("models.routes.title")}</h3></div><button className="secondary-button" onClick={addRoute} type="button"><Plus size={15} /> {t("models.actions.addRoute")}</button></div>
        <div className="routes-layout">
          <div className="route-list">{routes.length === 0 && <p className="model-empty">{t("models.routes.empty")}</p>}{routes.map((route) => <button className={`route-list-item ${route.id === selectedRouteId ? "is-selected" : ""}`} key={route.id} onClick={() => setSelectedRouteId(route.id)} type="button"><span className={`provider-status ${route.enabled ? "is-on" : ""}`} /><span><strong>{route.name || route.id}</strong><small>{t(`models.strategies.${route.strategy}`)} · {route.candidates.length} {t("models.candidates")}</small></span><ChevronRight size={15} /></button>)}</div>
          {selectedRoute ? <div className="route-editor"><div className="route-form-row"><label><span>{t("models.fields.routeId")}</span><input value={selectedRoute.id} onChange={(event) => updateRouteId(event.target.value)} /></label><label><span>{t("models.fields.routeName")}</span><input value={selectedRoute.name} onChange={(event) => updateRoute({ name: event.target.value })} /></label><label><span>{t("models.fields.strategy")}</span><select value={selectedRoute.strategy} onChange={(event) => updateRoute({ strategy: event.target.value as ModelRoute["strategy"] })}><option value="priority-fallback">{t("models.strategies.priority-fallback")}</option><option value="weighted-round-robin">{t("models.strategies.weighted-round-robin")}</option></select></label><label className="toggle-field"><span>{t("models.fields.enabled")}</span><input checked={selectedRoute.enabled} onChange={(event) => updateRoute({ enabled: event.target.checked })} type="checkbox" /></label></div><div className="candidate-heading"><span>{t("models.fields.candidate")}</span><button className="text-button" onClick={addCandidate} type="button"><Plus size={14} /> {t("models.actions.addCandidate")}</button></div><div className="candidate-list">{selectedRoute.candidates.map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} providers={providers} onChange={(patch) => updateCandidate(candidate.id, patch)} onDelete={() => updateRoute({ candidates: selectedRoute.candidates.filter((item) => item.id !== candidate.id) })} t={t} />)}</div><div className="route-footer"><div className={`validation-summary ${routeIssues.length === 0 ? "is-valid" : ""}`}>{routeIssues.length === 0 ? <><Check size={14} /> {t("models.validation.valid")}</> : <><CircleAlert size={14} /> {t("models.validation.issues", { count: routeIssues.length })}</>}</div><button className="danger-text-button" onClick={() => void removeRoute()} type="button"><Trash2 size={14} /> {t("models.actions.deleteRoute")}</button><button className="primary-button" disabled={routeIssues.length > 0} onClick={() => void saveRoute()} type="button"><Save size={15} /> {t("models.actions.saveRoute")}</button></div></div> : <div className="model-empty large"><h3>{t("models.routes.emptyTitle")}</h3><p>{t("models.routes.emptyDescription")}</p></div>}
        </div>
      </section>
      <div className="model-page-message">{message}</div>
    </section>
  );
}

function ModelRow({ model, onChange, onDelete, t }: { model: ProviderModel; onChange: (patch: Partial<ProviderModel>) => void; onDelete: () => void; t: (key: string) => string }) {
  return <div className="model-row"><input aria-label={t("models.fields.modelId")} className="model-id-input" placeholder={t("models.fields.modelId")} value={model.modelId} onChange={(event) => onChange({ modelId: event.target.value })} /><input aria-label={t("models.fields.displayName")} placeholder={t("models.fields.displayName")} value={model.displayName} onChange={(event) => onChange({ displayName: event.target.value })} /><input aria-label={t("models.fields.contextLength")} className="context-input" min={1} type="number" value={model.contextLength} onChange={(event) => onChange({ contextLength: Number(event.target.value) })} /><input aria-label={t("models.fields.inputPrice")} className="price-input" min={0} step="0.01" type="number" placeholder="in / 1M" value={model.inputPricePerMillion ?? ""} onChange={(event) => onChange({ inputPricePerMillion: event.target.value === "" ? undefined : Number(event.target.value) })} /><input aria-label={t("models.fields.outputPrice")} className="price-input" min={0} step="0.01" type="number" placeholder="out / 1M" value={model.outputPricePerMillion ?? ""} onChange={(event) => onChange({ outputPricePerMillion: event.target.value === "" ? undefined : Number(event.target.value) })} /><label className="mini-check" title={t("models.fields.tools")}><input checked={model.supportsTools} onChange={(event) => onChange({ supportsTools: event.target.checked })} type="checkbox" /> T</label><label className="mini-check" title={t("models.fields.vision")}><input checked={model.supportsVision} onChange={(event) => onChange({ supportsVision: event.target.checked })} type="checkbox" /> V</label><label className="mini-check" title={t("models.fields.structured")}><input checked={model.supportsStructuredOutput} onChange={(event) => onChange({ supportsStructuredOutput: event.target.checked })} type="checkbox" /> JSON</label><label className="mini-check" title={t("models.fields.enabled")}><input checked={model.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} type="checkbox" /><Check size={13} /></label><button className="danger-icon-button" onClick={onDelete} title={t("models.actions.deleteModel")} type="button"><Trash2 size={14} /></button></div>;
}

function CandidateRow({ candidate, providers, onChange, onDelete, t }: { candidate: ModelRouteCandidate; providers: ModelProvider[]; onChange: (patch: Partial<ModelRouteCandidate>) => void; onDelete: () => void; t: (key: string) => string }) {
  const provider = providers.find((item) => item.id === candidate.providerId);
  const models = provider?.models ?? [];
  return <div className="candidate-row"><select value={candidate.providerId} onChange={(event) => { const nextProvider = providers.find((item) => item.id === event.target.value); onChange({ providerId: event.target.value, modelId: nextProvider?.models.find((model) => model.enabled)?.modelId ?? "" }); }}><option value="">{t("models.fields.selectProvider")}</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select><select value={candidate.modelId} onChange={(event) => onChange({ modelId: event.target.value })}><option value="">{t("models.fields.selectModel")}</option>{models.map((model) => <option key={model.id} value={model.modelId}>{model.displayName || model.modelId}</option>)}</select><input aria-label={t("models.fields.priority")} min={0} type="number" value={candidate.priority} onChange={(event) => onChange({ priority: Number(event.target.value) })} /><input aria-label={t("models.fields.weight")} min={1} max={100} type="number" value={candidate.weight} onChange={(event) => onChange({ weight: Number(event.target.value) })} /><input aria-label={t("models.fields.maxRetries")} min={0} max={10} type="number" value={candidate.maxRetries} onChange={(event) => onChange({ maxRetries: Number(event.target.value) })} /><label className="mini-check"><input checked={candidate.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} type="checkbox" /> {t("models.fields.enabledShort")}</label><button className="danger-icon-button" onClick={onDelete} title={t("models.actions.deleteCandidate")} type="button"><Trash2 size={14} /></button></div>;
}
