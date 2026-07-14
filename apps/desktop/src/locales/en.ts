export default {
  language: {
    label: "Language",
  },
  navigation: {
    primary: "Primary navigation",
    workspace: "Workspace",
    runs: "Runs",
    policies: "Policies",
    settings: "Settings",
  },
  header: {
    eyebrow: "LOCAL CODING OPERATIONS",
    supportedPlatforms: "Supported platforms",
    ready: "Prototype ready",
  },
  composer: {
    index: "01 / NEW RUN",
    title: "Turn a request into a reviewed change.",
    executor: "PI EXECUTOR",
    repository: "Repository workspace",
    task: "Coding task",
    taskPlaceholder:
      "Describe the change, constraints, and the validation commands Pi should satisfy.",
    policyLabel: "Policy:",
    policy: "plan approval · isolated worktree · validation gate",
    start: "Start workflow",
  },
  workflow: {
    index: "02 / LIVE GRAPH",
    noRun: "NO RUN",
    boundary: "Temporal boundary",
    boundaryDescription:
      "Pi owns the inner edit loop. The workflow owns retries, approvals, and delivery.",
    steps: {
      prepare: "Prepare workspace",
      analyze: "Analyze repository",
      approve: "Approve plan",
      implement: "Implement with Pi",
      validate: "Validate changes",
      deliver: "Review and deliver",
    },
    states: {
      done: "done",
      working: "working",
      queued: "queued",
    },
  },
  runs: {
    index: "03 / RECENT RUNS",
    title: "Execution ledger",
    viewAll: "View all",
    ariaLabel: "Recent coding runs",
    untitled: "Untitled coding task",
    mock: {
      scheduler: "Repair flaky scheduler tests",
      importCommand: "Add workspace import command",
      configParser: "Migrate configuration parser",
    },
    time: {
      now: "now",
      twoMinutes: "2 min",
      eighteenMinutes: "18 min",
      oneHour: "1 hr",
    },
  },
  status: {
    running: "Running",
    review: "Needs review",
    complete: "Complete",
    idle: "Idle",
  },
} as const;
