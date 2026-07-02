import { mkdir, rename, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunStatus, RunSummary } from "@agent-nexus/shared";

export const RUN_INDEX_FILE = "index.json";

type RunIndexFile = {
  runs: RunSummary[];
};

const runStatuses = new Set<RunStatus>(["queued", "running", "succeeded", "failed", "canceled"]);

export function readRunIndexSync(runsLogDir: string): RunSummary[] {
  try {
    const path = runIndexPath(runsLogDir);
    if (!existsSync(path)) return [];
    return parseRunIndex(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

export async function writeRunIndex(runsLogDir: string, runs: RunSummary[]): Promise<void> {
  await mkdir(runsLogDir, { recursive: true });
  const target = runIndexPath(runsLogDir);
  const temp = `${target}.tmp`;
  const body: RunIndexFile = {
    runs: [...runs].sort((a, b) => b.createdAt - a.createdAt)
  };
  await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

export function runIndexPath(runsLogDir: string): string {
  return join(runsLogDir, RUN_INDEX_FILE);
}

function parseRunIndex(raw: string): RunSummary[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!isObject(parsed) || !Array.isArray(parsed.runs)) return [];
  return parsed.runs.filter(isRunSummary).map(cloneSummary);
}

function isRunSummary(input: unknown): input is RunSummary {
  return isObject(input) &&
    typeof input.id === "string" &&
    typeof input.agentId === "string" &&
    typeof input.prompt === "string" &&
    typeof input.status === "string" &&
    runStatuses.has(input.status as RunStatus) &&
    typeof input.createdAt === "number" &&
    typeof input.updatedAt === "number" &&
    typeof input.cancelRequested === "boolean" &&
    isNullableNumber(input.childPid) &&
    isNullableNumber(input.processGroupId) &&
    isNullableNumber(input.exitCode) &&
    isNullableString(input.signal) &&
    isNullableString(input.error) &&
    isNullableString(input.errorCode) &&
    isNullableString(input.eventsLogPath) &&
    isOptionalNullableString(input.model) &&
    isOptionalNullableString(input.reasoning) &&
    isOptionalNullableString(input.cwd) &&
    (input.extraAllowedDirs === undefined || isStringArray(input.extraAllowedDirs));
}

function cloneSummary(summary: RunSummary): RunSummary {
  return {
    ...summary,
    extraAllowedDirs: summary.extraAllowedDirs ? [...summary.extraAllowedDirs] : []
  };
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isNullableNumber(input: unknown): input is number | null {
  return input === null || typeof input === "number";
}

function isNullableString(input: unknown): input is string | null {
  return input === null || typeof input === "string";
}

function isOptionalNullableString(input: unknown): input is string | null | undefined {
  return input === undefined || isNullableString(input);
}

function isStringArray(input: unknown): input is string[] {
  return Array.isArray(input) && input.every((item) => typeof item === "string");
}
