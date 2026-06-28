import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  CreateRunRequest,
  RunEvent,
  RunStatus,
  RunStatusBody,
  StoredRunEvent
} from "@agent-nexus/shared";

export type RunServiceOptions = {
  runsLogDir?: string;
  idGenerator?: () => string;
  now?: () => number;
};

export type RunListFilter = {
  active?: boolean;
  status?: RunStatus | RunStatus[];
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

  function create(request: CreateRunRequest): RunStatusBody {
    const id = idGenerator();
    const timestamp = now();
    const eventsLogPath = options.runsLogDir ? join(options.runsLogDir, `${id}.jsonl`) : null;

    const body: RunStatusBody = {
      id,
      agentId: request.agentId,
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

  function statusBody(id: string): RunStatusBody | null {
    return get(id);
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

  return {
    create,
    get,
    list,
    emit,
    eventsAfter,
    statusBody,
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
