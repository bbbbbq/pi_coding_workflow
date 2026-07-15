import { readFile } from "node:fs/promises";
import { parse, stringify } from "yaml";

export async function readStructuredInput(reference: string): Promise<unknown> {
  const source = reference === "-"
    ? await readStdin()
    : reference.startsWith("@")
      ? await readFile(reference.slice(1), "utf8")
      : await readFile(reference, "utf8");
  try {
    return parse(source) as unknown;
  } catch (error) {
    throw new Error(`Unable to parse JSON/YAML input: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function readInlineOrReferencedInput(value: string): Promise<unknown> {
  if (value === "-" || value.startsWith("@")) return readStructuredInput(value);
  try {
    return parse(value) as unknown;
  } catch (error) {
    throw new Error(`Unable to parse JSON/YAML value: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function writeOutput(value: unknown, json: boolean): void {
  const output = json
    ? JSON.stringify(value, null, 2)
    : stringify(value, { indent: 2, lineWidth: 100 }).trimEnd();
  process.stdout.write(`${output}\n`);
}

export function writeError(value: unknown, json: boolean): void {
  const output = json
    ? JSON.stringify(value)
    : typeof value === "string"
      ? value
      : stringify(value, { indent: 2, lineWidth: 100 }).trimEnd();
  process.stderr.write(`${output}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
