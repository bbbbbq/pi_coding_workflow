import type {
  RegisterTemporalScheduleRequest,
  StartTemporalRunRequest,
  TemporalApprovalRequest,
  TemporalHealth,
  TemporalRunRef,
  TemporalScheduleRef,
} from "@pi-workflow/contracts";
import { OrchestratorApplicationService } from "@pi-workflow/application-service/orchestrator-client";

export const temporalApiBaseUrl = (import.meta.env.VITE_TEMPORAL_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
export const orchestratorApplication = new OrchestratorApplicationService(temporalApiBaseUrl);

export async function getTemporalHealth(): Promise<TemporalHealth> {
  return request<TemporalHealth>("/health");
}

export async function startTemporalRun(requestBody: StartTemporalRunRequest): Promise<TemporalRunRef> {
  return request<TemporalRunRef>("/v1/runs", {
    method: "POST",
    body: JSON.stringify(requestBody),
  });
}

export async function registerTemporalSchedule(
  requestBody: RegisterTemporalScheduleRequest,
): Promise<TemporalScheduleRef> {
  return request<TemporalScheduleRef>("/v1/schedules", {
    method: "POST",
    body: JSON.stringify(requestBody),
  });
}

export async function describeTemporalSchedule(scheduleId: string): Promise<TemporalScheduleRef> {
  return request<TemporalScheduleRef>(`/v1/schedules/${encodeURIComponent(scheduleId)}`);
}

export async function pauseTemporalSchedule(scheduleId: string): Promise<TemporalScheduleRef> {
  return request<TemporalScheduleRef>(`/v1/schedules/${encodeURIComponent(scheduleId)}/pause`, { method: "POST" });
}

export async function resumeTemporalSchedule(scheduleId: string): Promise<TemporalScheduleRef> {
  return request<TemporalScheduleRef>(`/v1/schedules/${encodeURIComponent(scheduleId)}/resume`, { method: "POST" });
}

export async function deleteTemporalSchedule(scheduleId: string): Promise<void> {
  await request<void>(`/v1/schedules/${encodeURIComponent(scheduleId)}`, { method: "DELETE" });
}

export async function pauseTemporalRun(workflowId: string): Promise<void> {
  await request<void>(`/v1/runs/${encodeURIComponent(workflowId)}/pause`, { method: "POST" });
}

export async function resumeTemporalRun(workflowId: string): Promise<void> {
  await request<void>(`/v1/runs/${encodeURIComponent(workflowId)}/resume`, { method: "POST" });
}

export async function cancelTemporalRun(workflowId: string): Promise<void> {
  await request<void>(`/v1/runs/${encodeURIComponent(workflowId)}/cancel`, { method: "POST" });
}

export async function approveTemporalRun(
  workflowId: string,
  body: TemporalApprovalRequest,
): Promise<void> {
  await request<void>(`/v1/runs/${encodeURIComponent(workflowId)}/approval`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${temporalApiBaseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Keep the HTTP status when the server did not return JSON.
    }
    throw new Error(`Temporal API request failed: ${message}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
