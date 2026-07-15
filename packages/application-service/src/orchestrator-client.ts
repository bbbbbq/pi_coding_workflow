import type {
  ApprovalDecision,
  ModelProvider,
  ModelRoute,
  ProviderHealth,
  RegisterTemporalScheduleRequest,
  StartTemporalRunRequest,
  TemporalHealth,
  TemporalRunRef,
  TemporalScheduleRef,
} from "@pi-workflow/contracts";

export interface RemoteRunSummary {
  workflowId: string;
  runId: string;
  status: string;
  startedAt?: string;
  closedAt?: string;
}

export interface RemoteRunDescription extends RemoteRunSummary {
  state?: unknown;
}

export interface ModelRouteResolution {
  routeId: string;
  providerId: string;
  modelId: string;
}

export type RunControlOperation = "pause" | "resume" | "cancel";
export type ScheduleControlOperation = "pause" | "resume" | "trigger";

export class OrchestratorClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "OrchestratorClientError";
  }
}

export class OrchestratorApplicationService {
  private readonly baseUrl: string;

  constructor(baseUrl = "http://127.0.0.1:8787", private readonly fetcher: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  health(): Promise<TemporalHealth> {
    return this.request<TemporalHealth>("/health");
  }

  startRun(input: StartTemporalRunRequest): Promise<TemporalRunRef> {
    return this.request<TemporalRunRef>("/v1/runs", { method: "POST", body: JSON.stringify(input) });
  }

  listRuns(): Promise<RemoteRunSummary[]> {
    return this.request<RemoteRunSummary[]>("/v1/runs");
  }

  inspectRun(workflowId: string): Promise<RemoteRunDescription> {
    return this.request<RemoteRunDescription>(`/v1/runs/${encodeURIComponent(workflowId)}`);
  }

  async controlRun(workflowId: string, operation: RunControlOperation): Promise<void> {
    await this.request<void>(`/v1/runs/${encodeURIComponent(workflowId)}/${operation}`, { method: "POST" });
  }

  async approveRun(workflowId: string, decision: ApprovalDecision): Promise<void> {
    await this.request<void>(`/v1/runs/${encodeURIComponent(workflowId)}/approval`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
  }

  registerSchedule(input: RegisterTemporalScheduleRequest): Promise<TemporalScheduleRef> {
    return this.request<TemporalScheduleRef>("/v1/schedules", { method: "POST", body: JSON.stringify(input) });
  }

  describeSchedule(scheduleId: string): Promise<TemporalScheduleRef> {
    return this.request<TemporalScheduleRef>(`/v1/schedules/${encodeURIComponent(scheduleId)}`);
  }

  controlSchedule(scheduleId: string, operation: ScheduleControlOperation): Promise<TemporalScheduleRef> {
    return this.request<TemporalScheduleRef>(`/v1/schedules/${encodeURIComponent(scheduleId)}/${operation}`, {
      method: "POST",
    });
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    await this.request<void>(`/v1/schedules/${encodeURIComponent(scheduleId)}`, { method: "DELETE" });
  }

  listProviders(): Promise<ModelProvider[]> {
    return this.request<ModelProvider[]>("/v1/providers");
  }

  testProvider(providerId: string): Promise<ProviderHealth> {
    return this.request<ProviderHealth>(`/v1/providers/${encodeURIComponent(providerId)}/test`, { method: "POST" });
  }

  listRoutes(): Promise<ModelRoute[]> {
    return this.request<ModelRoute[]>("/v1/routes");
  }

  resolveRoute(routeId: string): Promise<ModelRouteResolution> {
    return this.request<ModelRouteResolution>(`/v1/routes/${encodeURIComponent(routeId)}/resolve`, { method: "POST" });
  }

  private async request<Result>(path: string, options: RequestInit = {}): Promise<Result> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...options,
        headers: { "content-type": "application/json", ...options.headers },
      });
    } catch (error) {
      throw new OrchestratorClientError(
        0,
        "orchestrator_unavailable",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!response.ok) {
      let body: { error?: string; message?: string; details?: unknown } = {};
      try {
        body = await response.json() as typeof body;
      } catch {
        // Keep the HTTP status when the server does not return JSON.
      }
      throw new OrchestratorClientError(
        response.status,
        body.error ?? "orchestrator_error",
        body.message ?? `${response.status} ${response.statusText}`,
        body.details,
      );
    }
    if (response.status === 204) return undefined as Result;
    return response.json() as Promise<Result>;
  }
}
