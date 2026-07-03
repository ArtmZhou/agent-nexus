import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { CreateRunRequest, RunEvent } from "@agent-nexus/shared";
import * as persistence from "../../src/runs/persistence.js";
import { createRunService } from "../../src/runs/service.js";

const createdDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "agent-nexus-runs-"));
  createdDirs.push(dir);
  return dir;
}

function request(overrides: Partial<CreateRunRequest> = {}): CreateRunRequest {
  return {
    agentId: "codex",
    prompt: "build the thing",
    cwd: "D:\\codes\\agent-nexus",
    model: "gpt-5",
    reasoning: null,
    extraAllowedDirs: [],
    ...overrides
  };
}

describe("createRunService", () => {
  test("creates, reads, and filters run status bodies", async () => {
    let now = 1000;
    const service = createRunService({
      idGenerator: () => "run_1",
      now: () => now
    });

    const created = service.create(request());

    expect(created).toMatchObject({
      id: "run_1",
      agentId: "codex",
      sessionId: null,
      status: "queued",
      createdAt: 1000,
      updatedAt: 1000,
      cancelRequested: false,
      childPid: null,
      processGroupId: null,
      exitCode: null,
      signal: null,
      error: null,
      errorCode: null,
      eventsLogPath: null
    });
    expect(service.get("run_1")).toEqual(created);
    expect(service.statusBody("run_1")).toEqual(created);
    expect(service.get("missing")).toBeNull();
    expect(service.list({ active: true })).toEqual([created]);
    expect(service.list({ status: "queued" })).toEqual([created]);

    now = 1500;
    const started = service.start("run_1", { childPid: 123, processGroupId: 123 });
    expect(started).toMatchObject({
      status: "running",
      updatedAt: 1500,
      childPid: 123,
      processGroupId: 123
    });

    now = 2000;
    await service.finish("run_1", { exitCode: 0 });

    expect(service.list({ active: true })).toEqual([]);
    expect(service.list({ status: "succeeded" })).toHaveLength(1);
  });

  test("stores events, returns events after a cursor, notifies listeners, and writes JSONL", async () => {
    const runsLogDir = await tempDir();
    let now = 10;
    const service = createRunService({
      idGenerator: () => "run_events",
      now: () => now,
      runsLogDir
    });
    const seen: RunEvent[] = [];

    const run = service.create(request());
    const unsubscribe = service.subscribe(run.id, (event) => {
      seen.push(event.data);
    });

    now = 11;
    const first = await service.emit(run.id, { type: "status", label: "Starting" });
    now = 12;
    const second = await service.emit(run.id, { type: "text_delta", delta: "hello" });
    unsubscribe();
    now = 13;
    await service.emit(run.id, { type: "text_delta", delta: " ignored by listener" });

    expect(first).toMatchObject({
      id: 1,
      event: "status",
      timestamp: 11,
      data: { type: "status", label: "Starting" }
    });
    expect(second).toMatchObject({ id: 2, event: "text_delta", timestamp: 12 });
    expect(service.eventsAfter(run.id, 1).map((event) => event.id)).toEqual([2, 3]);
    expect(seen).toEqual([
      { type: "status", label: "Starting" },
      { type: "text_delta", delta: "hello" }
    ]);

    const body = service.statusBody(run.id);
    expect(body?.eventsLogPath).toBe(join(runsLogDir, "run_events.jsonl"));
    const jsonl = await readFile(join(runsLogDir, "run_events.jsonl"), "utf8");
    expect(jsonl.trim().split("\n").map((line) => JSON.parse(line))).toEqual(
      service.eventsAfter(run.id, 0)
    );
  });

  test("resolves waiters when a run finishes", async () => {
    const service = createRunService({
      idGenerator: () => "run_wait",
      now: () => 1
    });
    const run = service.create(request());
    const waiter = service.wait(run.id);

    const finished = await service.finish(run.id, { exitCode: 0 });

    await expect(waiter).resolves.toEqual(finished);
    expect(service.eventsAfter(run.id, 0).at(-1)?.data).toEqual({
      type: "end",
      status: "succeeded"
    });
  });

  test("records failures as terminal run state", async () => {
    const service = createRunService({
      idGenerator: () => "run_fail",
      now: () => 1
    });
    const run = service.create(request());

    const failed = await service.fail(run.id, {
      message: "agent exited badly",
      code: "agent.exit",
      exitCode: 2,
      signal: null
    });

    expect(failed).toMatchObject({
      status: "failed",
      error: "agent exited badly",
      errorCode: "agent.exit",
      exitCode: 2,
      signal: null
    });
    await expect(service.wait(run.id)).resolves.toEqual(failed);
  });

  test("cancels runs and shuts down remaining active runs", async () => {
    let nextId = 1;
    const service = createRunService({
      idGenerator: () => `run_${nextId++}`,
      now: () => 1
    });
    const first = service.create(request());
    const second = service.create(request({ prompt: "another run" }));

    const canceled = await service.cancel(first.id);

    expect(canceled).toMatchObject({
      id: first.id,
      status: "canceled",
      cancelRequested: true
    });
    expect(service.list({ active: true }).map((run) => run.id)).toEqual([second.id]);

    const shutdown = await service.shutdownActive("server shutting down");

    expect(shutdown).toHaveLength(1);
    expect(shutdown[0]).toMatchObject({
      id: second.id,
      status: "canceled",
      cancelRequested: true,
      error: "server shutting down",
      errorCode: "shutdown"
    });
    expect(service.list({ active: true })).toEqual([]);
  });

  test("persists run summaries and restores them in a new service instance", async () => {
    const runsLogDir = await tempDir();
    let now = 100;
    const firstService = createRunService({
      idGenerator: () => "run_persisted",
      now: () => now,
      runsLogDir
    });

    const created = firstService.create(request({
      prompt: "remember this run",
      model: "gpt-5",
      reasoning: "high",
      cwd: "D:/work",
      extraAllowedDirs: ["D:/shared"]
    }));
    now = 110;
    firstService.start(created.id, { childPid: 123, processGroupId: 123 });
    now = 120;
    await firstService.finish(created.id, { exitCode: 0 });

    const restoredService = createRunService({
      now: () => 200,
      runsLogDir
    });

    expect(restoredService.listSummaries()).toEqual([
      expect.objectContaining({
        id: "run_persisted",
        agentId: "codex",
        status: "succeeded",
        prompt: "remember this run",
        model: "gpt-5",
        reasoning: "high",
        cwd: "D:/work",
        extraAllowedDirs: ["D:/shared"],
        childPid: 123,
        processGroupId: 123,
        exitCode: 0,
        eventsLogPath: join(runsLogDir, "run_persisted.jsonl")
      })
    ]);
  });

  test("ignores malformed run index files instead of crashing", async () => {
    const runsLogDir = await tempDir();
    await mkdir(runsLogDir, { recursive: true });
    await writeFile(join(runsLogDir, "index.json"), "{not-json", "utf8");

    const service = createRunService({ runsLogDir });

    expect(service.listSummaries()).toEqual([]);
  });

  test("skips invalid records when restoring a mixed run index", async () => {
    const runsLogDir = await tempDir();
    await mkdir(runsLogDir, { recursive: true });
    await writeFile(join(runsLogDir, "index.json"), JSON.stringify({
      runs: [
        {
          id: "run_valid",
          agentId: "codex",
          status: "succeeded",
          createdAt: 100,
          updatedAt: 110,
          cancelRequested: false,
          childPid: null,
          processGroupId: null,
          exitCode: 0,
          signal: null,
          error: null,
          errorCode: null,
          eventsLogPath: join(runsLogDir, "run_valid.jsonl"),
          prompt: "valid",
          model: null,
          reasoning: "high",
          cwd: "D:/work",
          extraAllowedDirs: ["D:/shared"]
        },
        {
          id: "run_bad_status",
          agentId: "codex",
          status: "finished",
          createdAt: 100,
          updatedAt: 110,
          cancelRequested: false,
          childPid: null,
          processGroupId: null,
          exitCode: 0,
          signal: null,
          error: null,
          errorCode: null,
          eventsLogPath: null,
          prompt: "invalid status"
        },
        {
          id: "run_bad_pid",
          agentId: "codex",
          status: "succeeded",
          createdAt: 100,
          updatedAt: 110,
          cancelRequested: false,
          childPid: "123",
          processGroupId: null,
          exitCode: 0,
          signal: null,
          error: null,
          errorCode: null,
          eventsLogPath: null,
          prompt: "invalid pid"
        },
        {
          id: "run_bad_dirs",
          agentId: "codex",
          status: "succeeded",
          createdAt: 100,
          updatedAt: 110,
          cancelRequested: false,
          childPid: null,
          processGroupId: null,
          exitCode: 0,
          signal: null,
          error: null,
          errorCode: null,
          eventsLogPath: null,
          prompt: "invalid dirs",
          extraAllowedDirs: [123]
        }
      ]
    }), "utf8");

    const service = createRunService({ runsLogDir });

    expect(service.listSummaries()).toEqual([
      expect.objectContaining({
        id: "run_valid",
        status: "succeeded",
        prompt: "valid",
        childPid: null,
        extraAllowedDirs: ["D:/shared"]
      })
    ]);
  });

  test("run lifecycle methods do not reject when run index writes fail", async () => {
    const runsLogDir = await tempDir();
    const service = createRunService({
      idGenerator: () => "run_write_failure",
      runsLogDir
    });
    const run = service.create(request());
    vi.spyOn(persistence, "writeRunIndex").mockRejectedValue(new Error("index unavailable"));

    await expect(service.finish(run.id)).resolves.toMatchObject({
      id: run.id,
      status: "succeeded"
    });
  });

  test("restores historical events from a persisted JSONL log", async () => {
    const runsLogDir = await tempDir();
    const firstService = createRunService({
      idGenerator: () => "run_replay",
      now: incrementingClock(),
      runsLogDir
    });
    const run = firstService.create(request({ prompt: "replay me" }));
    await firstService.emit(run.id, { type: "text_delta", delta: "saved output" });
    await firstService.finish(run.id);

    const restoredService = createRunService({ runsLogDir });

    expect(await restoredService.eventsAfterAsync(run.id, 0)).toEqual([
      expect.objectContaining({ id: 1, event: "text_delta", data: { type: "text_delta", delta: "saved output" } }),
      expect.objectContaining({ id: 2, event: "end", data: { type: "end", status: "succeeded" } })
    ]);
  });

  test("captures the latest durable session id for future turns in the same workspace", async () => {
    let nextId = 1;
    const service = createRunService({
      idGenerator: () => `run_session_${nextId++}`,
      now: incrementingClock()
    });

    const first = service.create(request({ agentId: "claude", cwd: "D:/repo" }));
    await service.emit(first.id, { type: "status", label: "init", sessionId: "claude-session-1" });
    await service.finish(first.id);
    const second = service.create(request({ agentId: "claude", cwd: "D:/repo" }));

    expect(service.statusBody(first.id)?.sessionId).toBe("claude-session-1");
    expect(service.listSummaries()[1]).toMatchObject({
      id: first.id,
      sessionId: "claude-session-1"
    });
    expect(service.findLatestSessionId({
      agentId: "claude",
      cwd: "D:/repo",
      excludeRunId: second.id
    })).toBe("claude-session-1");
  });

  test("matches durable sessions across equivalent Windows working paths", async () => {
    let nextId = 1;
    const service = createRunService({
      idGenerator: () => `run_path_${nextId++}`,
      now: incrementingClock()
    });

    const first = service.create(request({ agentId: "codex", cwd: "D:\\Repo\\Project\\" }));
    await service.emit(first.id, { type: "status", label: "thread.started", sessionId: "thread-1" });
    await service.finish(first.id);

    expect(service.findLatestSessionId({
      agentId: "codex",
      cwd: "d:/repo/project"
    })).toBe("thread-1");
  });

  test("filters restored historical events after a cursor", async () => {
    const runsLogDir = await tempDir();
    const firstService = createRunService({
      idGenerator: () => "run_replay_cursor",
      now: incrementingClock(),
      runsLogDir
    });
    const run = firstService.create(request({ prompt: "replay after cursor" }));
    await firstService.emit(run.id, { type: "text_delta", delta: "first" });
    await firstService.emit(run.id, { type: "text_delta", delta: "second" });
    await firstService.finish(run.id);

    const restoredService = createRunService({ runsLogDir });

    expect((await restoredService.eventsAfterAsync(run.id, 1)).map((event) => event.id)).toEqual([2, 3]);
  });

  test("returns a clear error event for missing restored event logs", async () => {
    const runsLogDir = await tempDir();
    const firstService = createRunService({
      idGenerator: () => "run_missing_log",
      now: incrementingClock(),
      runsLogDir
    });
    const run = firstService.create(request({ prompt: "missing log" }));
    await firstService.finish(run.id);
    await rm(join(runsLogDir, "run_missing_log.jsonl"), { force: true });

    const restoredService = createRunService({ runsLogDir });

    await expect(restoredService.eventsAfterAsync(run.id, 0)).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        event: "error",
        data: expect.objectContaining({
          type: "error",
          message: "Unable to replay stored run events",
          code: "run.events_replay_failed"
        })
      })
    ]);
  });

  test("returns a clear error event for malformed restored event logs", async () => {
    const runsLogDir = await tempDir();
    const firstService = createRunService({
      idGenerator: () => "run_malformed_log",
      now: incrementingClock(),
      runsLogDir
    });
    const run = firstService.create(request({ prompt: "malformed log" }));
    await firstService.finish(run.id);
    await writeFile(join(runsLogDir, "run_malformed_log.jsonl"), "{\"id\":1\n", "utf8");

    const restoredService = createRunService({ runsLogDir });

    await expect(restoredService.eventsAfterAsync(run.id, 5)).resolves.toEqual([
      expect.objectContaining({
        id: 6,
        event: "error",
        data: expect.objectContaining({
          type: "error",
          message: "Unable to replay stored run events",
          code: "run.events_replay_failed"
        })
      })
    ]);
  });
});

function incrementingClock(): () => number {
  let time = 1_000;
  return () => time++;
}
