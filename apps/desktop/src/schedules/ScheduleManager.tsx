import { FormEvent, useMemo, useState } from "react";
import type {
  WorkflowSchedule,
  WorkflowScheduleFrequency,
} from "@pi-workflow/contracts";
import {
  CalendarClock,
  Clock3,
  Pause,
  Play,
  Plus,
  Trash2,
  Workflow,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CreateWorkflowScheduleInput } from "./useWorkflowSchedules";
import "./scheduleManager.css";

interface ScheduleManagerProps {
  workflow: { id: string; name: string; version: number };
  schedules: WorkflowSchedule[];
  onCreate: (input: CreateWorkflowScheduleInput) => Promise<boolean>;
  onToggle: (scheduleId: string) => Promise<void>;
  onDelete: (scheduleId: string) => Promise<void>;
}

export function ScheduleManager({
  workflow,
  schedules,
  onCreate,
  onToggle,
  onDelete,
}: ScheduleManagerProps) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<WorkflowScheduleFrequency>("once");
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);
  const [repositoryPath, setRepositoryPath] = useState("/Users/you/code/project");
  const [task, setTask] = useState("");
  const [formError, setFormError] = useState(false);
  const [creating, setCreating] = useState(false);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const activeCount = schedules.filter((schedule) => schedule.enabled).length;
  const nextSchedule = useMemo(() => schedules
    .filter((schedule) => schedule.enabled && schedule.nextRunAt)
    .sort((left, right) => left.nextRunAt!.localeCompare(right.nextRunAt!))[0], [schedules]);

  async function createSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const date = new Date(scheduledAt);
    if (Number.isNaN(date.getTime()) || repositoryPath.trim().length === 0 || task.trim().length === 0) {
      setFormError(true);
      return;
    }
    setCreating(true);
    try {
      const created = await onCreate({
        name: name.trim() || `${workflow.name} · ${t(`schedules.frequency.${frequency}`)}`,
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowVersion: workflow.version,
        repositoryPath: repositoryPath.trim(),
        task: task.trim(),
        frequency,
        scheduledAt: date.toISOString(),
        timeZone,
      });

      setFormError(!created);
      if (created) {
        setName("");
        setTask("");
        setScheduledAt(defaultScheduledAt());
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="schedules-page">
      <header className="page-heading schedules-heading">
        <div>
          <p className="section-index">{t("schedules.index")}</p>
          <h2>{t("schedules.title")}</h2>
          <p>{t("schedules.subtitle")}</p>
        </div>
        <div className="schedule-summary" aria-label={t("schedules.summary.label")}>
          <div>
            <span>{t("schedules.summary.active")}</span>
            <strong>{activeCount}</strong>
          </div>
          <div>
            <span>{t("schedules.summary.next")}</span>
            <strong>{nextSchedule?.nextRunAt
              ? formatDate(nextSchedule.nextRunAt, i18n.language)
              : t("schedules.summary.none")}</strong>
          </div>
        </div>
      </header>

      <div className="schedule-layout">
        <form className="schedule-form" onSubmit={createSchedule}>
          <div className="panel-title-row">
            <span className="panel-icon"><Plus size={18} /></span>
            <div>
              <h3>{t("schedules.form.title")}</h3>
              <p>{t("schedules.form.description")}</p>
            </div>
          </div>

          <label className="schedule-field">
            <span>{t("schedules.form.name")}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("schedules.form.namePlaceholder")}
            />
          </label>

          <label className="schedule-field">
            <span>{t("schedules.form.workflow")}</span>
            <div className="workflow-readonly">
              <Workflow size={16} /> {workflow.name} · v{workflow.version}
            </div>
          </label>

          <label className="schedule-field">
            <span>{t("schedules.form.repository")}</span>
            <input
              value={repositoryPath}
              onChange={(event) => setRepositoryPath(event.target.value)}
              spellCheck={false}
              placeholder={t("schedules.form.repositoryPlaceholder")}
            />
          </label>

          <label className="schedule-field">
            <span>{t("schedules.form.task")}</span>
            <textarea
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder={t("schedules.form.taskPlaceholder")}
              rows={3}
            />
          </label>

          <div className="schedule-field-grid">
            <label className="schedule-field">
              <span>{t("schedules.form.frequency")}</span>
              <select
                value={frequency}
                onChange={(event) => setFrequency(event.target.value as WorkflowScheduleFrequency)}
              >
                <option value="once">{t("schedules.frequency.once")}</option>
                <option value="daily">{t("schedules.frequency.daily")}</option>
                <option value="weekly">{t("schedules.frequency.weekly")}</option>
              </select>
            </label>
            <label className="schedule-field">
              <span>{t("schedules.form.runAt")}</span>
              <input
                min={formatDateTimeLocal(new Date())}
                onChange={(event) => {
                  setScheduledAt(event.target.value);
                  setFormError(false);
                }}
                onInput={(event) => {
                  setScheduledAt(event.currentTarget.value);
                  setFormError(false);
                }}
                step="1"
                type="datetime-local"
                value={scheduledAt}
              />
            </label>
          </div>

          <div className="time-zone-note"><Clock3 size={14} /> {timeZone}</div>
          {formError && <p className="schedule-form-error">{t("schedules.form.futureError")}</p>}

          <button className="primary-action" disabled={creating} type="submit">
            <CalendarClock size={17} /> {t(creating ? "schedules.form.creating" : "schedules.form.create")}
          </button>
        </form>

        <section className="schedule-list-panel">
          <div className="panel-title-row">
            <span className="panel-icon"><CalendarClock size={18} /></span>
            <div>
              <h3>{t("schedules.list.title")}</h3>
              <p>{t("schedules.list.description")}</p>
            </div>
          </div>

          {schedules.length === 0 ? (
            <div className="schedule-empty">
              <CalendarClock size={25} />
              <strong>{t("schedules.list.emptyTitle")}</strong>
              <span>{t("schedules.list.emptyDescription")}</span>
            </div>
          ) : (
            <div className="schedule-list">
              {schedules.map((schedule) => {
                const completed = schedule.frequency === "once" && Boolean(schedule.lastRunAt);
                return (
                  <article className={`schedule-row ${schedule.enabled ? "is-active" : ""}`} key={schedule.id}>
                    <div className="schedule-state-dot" />
                    <div className="schedule-main">
                      <div>
                        <strong>{schedule.name}</strong>
                        <span>{schedule.workflowName} · v{schedule.workflowVersion}</span>
                      </div>
                      <dl>
                        <div>
                          <dt>{t("schedules.list.frequency")}</dt>
                          <dd>{t(`schedules.frequency.${schedule.frequency}`)}</dd>
                        </div>
                        <div>
                          <dt>{t("schedules.list.nextRun")}</dt>
                          <dd>{schedule.nextRunAt
                            ? formatDate(schedule.nextRunAt, i18n.language)
                            : t(completed ? "schedules.list.completed" : "schedules.list.paused")}</dd>
                        </div>
                        <div>
                          <dt>{t("schedules.list.lastRun")}</dt>
                          <dd>{schedule.lastRunAt
                            ? formatDate(schedule.lastRunAt, i18n.language)
                            : t("schedules.list.never")}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="schedule-row-actions">
                      <button
                        aria-label={t(schedule.enabled ? "schedules.actions.pause" : "schedules.actions.resume")}
                        disabled={completed}
                        onClick={() => onToggle(schedule.id)}
                        title={t(schedule.enabled ? "schedules.actions.pause" : "schedules.actions.resume")}
                        type="button"
                      >
                        {schedule.enabled ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                      <button
                        aria-label={t("schedules.actions.delete")}
                        className="danger"
                        onClick={() => onDelete(schedule.id)}
                        title={t("schedules.actions.delete")}
                        type="button"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <p className="scheduler-boundary"><Clock3 size={14} /> {t("schedules.runtimeBoundary")}</p>
    </section>
  );
}

function defaultScheduledAt(): string {
  return formatDateTimeLocal(new Date(Date.now() + 15 * 60_000));
}

function formatDateTimeLocal(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

function formatDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
