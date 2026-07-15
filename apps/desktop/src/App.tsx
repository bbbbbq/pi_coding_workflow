import { useCallback, useEffect, useState } from "react";
import type {
  ModelProvider,
  ModelRoute,
  WorkflowDefinition,
  WorkflowRunRecord,
} from "@pi-workflow/contracts";
import {
  CalendarClock,
  History,
  Network,
  Settings,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  OperationsDashboard,
  type StartRunInput,
} from "./components/OperationsDashboard";
import type { SupportedLanguage } from "./i18n";
import { ScheduleManager } from "./schedules/ScheduleManager";
import { useWorkflowSchedules } from "./schedules/useWorkflowSchedules";
import {
  getLatestWorkflowDefinition,
  getSetting,
  initializePersistence,
  listModelProviders,
  listModelRoutes,
  listRuns,
  saveRun,
  saveSetting,
  saveWorkflowDefinition,
} from "./storage/repository";
import {
  getTemporalHealth,
  startTemporalRun,
} from "./temporal/client";
import { createExampleWorkflow } from "./workflow/exampleWorkflow";
import { WorkflowEditor } from "./workflow/WorkflowEditor";
import { ModelRoutingManager } from "./models/ModelRoutingManager";
import "./App.css";

type AppView = "builder" | "models" | "schedules" | "runs";

function App() {
  const { t, i18n } = useTranslation();
  const [activeView, setActiveView] = useState<AppView>("builder");
  const [currentWorkflow, setCurrentWorkflow] = useState<WorkflowDefinition>(createExampleWorkflow);
  const [persistedRuns, setPersistedRuns] = useState<WorkflowRunRecord[]>([]);
  const [modelProviders, setModelProviders] = useState<ModelProvider[]>([]);
  const [modelRoutes, setModelRoutes] = useState<ModelRoute[]>([]);
  const [temporalAvailable, setTemporalAvailable] = useState<boolean | undefined>();
  const currentLanguage: SupportedLanguage = i18n.resolvedLanguage?.startsWith("zh")
    ? "zh-CN"
    : "en";

  function changeLanguage(language: SupportedLanguage) {
    void i18n.changeLanguage(language);
    void saveSetting("language", language)
      .catch((error) => console.error("Failed to save language setting", error));
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await initializePersistence();
      const savedLanguage = await getSetting("language");
      if (savedLanguage === "en" || savedLanguage === "zh-CN") {
        await i18n.changeLanguage(savedLanguage);
      }
      const savedWorkflow = await getLatestWorkflowDefinition();
      const workflow = savedWorkflow ?? await saveWorkflowDefinition(createExampleWorkflow());
      const runs = await listRuns();
      const providers = await listModelProviders();
      const routes = await listModelRoutes();
      if (!cancelled) {
        setCurrentWorkflow(workflow);
        setPersistedRuns(runs);
        setModelProviders(providers);
        setModelRoutes(routes);
      }
    })().catch((error) => console.error("Failed to initialize persistence", error));
    return () => {
      cancelled = true;
    };
  }, [i18n]);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void getTemporalHealth()
        .then(() => {
          if (!cancelled) setTemporalAvailable(true);
        })
        .catch(() => {
          if (!cancelled) setTemporalAvailable(false);
        });
    };
    check();
    const timer = window.setInterval(check, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const persistWorkflow = useCallback(async (definition: WorkflowDefinition) => {
    const saved = await saveWorkflowDefinition(definition);
    setCurrentWorkflow(saved);
    return saved;
  }, []);

  const startManualWorkflow = useCallback((input: StartRunInput) => {
    const now = new Date().toISOString();
    const title = input.task.trim().split(/[.!?。！？]/)[0] || t("runs.untitled");
    let run: WorkflowRunRecord = {
      id: `RUN-${Date.now().toString(36).toUpperCase()}`,
      workflowId: currentWorkflow.id,
      workflowVersion: currentWorkflow.version,
      trigger: "manual",
      title,
      repository: input.repository.split("/").filter(Boolean).slice(-2).join("/") || input.repository,
      task: input.task,
      status: "queued",
      startedAt: now,
      updatedAt: now,
    };
    const agentNode = currentWorkflow.nodes.find((node) => node.type === "pi-agent");
    setPersistedRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 50));
    void saveRun(run).catch((error) => console.error("Failed to save manual run", error));
    void startTemporalRun({
      runId: run.id,
      workflowId: currentWorkflow.id,
      workflowVersion: currentWorkflow.version,
      repositoryPath: input.repository,
      task: input.task,
      requirePlanApproval: false,
      modelRouting: { providers: modelProviders, routes: modelRoutes },
      routeId: agentNode?.type === "pi-agent" ? agentNode.config.routeId : undefined,
      providerId: agentNode?.type === "pi-agent" ? agentNode.config.providerId : undefined,
      modelId: agentNode?.type === "pi-agent" ? agentNode.config.modelId : undefined,
    }).then((remote) => {
      run = {
        ...run,
        status: "running",
        temporalWorkflowId: remote.workflowId,
        temporalRunId: remote.runId,
        updatedAt: new Date().toISOString(),
      };
      setPersistedRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 50));
      return saveRun(run);
    }).catch((error: unknown) => {
      run = {
        ...run,
        status: "failed",
        result: { error: error instanceof Error ? error.message : String(error) },
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setPersistedRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 50));
      return saveRun(run);
    }).catch((error) => console.error("Failed to persist Temporal run status", error));
    return run;
  }, [currentWorkflow, modelProviders, modelRoutes, t]);

  const scheduleAgentNode = currentWorkflow.nodes.find((node) => node.type === "pi-agent");
  const { schedules, createSchedule, toggleSchedule, deleteSchedule } = useWorkflowSchedules({
    modelRouting: { providers: modelProviders, routes: modelRoutes },
    routeId: scheduleAgentNode?.type === "pi-agent" ? scheduleAgentNode.config.routeId : undefined,
    providerId: scheduleAgentNode?.type === "pi-agent" ? scheduleAgentNode.config.providerId : undefined,
    modelId: scheduleAgentNode?.type === "pi-agent" ? scheduleAgentNode.config.modelId : undefined,
  });

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand-mark" aria-label="Pi Workflow"><span>π</span></div>

        <nav className="rail-nav" aria-label={t("navigation.primary")}>
          <button
            className={`rail-button ${activeView === "builder" ? "is-active" : ""}`}
            aria-label={t("navigation.workspace")}
            onClick={() => setActiveView("builder")}
            title={t("navigation.workspace")}
            type="button"
          >
            <WorkflowIcon size={18} />
          </button>
          <button
            className={`rail-button ${activeView === "models" ? "is-active" : ""}`}
            aria-label={t("navigation.models")}
            onClick={() => setActiveView("models")}
            title={t("navigation.models")}
            type="button"
          >
            <Network size={18} />
          </button>
          <button
            className={`rail-button ${activeView === "schedules" ? "is-active" : ""}`}
            aria-label={t("navigation.schedules")}
            onClick={() => setActiveView("schedules")}
            title={t("navigation.schedules")}
            type="button"
          >
            <CalendarClock size={18} />
          </button>
          <button
            className={`rail-button ${activeView === "runs" ? "is-active" : ""}`}
            aria-label={t("navigation.runs")}
            onClick={() => setActiveView("runs")}
            title={t("navigation.runs")}
            type="button"
          >
            <History size={18} />
          </button>
        </nav>

        <button
          className="rail-button rail-settings"
          aria-label={t("navigation.settings")}
          disabled
          title={t("navigation.settings")}
          type="button"
        >
          <Settings size={18} />
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t("header.eyebrow")}</p>
            <h1>Pi Workflow</h1>
          </div>

          <div className="topbar-meta">
            <div className="language-switch" role="group" aria-label={t("language.label")}>
              <button
                className={currentLanguage === "en" ? "is-active" : ""}
                onClick={() => changeLanguage("en")}
                type="button"
                aria-pressed={currentLanguage === "en"}
              >EN</button>
              <button
                className={currentLanguage === "zh-CN" ? "is-active" : ""}
                onClick={() => changeLanguage("zh-CN")}
                type="button"
                aria-pressed={currentLanguage === "zh-CN"}
              >中文</button>
            </div>
            <div className={`runtime-status ${temporalAvailable === false ? "is-offline" : ""}`}>
              <i /> {t(temporalAvailable ? "header.ready" : "header.unavailable")}
            </div>
          </div>
        </header>

        {activeView === "builder" && (
          <WorkflowEditor
            initialDefinition={currentWorkflow}
            key={`${currentWorkflow.id}:${currentWorkflow.version}:${currentWorkflow.updatedAt}`}
            modelProviders={modelProviders}
            modelRoutes={modelRoutes}
            onWorkflowSave={persistWorkflow}
          />
        )}
        {activeView === "models" && (
          <ModelRoutingManager
            onProvidersChange={setModelProviders}
            onRoutesChange={setModelRoutes}
            providers={modelProviders}
            routes={modelRoutes}
          />
        )}
        {activeView === "schedules" && (
          <ScheduleManager
            workflow={{
              id: currentWorkflow.id,
              name: currentWorkflow.name,
              version: currentWorkflow.version,
            }}
            schedules={schedules}
            onCreate={createSchedule}
            onToggle={toggleSchedule}
            onDelete={deleteSchedule}
          />
        )}
        {activeView === "runs" && (
          <OperationsDashboard
            onStartRun={startManualWorkflow}
            persistedRuns={persistedRuns}
          />
        )}
      </main>
    </div>
  );
}

export default App;
