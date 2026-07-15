export const localRuntimeMethods = [
  "workflow.list",
  "workflow.get",
  "workflow.create",
  "workflow.apply",
  "workflow.validate",
  "workflow.publish",
  "workflow.delete",
  "node.add",
  "node.update",
  "node.enable",
  "node.disable",
  "node.remove",
  "edge.connect",
  "provider.list",
  "provider.test",
  "route.list",
  "route.resolve",
] as const;

export type LocalRuntimeMethod = (typeof localRuntimeMethods)[number];

export interface LocalRuntimeRequest {
  id: string;
  method: LocalRuntimeMethod;
  params?: Record<string, unknown>;
}

export interface LocalRuntimeErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export type LocalRuntimeResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: LocalRuntimeErrorPayload };
