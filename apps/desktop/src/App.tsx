import { FormEvent, useMemo, useState } from "react";
import "./App.css";

type RunStatus = "running" | "review" | "complete";

type Run = {
  id: string;
  title: string;
  repository: string;
  status: RunStatus;
  updatedAt: string;
};

const workflowSteps = [
  "Prepare workspace",
  "Analyze repository",
  "Approve plan",
  "Implement with Pi",
  "Validate changes",
  "Review and deliver",
];

const initialRuns: Run[] = [
  {
    id: "RUN-042",
    title: "Repair flaky scheduler tests",
    repository: "orbit/runtime",
    status: "running",
    updatedAt: "2 min",
  },
  {
    id: "RUN-041",
    title: "Add workspace import command",
    repository: "forge/desktop",
    status: "review",
    updatedAt: "18 min",
  },
  {
    id: "RUN-040",
    title: "Migrate configuration parser",
    repository: "core/config",
    status: "complete",
    updatedAt: "1 hr",
  },
];

const statusLabels: Record<RunStatus, string> = {
  running: "Running",
  review: "Needs review",
  complete: "Complete",
};

function App() {
  const [repository, setRepository] = useState("/Users/you/code/project");
  const [task, setTask] = useState(
    "Describe the change, constraints, and the validation commands Pi should satisfy.",
  );
  const [runs, setRuns] = useState(initialRuns);
  const [selectedRun, setSelectedRun] = useState(initialRuns[0].id);

  const activeRun = useMemo(
    () => runs.find((run) => run.id === selectedRun) ?? runs[0],
    [runs, selectedRun],
  );

  function startRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextId = `RUN-${String(43 + runs.length - initialRuns.length).padStart(3, "0")}`;
    const title = task.trim().split(/[.!?。！？]/)[0] || "Untitled coding task";
    const nextRun: Run = {
      id: nextId,
      title,
      repository: repository.split("/").filter(Boolean).slice(-2).join("/") || repository,
      status: "running",
      updatedAt: "now",
    };

    setRuns((current) => [nextRun, ...current]);
    setSelectedRun(nextId);
  }

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand-mark" aria-label="Pi Workflow">
          <span>π</span>
        </div>

        <nav className="rail-nav" aria-label="Primary navigation">
          <button className="rail-button is-active" aria-label="Workspace">
            W
          </button>
          <button className="rail-button" aria-label="Runs">
            R
          </button>
          <button className="rail-button" aria-label="Policies">
            P
          </button>
        </nav>

        <button className="rail-button rail-settings" aria-label="Settings">
          S
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">LOCAL CODING OPERATIONS</p>
            <h1>Pi Workflow</h1>
          </div>

          <div className="topbar-meta">
            <div className="platforms" aria-label="Supported platforms">
              <span>macOS</span>
              <span>Windows</span>
              <span>Linux</span>
            </div>
            <div className="runtime-status">
              <i /> Prototype ready
            </div>
          </div>
        </header>

        <section className="command-grid">
          <form className="task-composer" onSubmit={startRun}>
            <div className="section-heading">
              <div>
                <p className="section-index">01 / NEW RUN</p>
                <h2>Turn a request into a reviewed change.</h2>
              </div>
              <span className="mode-chip">PI EXECUTOR</span>
            </div>

            <label>
              <span>Repository workspace</span>
              <input
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                spellCheck={false}
              />
            </label>

            <label>
              <span>Coding task</span>
              <textarea
                value={task}
                onChange={(event) => setTask(event.target.value)}
                rows={5}
              />
            </label>

            <div className="composer-footer">
              <p>
                <strong>Policy:</strong> plan approval · isolated worktree · validation gate
              </p>
              <button className="launch-button" type="submit">
                Start workflow <span>↗</span>
              </button>
            </div>
          </form>

          <aside className="workflow-panel">
            <div className="panel-head">
              <div>
                <p className="section-index">02 / LIVE GRAPH</p>
                <h3>{activeRun?.id ?? "NO RUN"}</h3>
              </div>
              <span className={`status-pill ${activeRun?.status ?? "complete"}`}>
                {activeRun ? statusLabels[activeRun.status] : "Idle"}
              </span>
            </div>

            <ol className="workflow-list">
              {workflowSteps.map((step, index) => {
                const activeIndex = activeRun?.status === "review" ? 5 : activeRun?.status === "complete" ? 6 : 3;
                const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "waiting";

                return (
                  <li className={state} key={step}>
                    <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
                    <span className="step-label">{step}</span>
                    <span className="step-state">
                      {state === "done" ? "done" : state === "active" ? "working" : "queued"}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div className="workflow-note">
              <span>Temporal boundary</span>
              Pi owns the inner edit loop. The workflow owns retries, approvals, and delivery.
            </div>
          </aside>
        </section>

        <section className="runs-panel">
          <div className="runs-heading">
            <div>
              <p className="section-index">03 / RECENT RUNS</p>
              <h2>Execution ledger</h2>
            </div>
            <button type="button">View all →</button>
          </div>

          <div className="run-table" role="table" aria-label="Recent coding runs">
            {runs.map((run) => (
              <button
                className={`run-row ${selectedRun === run.id ? "is-selected" : ""}`}
                key={run.id}
                onClick={() => setSelectedRun(run.id)}
                type="button"
              >
                <span className="run-id">{run.id}</span>
                <span className="run-title">
                  <strong>{run.title}</strong>
                  <small>{run.repository}</small>
                </span>
                <span className={`run-status ${run.status}`}>{statusLabels[run.status]}</span>
                <span className="run-time">{run.updatedAt}</span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
