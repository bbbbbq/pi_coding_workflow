import { FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SupportedLanguage } from "./i18n";
import "./App.css";

type RunStatus = "running" | "review" | "complete";

type Run = {
  id: string;
  title?: string;
  titleKey?: string;
  repository: string;
  status: RunStatus;
  updatedAtKey: string;
};

const workflowStepKeys = [
  "workflow.steps.prepare",
  "workflow.steps.analyze",
  "workflow.steps.approve",
  "workflow.steps.implement",
  "workflow.steps.validate",
  "workflow.steps.deliver",
];

const initialRuns: Run[] = [
  {
    id: "RUN-042",
    titleKey: "runs.mock.scheduler",
    repository: "orbit/runtime",
    status: "running",
    updatedAtKey: "runs.time.twoMinutes",
  },
  {
    id: "RUN-041",
    titleKey: "runs.mock.importCommand",
    repository: "forge/desktop",
    status: "review",
    updatedAtKey: "runs.time.eighteenMinutes",
  },
  {
    id: "RUN-040",
    titleKey: "runs.mock.configParser",
    repository: "core/config",
    status: "complete",
    updatedAtKey: "runs.time.oneHour",
  },
];

function App() {
  const { t, i18n } = useTranslation();
  const [repository, setRepository] = useState("/Users/you/code/project");
  const [task, setTask] = useState("");
  const [runs, setRuns] = useState(initialRuns);
  const [selectedRun, setSelectedRun] = useState(initialRuns[0].id);

  const currentLanguage: SupportedLanguage = i18n.resolvedLanguage?.startsWith("zh")
    ? "zh-CN"
    : "en";

  const activeRun = useMemo(
    () => runs.find((run) => run.id === selectedRun) ?? runs[0],
    [runs, selectedRun],
  );

  function changeLanguage(language: SupportedLanguage) {
    void i18n.changeLanguage(language);
  }

  function startRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextId = `RUN-${String(43 + runs.length - initialRuns.length).padStart(3, "0")}`;
    const title = task.trim().split(/[.!?。！？]/)[0] || t("runs.untitled");
    const nextRun: Run = {
      id: nextId,
      title,
      repository: repository.split("/").filter(Boolean).slice(-2).join("/") || repository,
      status: "running",
      updatedAtKey: "runs.time.now",
    };

    setRuns((current) => [nextRun, ...current]);
    setSelectedRun(nextId);
  }

  function runTitle(run: Run) {
    return run.title ?? t(run.titleKey ?? "runs.untitled");
  }

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand-mark" aria-label="Pi Workflow">
          <span>π</span>
        </div>

        <nav className="rail-nav" aria-label={t("navigation.primary")}>
          <button className="rail-button is-active" aria-label={t("navigation.workspace")}>
            W
          </button>
          <button className="rail-button" aria-label={t("navigation.runs")}>
            R
          </button>
          <button className="rail-button" aria-label={t("navigation.policies")}>
            P
          </button>
        </nav>

        <button className="rail-button rail-settings" aria-label={t("navigation.settings")}>
          S
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
              >
                EN
              </button>
              <button
                className={currentLanguage === "zh-CN" ? "is-active" : ""}
                onClick={() => changeLanguage("zh-CN")}
                type="button"
                aria-pressed={currentLanguage === "zh-CN"}
              >
                中文
              </button>
            </div>
            <div className="platforms" aria-label={t("header.supportedPlatforms")}>
              <span>macOS</span>
              <span>Windows</span>
              <span>Linux</span>
            </div>
            <div className="runtime-status">
              <i /> {t("header.ready")}
            </div>
          </div>
        </header>

        <section className="command-grid">
          <form className="task-composer" onSubmit={startRun}>
            <div className="section-heading">
              <div>
                <p className="section-index">{t("composer.index")}</p>
                <h2>{t("composer.title")}</h2>
              </div>
              <span className="mode-chip">{t("composer.executor")}</span>
            </div>

            <label>
              <span>{t("composer.repository")}</span>
              <input
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                spellCheck={false}
              />
            </label>

            <label>
              <span>{t("composer.task")}</span>
              <textarea
                value={task}
                onChange={(event) => setTask(event.target.value)}
                placeholder={t("composer.taskPlaceholder")}
                rows={5}
              />
            </label>

            <div className="composer-footer">
              <p>
                <strong>{t("composer.policyLabel")}</strong> {t("composer.policy")}
              </p>
              <button className="launch-button" type="submit">
                {t("composer.start")} <span>↗</span>
              </button>
            </div>
          </form>

          <aside className="workflow-panel">
            <div className="panel-head">
              <div>
                <p className="section-index">{t("workflow.index")}</p>
                <h3>{activeRun?.id ?? t("workflow.noRun")}</h3>
              </div>
              <span className={`status-pill ${activeRun?.status ?? "complete"}`}>
                {activeRun ? t(`status.${activeRun.status}`) : t("status.idle")}
              </span>
            </div>

            <ol className="workflow-list">
              {workflowStepKeys.map((stepKey, index) => {
                const activeIndex = activeRun?.status === "review" ? 5 : activeRun?.status === "complete" ? 6 : 3;
                const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "waiting";
                const stateKey = state === "done" ? "done" : state === "active" ? "working" : "queued";

                return (
                  <li className={state} key={stepKey}>
                    <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
                    <span className="step-label">{t(stepKey)}</span>
                    <span className="step-state">{t(`workflow.states.${stateKey}`)}</span>
                  </li>
                );
              })}
            </ol>

            <div className="workflow-note">
              <span>{t("workflow.boundary")}</span>
              {t("workflow.boundaryDescription")}
            </div>
          </aside>
        </section>

        <section className="runs-panel">
          <div className="runs-heading">
            <div>
              <p className="section-index">{t("runs.index")}</p>
              <h2>{t("runs.title")}</h2>
            </div>
            <button type="button">{t("runs.viewAll")} →</button>
          </div>

          <div className="run-table" role="table" aria-label={t("runs.ariaLabel")}>
            {runs.map((run) => (
              <button
                className={`run-row ${selectedRun === run.id ? "is-selected" : ""}`}
                key={run.id}
                onClick={() => setSelectedRun(run.id)}
                type="button"
              >
                <span className="run-id">{run.id}</span>
                <span className="run-title">
                  <strong>{runTitle(run)}</strong>
                  <small>{run.repository}</small>
                </span>
                <span className={`run-status ${run.status}`}>{t(`status.${run.status}`)}</span>
                <span className="run-time">{t(run.updatedAtKey)}</span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
