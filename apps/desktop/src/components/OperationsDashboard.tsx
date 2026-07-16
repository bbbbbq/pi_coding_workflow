import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  WorkflowApproval,
  WorkflowRunEvent,
  WorkflowRunRecord,
} from "@pi-workflow/contracts";
import { Check, Play, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface RunInspection {
  events: WorkflowRunEvent[];
  approvals: WorkflowApproval[];
}

interface OperationsDashboardProps {
  persistedRuns?: WorkflowRunRecord[];
  onStartRun: (input: StartRunInput) => WorkflowRunRecord;
  onInspectRun: (runId: string) => Promise<RunInspection>;
  onDecideApproval: (runId: string, approvalId: string, approved: boolean) => Promise<void>;
}

export interface StartRunInput {
  repository: string;
  task: string;
}

export function OperationsDashboard({
  persistedRuns = [],
  onStartRun,
  onInspectRun,
  onDecideApproval,
}: OperationsDashboardProps) {
  const { t, i18n } = useTranslation();
  const [repository, setRepository] = useState("/Users/you/code/project");
  const [task, setTask] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [inspection, setInspection] = useState<RunInspection>({ events: [], approvals: [] });
  const [decidingApproval, setDecidingApproval] = useState(false);
  const activeRun = useMemo(
    () => persistedRuns.find((run) => run.id === selectedRunId) ?? persistedRuns[0],
    [persistedRuns, selectedRunId],
  );
  const pendingApproval = inspection.approvals.find((approval) => approval.status === "pending");

  useEffect(() => {
    setSelectedRunId((current) => (
      current && persistedRuns.some((run) => run.id === current)
        ? current
        : persistedRuns[0]?.id
    ));
  }, [persistedRuns]);

  useEffect(() => {
    if (!activeRun) {
      setInspection({ events: [], approvals: [] });
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void onInspectRun(activeRun.id)
        .then((next) => {
          if (!cancelled) setInspection(next);
        })
        .catch((error) => console.error("Failed to inspect Run", error));
    };
    refresh();
    const timer = window.setInterval(refresh, 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeRun?.id, onInspectRun]);

  function startRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const run = onStartRun({ repository, task });
    setSelectedRunId(run.id);
  }

  async function decideApproval(approved: boolean) {
    if (!activeRun || !pendingApproval) return;
    setDecidingApproval(true);
    try {
      await onDecideApproval(activeRun.id, pendingApproval.id, approved);
      setInspection(await onInspectRun(activeRun.id));
    } finally {
      setDecidingApproval(false);
    }
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
            <input required value={repository} onChange={(event) => setRepository(event.target.value)} spellCheck={false} />
          </label>

          <label>
            <span>{t("composer.task")}</span>
            <textarea
              required
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder={t("composer.taskPlaceholder")}
              rows={5}
            />
          </label>

          <div className="composer-footer">
            <p><strong>{t("composer.policyLabel")}</strong> {t("composer.policy")}</p>
            <button className="launch-button" type="submit">
              <Play aria-hidden="true" size={15} /> {t("composer.start")}
            </button>
          </div>
        </form>

        <aside className="workflow-panel">
          <div className="panel-head">
            <div>
              <p className="section-index">{t("workflow.index")}</p>
              <h3>{activeRun?.id ?? t("workflow.noRun")}</h3>
            </div>
            <span className={`status-pill ${activeRun?.status ?? "idle"}`}>
              {activeRun ? t(`status.${activeRun.status}`) : t("status.idle")}
            </span>
          </div>

          <ol className="workflow-list run-event-list">
            {inspection.events.slice(-10).map((event) => (
              <li className={eventClass(event)} key={`${event.runId}-${event.sequence}`}>
                <span className="step-number">{String(event.sequence).padStart(2, "0")}</span>
                <span className="step-label">{t(`workflow.events.${event.type}`, { defaultValue: event.type })}</span>
                <span className="step-state">{event.nodeId ?? t(`status.${event.toStatus}`)}</span>
              </li>
            ))}
          </ol>

          {pendingApproval ? (
            <div className="approval-box">
              <span>{t("workflow.approvalRequired")}</span>
              <strong>{pendingApproval.title}</strong>
              <div>
                <button disabled={decidingApproval} onClick={() => void decideApproval(false)} type="button">
                  <X aria-hidden="true" size={14} /> {t("workflow.reject")}
                </button>
                <button className="approve" disabled={decidingApproval} onClick={() => void decideApproval(true)} type="button">
                  <Check aria-hidden="true" size={14} /> {t("workflow.approve")}
                </button>
              </div>
            </div>
          ) : (
            <div className="workflow-note">
              <span>{t("workflow.boundary")}</span>
              {inspection.events.length > 0
                ? t("workflow.eventCount", { count: inspection.events.length })
                : t("workflow.boundaryDescription")}
            </div>
          )}
        </aside>
      </section>

      <section className="runs-panel">
        <div className="runs-heading">
          <div>
            <p className="section-index">{t("runs.index")}</p>
            <h2>{t("runs.title")}</h2>
          </div>
        </div>

        <div className="run-table" role="table" aria-label={t("runs.ariaLabel")}>
          {persistedRuns.length === 0 && <p className="run-empty">{t("runs.empty")}</p>}
          {persistedRuns.map((run) => (
            <button
              className={`run-row ${selectedRunId === run.id ? "is-selected" : ""}`}
              key={run.id}
              onClick={() => setSelectedRunId(run.id)}
              type="button"
            >
              <span className="run-id">{run.id}</span>
              <span className="run-title">
                <strong>{run.title || t("runs.untitled")}</strong>
                <small>{run.repository}</small>
              </span>
              <span className={`run-status ${run.status}`}>{t(`status.${run.status}`)}</span>
              <span className="run-time">{formatRunTime(run.updatedAt, i18n.language)}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function eventClass(event: WorkflowRunEvent): string {
  if (event.type === "node_failed" || event.type === "run_failed" || event.type === "run_cancelled") return "failed";
  if (event.type === "node_started" || event.type === "run_started") return "active";
  return "done";
}

function formatRunTime(value: string, language: string): string {
  const elapsedSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (Math.abs(elapsedSeconds) < 60) return formatter.format(elapsedSeconds, "second");
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, "minute");
  return formatter.format(Math.round(elapsedMinutes / 60), "hour");
}
