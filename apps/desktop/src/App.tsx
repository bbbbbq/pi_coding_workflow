import { useCallback, useState } from "react";
import type { WorkflowDefinition, WorkflowSchedule } from "@pi-workflow/contracts";
import {
  CalendarClock,
  History,
  Settings,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { OperationsDashboard, type Run } from "./components/OperationsDashboard";
import type { SupportedLanguage } from "./i18n";
import { ScheduleManager } from "./schedules/ScheduleManager";
import { useWorkflowSchedules } from "./schedules/useWorkflowSchedules";
import { createExampleWorkflow } from "./workflow/exampleWorkflow";
import { getStoredWorkflowDefinition, WorkflowEditor } from "./workflow/WorkflowEditor";
import "./App.css";

type AppView = "builder" | "schedules" | "runs";
const scheduledRunsStorageKey = "pi-workflow.scheduled-runs.v1";

function App() {
  const { t, i18n } = useTranslation();
  const [activeView, setActiveView] = useState<AppView>("builder");
  const [currentWorkflow, setCurrentWorkflow] = useState<WorkflowDefinition>(
    () => getStoredWorkflowDefinition() ?? createExampleWorkflow(),
  );
  const [scheduledRuns, setScheduledRuns] = useState<Run[]>(loadScheduledRuns);
  const currentLanguage: SupportedLanguage = i18n.resolvedLanguage?.startsWith("zh")
    ? "zh-CN"
    : "en";

  function changeLanguage(language: SupportedLanguage) {
    void i18n.changeLanguage(language);
  }

  const startScheduledWorkflow = useCallback((schedule: WorkflowSchedule) => {
    const run: Run = {
      id: `RUN-${Date.now().toString(36).toUpperCase()}`,
      title: schedule.workflowName,
      repository: schedule.name,
      status: "running",
      updatedAtKey: "runs.time.now",
    };
    setScheduledRuns((current) => {
      const next = [run, ...current].slice(0, 50);
      window.localStorage.setItem(scheduledRunsStorageKey, JSON.stringify(next));
      return next;
    });
  }, []);

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
          <WorkflowEditor onWorkflowSaved={setCurrentWorkflow} />
        )}
        {activeView === "schedules" && (
          <ScheduleManager
            workflow={{ id: currentWorkflow.id, name: currentWorkflow.name }}
            schedules={schedules}
            onCreate={createSchedule}
            onToggle={toggleSchedule}
            onDelete={deleteSchedule}
          />
        )}
        {activeView === "runs" && <OperationsDashboard scheduledRuns={scheduledRuns} />}
      </main>
    </div>
  );
}

export default App;

function loadScheduledRuns(): Run[] {
  const saved = window.localStorage.getItem(scheduledRunsStorageKey);
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved) as unknown;
    return Array.isArray(parsed) ? parsed as Run[] : [];
  } catch {
    window.localStorage.removeItem(scheduledRunsStorageKey);
    return [];
  }
}
