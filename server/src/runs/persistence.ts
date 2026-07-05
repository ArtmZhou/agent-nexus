import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunStatus, RunSummary, StoredRunEvent } from "@agent-nexus/shared";

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

export async function readRunEventsFromLog(eventsLogPath: string, afterEventId = 0): Promise<StoredRunEvent[]> {
  try {
    const raw = await readFile(eventsLogPath, "utf8");
    const events: StoredRunEvent[] = [];
    let malformed = false;
    let lastSeenId = afterEventId;

    for (const line of raw.split(/\r?\n/u)) {
      if (!line.trim()) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        malformed = true;
        continue;
      }

      if (!isStoredRunEvent(parsed)) {
        malformed = true;
        continue;
      }

      lastSeenId = Math.max(lastSeenId, parsed.id);
      if (parsed.id > afterEventId) {
        events.push(parsed);
      }
    }

    if (malformed) {
      events.push(replayErrorEvent(lastSeenId));
    }

    return events;
  } catch {
    return [replayErrorEvent(afterEventId)];
  }
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
    isOptionalNullableString(input.sessionId) &&
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

function isStoredRunEvent(input: unknown): input is StoredRunEvent {
  return isObject(input) &&
    typeof input.id === "number" &&
    Number.isFinite(input.id) &&
    typeof input.event === "string" &&
    typeof input.timestamp === "number" &&
    Number.isFinite(input.timestamp) &&
    isObject(input.data) &&
    typeof input.data.type === "string";
}

function replayErrorEvent(afterEventId: number): StoredRunEvent {
  return {
    id: afterEventId + 1,
    event: "error",
    timestamp: Date.now(),
    data: {
      type: "error",
      message: "Unable to replay stored run events",
      code: "run.events_replay_failed"
    }
  };
}

function cloneSummary(summary: RunSummary): RunSummary {
  return {
    ...summary,
    sessionId: summary.sessionId ?? null,
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
