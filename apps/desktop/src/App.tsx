import { useCallback, useEffect, useState } from "react";
import type {
  WorkflowDefinition,
  WorkflowRunRecord,
  WorkflowSchedule,
} from "@pi-workflow/contracts";
import {
  CalendarClock,
  History,
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
  initializePersistence,
  listRuns,
  saveRun,
  saveWorkflowDefinition,
} from "./storage/repository";
import { createExampleWorkflow } from "./workflow/exampleWorkflow";
import { WorkflowEditor } from "./workflow/WorkflowEditor";
import "./App.css";

type AppView = "builder" | "schedules" | "runs";

function App() {
  const { t, i18n } = useTranslation();
  const [activeView, setActiveView] = useState<AppView>("builder");
  const [currentWorkflow, setCurrentWorkflow] = useState<WorkflowDefinition>(createExampleWorkflow);
  const [persistedRuns, setPersistedRuns] = useState<WorkflowRunRecord[]>([]);
  const currentLanguage: SupportedLanguage = i18n.resolvedLanguage?.startsWith("zh")
    ? "zh-CN"
    : "en";

  function changeLanguage(language: SupportedLanguage) {
    void i18n.changeLanguage(language);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await initializePersistence();
      const savedWorkflow = await getLatestWorkflowDefinition();
      const workflow = savedWorkflow ?? await saveWorkflowDefinition(createExampleWorkflow());
      const runs = await listRuns();
      if (!cancelled) {
        setCurrentWorkflow(workflow);
        setPersistedRuns(runs);
      }
    })().catch((error) => console.error("Failed to initialize persistence", error));
    return () => {
      cancelled = true;
    };
  }, []);

  const persistWorkflow = useCallback(async (definition: WorkflowDefinition) => {
    const saved = await saveWorkflowDefinition(definition);
    setCurrentWorkflow(saved);
    return saved;
  }, []);

  const startScheduledWorkflow = useCallback((schedule: WorkflowSchedule) => {
    const now = new Date().toISOString();
    const run: WorkflowRunRecord = {
      id: `RUN-${Date.now().toString(36).toUpperCase()}`,
      workflowId: schedule.workflowId,
      workflowVersion: schedule.workflowVersion,
      scheduleId: schedule.id,
      trigger: "schedule",
      title: schedule.workflowName,
      repository: schedule.name,
      status: "running",
      startedAt: now,
      updatedAt: now,
    };
    setPersistedRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 50));
    void saveRun(run).catch((error) => console.error("Failed to save scheduled run", error));
  }, []);

  const startManualWorkflow = useCallback((input: StartRunInput) => {
    const now = new Date().toISOString();
    const title = input.task.trim().split(/[.!?。！？]/)[0] || t("runs.untitled");
    const run: WorkflowRunRecord = {
      id: `RUN-${Date.now().toString(36).toUpperCase()}`,
      workflowId: currentWorkflow.id,
      workflowVersion: currentWorkflow.version,
      trigger: "manual",
      title,
      repository: input.repository.split("/").filter(Boolean).slice(-2).join("/") || input.repository,
      task: input.task,
      status: "running",
      startedAt: now,
      updatedAt: now,
    };
    setPersistedRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 50));
    void saveRun(run).catch((error) => console.error("Failed to save manual run", error));
    return run;
  }, [currentWorkflow, t]);

  const { schedules, createSchedule, toggleSchedule, deleteSchedule } =
    useWorkflowSchedules(startScheduledWorkflow);

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
            <div className="runtime-status"><i /> {t("header.ready")}</div>
          </div>
        </header>

        {activeView === "builder" && (
          <WorkflowEditor
            initialDefinition={currentWorkflow}
            key={`${currentWorkflow.id}:${currentWorkflow.version}:${currentWorkflow.updatedAt}`}
            onWorkflowSave={persistWorkflow}
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
