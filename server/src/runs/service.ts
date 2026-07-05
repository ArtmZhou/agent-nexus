import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  CreateRunRequest,
  RunEvent,
  RunStatus,
  RunStatusBody,
  RunSummary,
  StoredRunEvent
} from "@agent-nexus/shared";
import { readRunEventsFromLog, readRunIndexSync, writeRunIndex } from "./persistence.js";

export type RunServiceOptions = {
  runsLogDir?: string;
  idGenerator?: () => string;
  now?: () => number;
};

export type RunListFilter = {
  active?: boolean;
  status?: RunStatus | RunStatus[];
};

export type FindLatestSessionOptions = {
  agentId: string;
  cwd?: string | null;
  excludeRunId?: string | null;
};

export type FinishRunOptions = {
  exitCode?: number | null;
  signal?: string | null;
};

export type FailRunOptions = {
  message: string;
  code?: string | null;
  exitCode?: number | null;
  signal?: string | null;
};

export type CancelRunOptions = {
  message?: string | null;
  code?: string | null;
  signal?: string | null;
};

export type StartRunOptions = {
  childPid?: number | null;
  processGroupId?: number | null;
};

export type RunEventListener = (event: StoredRunEvent) => void;

export type RunService = ReturnType<typeof createRunService>;

type RunRecord = {
  request: CreateRunRequest;
  body: RunStatusBody;
  events: StoredRunEvent[];
  listeners: Set<RunEventListener>;
  waiters: Set<(body: RunStatusBody) => void>;
};

const activeStatuses = new Set<RunStatus>(["queued", "running"]);

export function createRunService(options: RunServiceOptions = {}) {
  const now = options.now ?? Date.now;
  const idGenerator = options.idGenerator ?? createDefaultIdGenerator();
  const runs = new Map<string, RunRecord>();
  const summaries = new Map<string, RunSummary>(
    (options.runsLogDir ? readRunIndexSync(options.runsLogDir) : []).map((summary) => [summary.id, cloneSummary(summary)])
  );
  let summaryWriteQueue: Promise<void> = Promise.resolve();

  function create(request: CreateRunRequest): RunStatusBody {
    const id = idGenerator();
    const timestamp = now();
    const eventsLogPath = options.runsLogDir ? join(options.runsLogDir, `${id}.jsonl`) : null;

    const body: RunStatusBody = {
      id,
      agentId: request.agentId,
      sessionId: request.resumeSessionId ?? null,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      cancelRequested: false,
      childPid: null,
      processGroupId: null,
      exitCode: null,
      signal: null,
      error: null,
      errorCode: null,
      eventsLogPath
    };

    runs.set(id, {
      request: cloneRequest(request),
      body,
      events: [],
      listeners: new Set(),
      waiters: new Set()
    });
    void upsertSummary(runs.get(id)!);

    return cloneBody(body);
  }

  function get(id: string): RunStatusBody | null {
    const record = runs.get(id);
    return record ? cloneBody(record.body) : null;
  }

  function list(filter: RunListFilter = {}): RunStatusBody[] {
    const statuses = normalizeStatuses(filter.status);

    return Array.from(runs.values())
      .filter((record) => {
        if (filter.active === true && !activeStatuses.has(record.body.status)) {
          return false;
        }

        if (filter.active === false && activeStatuses.has(record.body.status)) {
          return false;
        }

        return statuses ? statuses.has(record.body.status) : true;
      })
      .map((record) => cloneBody(record.body));
  }

  function listSummaries(filter: RunListFilter = {}): RunSummary[] {
    const statuses = normalizeStatuses(filter.status);

    return Array.from(summaries.values())
      .filter((summary) => {
        if (filter.active === true && !activeStatuses.has(summary.status)) {
          return false;
        }

        if (filter.active === false && activeStatuses.has(summary.status)) {
          return false;
        }

        return statuses ? statuses.has(summary.status) : true;
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(cloneSummary);
  }

  async function emit(id: string, data: RunEvent): Promise<StoredRunEvent> {
    const record = requireRun(id);
    const event: StoredRunEvent = {
      id: record.events.length + 1,
      event: data.type,
      data,
      timestamp: now()
    };

    record.events.push(event);
    record.body.updatedAt = event.timestamp;
    if (data.type === "status" && data.sessionId) {
      record.body.sessionId = data.sessionId;
    }
    await upsertSummary(record);
    await persistEvent(record, event);

    for (const listener of record.listeners) {
      listener(cloneEvent(event));
    }

    return cloneEvent(event);
  }

  function eventsAfter(id: string, afterEventId = 0): StoredRunEvent[] {
    const record = requireRun(id);
    return record.events
      .filter((event) => event.id > afterEventId)
      .map((event) => cloneEvent(event));
  }

  async function eventsAfterAsync(id: string, afterEventId = 0): Promise<StoredRunEvent[]> {
    const record = runs.get(id);
    if (record) {
      return eventsAfter(id, afterEventId);
    }

    const summary = summaries.get(id);
    if (!summary?.eventsLogPath) {
      return [];
    }

    return readRunEventsFromLog(summary.eventsLogPath, afterEventId);
  }

  function statusBody(id: string): RunStatusBody | null {
    return get(id) ?? cloneBodyFromSummary(summaries.get(id));
  }

  function hasInMemoryRun(id: string): boolean {
    return runs.has(id);
  }

  function findLatestSessionId(filter: FindLatestSessionOptions): string | null {
    const cwd = normalizeCwd(filter.cwd);
    const latest = listSummaries()
      .filter((summary) =>
        summary.id !== filter.excludeRunId &&
        summary.agentId === filter.agentId &&
        summary.status === "succeeded" &&
        normalizeCwd(summary.cwd) === cwd &&
        typeof summary.sessionId === "string" &&
        summary.sessionId.trim().length > 0
      )
      .at(0);

    return latest?.sessionId ?? null;
  }

  function start(id: string, startOptions: StartRunOptions = {}): RunStatusBody {
    const record = requireRun(id);

    if (!activeStatuses.has(record.body.status)) {
      return cloneBody(record.body);
    }

    record.body.status = "running";
    record.body.updatedAt = now();
    record.body.childPid = startOptions.childPid ?? record.body.childPid;
    record.body.processGroupId = startOptions.processGroupId ?? record.body.processGroupId;
    void upsertSummary(record);
    return cloneBody(record.body);
  }

  async function finish(id: string, finishOptions: FinishRunOptions = {}): Promise<RunStatusBody> {
    const body = await transitionTerminal(id, "succeeded", {
      exitCode: finishOptions.exitCode ?? 0,
      signal: finishOptions.signal ?? null
    });
    return body;
  }

  async function fail(id: string, failOptions: FailRunOptions): Promise<RunStatusBody> {
    const record = runs.get(id);
    if (record && activeStatuses.has(record.body.status)) {
      const alreadyReported = record.events.some(
        (event) => event.data.type === "error" && event.data.message === failOptions.message
      );

      if (!alreadyReported) {
        await emit(id, {
          type: "error",
          message: failOptions.message,
          code: failOptions.code ?? undefined
        });
      }
    }

    return transitionTerminal(id, "failed", {
      exitCode: failOptions.exitCode ?? null,
      signal: failOptions.signal ?? null,
      error: failOptions.message,
      errorCode: failOptions.code ?? null
    });
  }

  async function cancel(id: string, cancelOptions: CancelRunOptions = {}): Promise<RunStatusBody> {
    return transitionTerminal(id, "canceled", {
      cancelRequested: true,
      signal: cancelOptions.signal ?? null,
      error: cancelOptions.message ?? null,
      errorCode: cancelOptions.code ?? null
    });
  }

  function wait(id: string): Promise<RunStatusBody> {
    const record = requireRun(id);

    if (!activeStatuses.has(record.body.status)) {
      return Promise.resolve(cloneBody(record.body));
    }

    return new Promise((resolve) => {
      record.waiters.add(resolve);
    });
  }

  async function shutdownActive(message = "Run canceled during shutdown"): Promise<RunStatusBody[]> {
    const activeRuns = list({ active: true });
    const shutdowns = activeRuns.map((run) =>
      cancel(run.id, {
        message,
        code: "shutdown"
      })
    );
    return Promise.all(shutdowns);
  }

  function subscribe(id: string, listener: RunEventListener): () => void {
    const record = requireRun(id);
    record.listeners.add(listener);

    return () => {
      record.listeners.delete(listener);
    };
  }

  async function transitionTerminal(
    id: string,
    status: Exclude<RunStatus, "queued" | "running">,
    patch: Partial<RunStatusBody>
  ): Promise<RunStatusBody> {
    const record = requireRun(id);

    if (!activeStatuses.has(record.body.status)) {
      return cloneBody(record.body);
    }

    record.body.status = status;
    record.body.updatedAt = now();
    record.body.exitCode = patch.exitCode ?? record.body.exitCode;
    record.body.signal = patch.signal ?? record.body.signal;
    record.body.error = patch.error ?? record.body.error;
    record.body.errorCode = patch.errorCode ?? record.body.errorCode;

    if (patch.cancelRequested === true) {
      record.body.cancelRequested = true;
    }

    await emit(id, { type: "end", status });
    await upsertSummary(record);
    resolveWaiters(record);
    return cloneBody(record.body);
  }

  function requireRun(id: string): RunRecord {
    const record = runs.get(id);

    if (!record) {
      throw new Error(`Run not found: ${id}`);
    }

    return record;
  }

  async function persistEvent(record: RunRecord, event: StoredRunEvent): Promise<void> {
    if (!record.body.eventsLogPath || !options.runsLogDir) {
      return;
    }

    await mkdir(options.runsLogDir, { recursive: true });
    await appendFile(record.body.eventsLogPath, `${JSON.stringify(event)}\n`, "utf8");
  }

  async function upsertSummary(record: RunRecord): Promise<void> {
    summaries.set(record.body.id, {
      ...cloneBody(record.body),
      prompt: record.request.prompt,
      model: record.request.model ?? null,
      reasoning: record.request.reasoning ?? null,
      cwd: record.request.cwd ?? null,
      extraAllowedDirs: record.request.extraAllowedDirs ? [...record.request.extraAllowedDirs] : []
    });
    await persistSummaries();
  }

  function persistSummaries(): Promise<void> {
    if (!options.runsLogDir) return Promise.resolve();

    summaryWriteQueue = summaryWriteQueue
      .catch(() => undefined)
      .then(() => writeRunIndex(options.runsLogDir!, listSummaries()))
      .catch((error: unknown) => {
        console.error("Unable to persist run history index", error);
      });
    return summaryWriteQueue;
  }

  return {
    create,
    get,
    list,
    listSummaries,
    emit,
    eventsAfter,
    eventsAfterAsync,
    statusBody,
    hasInMemoryRun,
    findLatestSessionId,
    start,
    finish,
    fail,
    cancel,
    wait,
    shutdownActive,
    subscribe
  };
}

function createDefaultIdGenerator(): () => string {
  return () => `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStatuses(status?: RunStatus | RunStatus[]): Set<RunStatus> | null {
  if (!status) {
    return null;
  }

  return new Set(Array.isArray(status) ? status : [status]);
}

function resolveWaiters(record: RunRecord): void {
  const body = cloneBody(record.body);

  for (const resolve of record.waiters) {
    resolve(body);
  }

  record.waiters.clear();
}

function cloneBody(body: RunStatusBody): RunStatusBody {
  return { ...body };
}

function cloneBodyFromSummary(summary: RunSummary | undefined): RunStatusBody | null {
  if (!summary) return null;

  const {
    prompt: _prompt,
    model: _model,
    reasoning: _reasoning,
    cwd: _cwd,
    extraAllowedDirs: _extraAllowedDirs,
    ...body
  } = summary;

  return cloneBody(body);
}

function cloneSummary(summary: RunSummary): RunSummary {
  return {
    ...summary,
    sessionId: summary.sessionId ?? null,
    extraAllowedDirs: summary.extraAllowedDirs ? [...summary.extraAllowedDirs] : []
  };
}

function cloneEvent(event: StoredRunEvent): StoredRunEvent {
  return {
    ...event,
    data: { ...event.data }
  };
}

function cloneRequest(request: CreateRunRequest): CreateRunRequest {
  return {
    ...request,
    extraAllowedDirs: request.extraAllowedDirs ? [...request.extraAllowedDirs] : undefined
  };
}

function normalizeCwd(cwd: string | null | undefined): string {
  const trimmed = (cwd ?? "").trim();
  if (!trimmed) return "";

  const slashed = trimmed.replace(/\\/gu, "/");
  const isUnc = slashed.startsWith("//") && !slashed.startsWith("///");
  let normalized = slashed.replace(/\/+/gu, "/");
  if (isUnc) {
    normalized = `/${normalized}`;
  }
  while (normalized.length > 3 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return /^[a-z]:/iu.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
}
