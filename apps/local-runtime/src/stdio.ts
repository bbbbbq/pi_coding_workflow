#!/usr/bin/env node
import { createInterface } from "node:readline";
import { LocalRuntime } from "./runtime.js";
import type { LocalRuntimeRequest, LocalRuntimeResponse } from "./protocol.js";

const runtime = LocalRuntime.open();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

try {
  for await (const line of lines) {
    if (!line.trim()) continue;
    const response = await handleLine(line);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
} finally {
  runtime.close();
}

async function handleLine(line: string): Promise<LocalRuntimeResponse> {
  try {
    const request = JSON.parse(line) as Partial<LocalRuntimeRequest>;
    if (typeof request.id !== "string" || typeof request.method !== "string") {
      throw new Error("Request id and method are required.");
    }
    return runtime.request(request as LocalRuntimeRequest);
  } catch (error) {
    return {
      id: "",
      ok: false,
      error: {
        code: "invalid_request",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
