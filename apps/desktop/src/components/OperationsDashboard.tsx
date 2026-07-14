import { FormEvent, useEffect, useMemo, useState } from "react";
import type { WorkflowRunRecord } from "@pi-workflow/contracts";
import { useTranslation } from "react-i18next";

type RunStatus = "running" | "review" | "complete" | "failed";

type Run = {
  id: string;
  title?: string;
  titleKey?: string;
  repository: string;
  status: RunStatus;
  updatedAtKey?: string;
  updatedAt?: string;
};

interface OperationsDashboardProps {
  persistedRuns?: WorkflowRunRecord[];
  onStartRun: (input: StartRunInput) => WorkflowRunRecord;
}

export interface StartRunInput {
  repository: string;
  task: string;
}

const workflowStepKeys = [
  "workflow.steps.prepare",
  "workflow.steps.analyze",
  "workflow.steps.approve",
  "workflow.steps.implement",
  "workflow.steps.validate",
  "workflow.steps.deliver",
];

const initialRuns: Run[] = [
  { id: "RUN-042", titleKey: "runs.mock.scheduler", repository: "orbit/runtime", status: "running", updatedAtKey: "runs.time.twoMinutes" },
  { id: "RUN-041", titleKey: "runs.mock.importCommand", repository: "forge/desktop", status: "review", updatedAtKey: "runs.time.eighteenMinutes" },
  { id: "RUN-040", titleKey: "runs.mock.configParser", repository: "core/config", status: "complete", updatedAtKey: "runs.time.oneHour" },
];

export function OperationsDashboard({ persistedRuns = [], onStartRun }: OperationsDashboardProps) {
  const { t, i18n } = useTranslation();
  const [repository, setRepository] = useState("/Users/you/code/project");
  const [task, setTask] = useState("");
  const storedRuns = useMemo(() => persistedRuns.map(toDashboardRun), [persistedRuns]);
  const [selectedRun, setSelectedRun] = useState(
    () => storedRuns[0]?.id ?? initialRuns[0].id,
  );
  const runs = useMemo(
    () => [...storedRuns, ...initialRuns],
    [storedRuns],
  );

  const activeRun = useMemo(
    () => runs.find((run) => run.id === selectedRun) ?? runs[0],
    [runs, selectedRun],
  );

  useEffect(() => {
    if (storedRuns[0]) setSelectedRun(storedRuns[0].id);
  }, [storedRuns]);

  function startRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const run = onStartRun({ repository, task });
    setSelectedRun(run.id);
  }

  return (
    <>
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
            <input value={repository} onChange={(event) => setRepository(event.target.value)} spellCheck={false} />
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
            <p><strong>{t("composer.policyLabel")}</strong> {t("composer.policy")}</p>
            <button className="launch-button" type="submit">{t("composer.start")} <span>↗</span></button>
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
              const activeIndex = activeRun?.status === "review" ? 5 : activeRun?.status === "running" ? 3 : 6;
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
                <strong>{run.title ?? t(run.titleKey ?? "runs.untitled")}</strong>
                <small>{run.repository}</small>
              </span>
              <span className={`run-status ${run.status}`}>{t(`status.${run.status}`)}</span>
              <span className="run-time">
                {run.updatedAt
                  ? formatRunTime(run.updatedAt, i18n.language)
                  : t(run.updatedAtKey ?? "runs.time.now")}
              </span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function toDashboardRun(run: WorkflowRunRecord): Run {
  return {
    id: run.id,
    title: run.title,
    repository: run.repository,
    status: run.status === "review"
      ? "review"
      : run.status === "completed"
        ? "complete"
        : run.status === "failed" || run.status === "cancelled"
          ? "failed"
          : "running",
    updatedAt: run.updatedAt,
  };
}

function formatRunTime(value: string, language: string): string {
  const elapsedSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (Math.abs(elapsedSeconds) < 60) return formatter.format(elapsedSeconds, "second");
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, "minute");
  return formatter.format(Math.round(elapsedMinutes / 60), "hour");
}
