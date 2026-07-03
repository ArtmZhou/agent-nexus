import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DetectedAgent, RunStatusBody } from "@agent-nexus/shared";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createRunService } from "../src/runs/service.js";
import type { AgentRunHandle, StartAgentRunOptions } from "../src/runs/launcher.js";
import type { AgentRegistry } from "../src/runtimes/registry.js";
import type { RuntimeAgentDef } from "../src/runtimes/types.js";

const fakeDef: RuntimeAgentDef = {
  id: "fake",
  name: "Fake Agent",
  bin: "fake-agent",
  versionArgs: ["--version"],
  fallbackModels: [{ id: "fake-model", label: "Fake Model" }],
  reasoningOptions: [{ id: "high", label: "High" }],
  streamFormat: "plain",
  buildArgs: () => []
};

const detectedFake: DetectedAgent = {
  id: "fake",
  name: "Fake Agent",
  available: true,
  path: "/bin/fake",
  version: "1.0.0",
  models: [{ id: "fake-model", label: "Fake Model" }],
  reasoningOptions: [{ id: "high", label: "High" }],
  modelsSource: "fallback",
  authStatus: "unknown",
  diagnostics: []
};

const servers: Server[] = [];
const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => closeServer(server)));
  servers.length = 0;
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
  vi.restoreAllMocks();
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "agent-nexus-api-runs-"));
  createdDirs.push(dir);
  return dir;
}

describe("local agent HTTP API", () => {
  test("GET /api/agents detects local agents with registry diagnostics", async () => {
    const app = createApp({
      paths: {
        homeDir: "D:/home",
        dataDir: "D:/agent-nexus",
        agentsConfigPath: "D:/agent-nexus/agents.local.json",
        runsLogDir: "D:/agent-nexus/runs"
      },
      registry: fakeRegistry(),
      runs: createRunService(),
      detectAgents: async () => [detectedFake]
    });

    const response = await fetch(`${await listen(app)}/api/agents`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      agents: [detectedFake],
      diagnostics: [],
      config: {
        agentsConfigPath: "D:/agent-nexus/agents.local.json",
        agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG"
      }
    });
  });

  test("POST /api/runs validates and starts a run with the selected agent def", async () => {
    const runs = createRunService({ idGenerator: () => "run_api" });
    const startRun = vi.fn((options: StartAgentRunOptions): AgentRunHandle => ({
      child: null,
      done: runs.wait(options.runId),
      cancel: vi.fn(async () => runs.cancel(options.runId, { message: "canceled" }))
    }));
    const app = createApp({
      registry: fakeRegistry(),
      runs,
      detectAgents: async () => [detectedFake],
      startRun
    });

    const response = await fetch(`${await listen(app)}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "fake",
        prompt: "hello",
        cwd: "D:/codes/agent-nexus",
        model: "fake-model"
      })
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: "run_api",
      agentId: "fake",
      status: "queued"
    });
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run_api",
      request: expect.objectContaining({ agentId: "fake", prompt: "hello" }),
      def: fakeDef
    }));
  });

  test("GET /api/runs/:id/events replays SSE history after a cursor", async () => {
    const runs = createRunService({ idGenerator: () => "run_sse", now: incrementingClock() });
    const run = runs.create({ agentId: "fake", prompt: "hello" });
    await runs.emit(run.id, { type: "text_delta", delta: "one" });
    await runs.emit(run.id, { type: "text_delta", delta: "two" });
    await runs.finish(run.id);
    const app = createApp({
      registry: fakeRegistry(),
      runs,
      detectAgents: async () => [detectedFake]
    });

    const response = await fetch(`${await listen(app)}/api/runs/${run.id}/events?after=1`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).not.toContain("one");
    expect(body).toContain("id: 2\nevent: text_delta");
    expect(body).toContain('"delta":"two"');
    expect(body).toContain("id: 3\nevent: end");
    expect(body).toContain('"status":"succeeded"');
  });

  test("GET /api/runs returns persistent run summaries", async () => {
    const runsLogDir = await tempDir();
    const firstRuns = createRunService({
      idGenerator: () => "run_list",
      now: incrementingClock(),
      runsLogDir
    });
    const run = firstRuns.create({
      agentId: "fake",
      prompt: "show in history",
      model: "fake-model",
      cwd: "D:/work"
    });
    await firstRuns.finish(run.id);
    const restoredRuns = createRunService({ runsLogDir });
    const app = createApp({
      registry: fakeRegistry(),
      runs: restoredRuns,
      detectAgents: async () => [detectedFake]
    });

    const response = await fetch(`${await listen(app)}/api/runs`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      runs: [
        expect.objectContaining({
          id: "run_list",
          agentId: "fake",
          prompt: "show in history",
          model: "fake-model",
          cwd: "D:/work",
          status: "succeeded"
        })
      ]
    });
  });

  test("GET /api/runs/:id/events replays restored JSONL events", async () => {
    const runsLogDir = await tempDir();
    const firstRuns = createRunService({
      idGenerator: () => "run_restored_sse",
      now: incrementingClock(),
      runsLogDir
    });
    const run = firstRuns.create({ agentId: "fake", prompt: "restore events" });
    await firstRuns.emit(run.id, { type: "text_delta", delta: "from disk" });
    await firstRuns.finish(run.id);
    const restoredRuns = createRunService({ runsLogDir });
    const app = createApp({
      registry: fakeRegistry(),
      runs: restoredRuns,
      detectAgents: async () => [detectedFake]
    });

    const response = await fetch(`${await listen(app)}/api/runs/${run.id}/events`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: text_delta");
    expect(body).toContain('"delta":"from disk"');
    expect(body).toContain("event: end");
  });

  test("GET /api/runs/:id/events applies cursors to restored JSONL replay", async () => {
    const runsLogDir = await tempDir();
    const firstRuns = createRunService({
      idGenerator: () => "run_restored_sse_cursor",
      now: incrementingClock(),
      runsLogDir
    });
    const run = firstRuns.create({ agentId: "fake", prompt: "restore events after cursor" });
    await firstRuns.emit(run.id, { type: "text_delta", delta: "skip me" });
    await firstRuns.emit(run.id, { type: "text_delta", delta: "send me" });
    await firstRuns.finish(run.id);
    const restoredRuns = createRunService({ runsLogDir });
    const app = createApp({
      registry: fakeRegistry(),
      runs: restoredRuns,
      detectAgents: async () => [detectedFake]
    });

    const response = await fetch(`${await listen(app)}/api/runs/${run.id}/events?after=1`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("skip me");
    expect(body).toContain("id: 2\nevent: text_delta");
    expect(body).toContain('"delta":"send me"');
    expect(body).toContain("id: 3\nevent: end");
  });

  test("GET /api/runs/:id/events replays restored log failures as SSE errors", async () => {
    const runsLogDir = await tempDir();
    const firstRuns = createRunService({
      idGenerator: () => "run_restored_sse_missing_log",
      now: incrementingClock(),
      runsLogDir
    });
    const run = firstRuns.create({ agentId: "fake", prompt: "restore missing log" });
    await firstRuns.emit(run.id, { type: "text_delta", delta: "will disappear" });
    await firstRuns.finish(run.id);
    await rm(join(runsLogDir, "run_restored_sse_missing_log.jsonl"), { force: true });
    const restoredRuns = createRunService({ runsLogDir });
    const app = createApp({
      registry: fakeRegistry(),
      runs: restoredRuns,
      detectAgents: async () => [detectedFake]
    });

    const response = await fetch(`${await listen(app)}/api/runs/${run.id}/events`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: error");
    expect(body).toContain("run.events_replay_failed");
  });

  test("POST /api/runs/:id/cancel rejects restored runs without throwing", async () => {
    const runsLogDir = await tempDir();
    const firstRuns = createRunService({
      idGenerator: () => "run_restored_cancel",
      now: incrementingClock(),
      runsLogDir
    });
    const run = firstRuns.create({ agentId: "fake", prompt: "cannot cancel history" });
    await firstRuns.finish(run.id);
    const restoredRuns = createRunService({ runsLogDir });
    const app = createApp({
      registry: fakeRegistry(),
      runs: restoredRuns,
      detectAgents: async () => [detectedFake]
    });

    const response = await fetch(`${await listen(app)}/api/runs/${run.id}/cancel`, { method: "POST" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Restored runs cannot be canceled"
    });
  });

  test("POST /api/runs/:id/cancel calls the active launcher handle", async () => {
    const runs = createRunService({ idGenerator: () => "run_cancel" });
    let createdBody: RunStatusBody | null = null;
    const cancel = vi.fn(async () => {
      if (!createdBody) throw new Error("run missing");
      return runs.cancel(createdBody.id, { message: "from handle", code: "user.cancel" });
    });
    const app = createApp({
      registry: fakeRegistry(),
      runs,
      detectAgents: async () => [detectedFake],
      startRun: (options) => {
        createdBody = runs.statusBody(options.runId);
        return {
          child: null,
          done: runs.wait(options.runId),
          cancel
        };
      }
    });
    const baseUrl = await listen(app);
    await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "fake", prompt: "hello" })
    });

    const response = await fetch(`${baseUrl}/api/runs/run_cancel/cancel`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(cancel).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      id: "run_cancel",
      status: "canceled",
      error: "from handle"
    });
  });
});

function fakeRegistry(): AgentRegistry {
  return {
    diagnostics: [],
    get: (id) => (id === fakeDef.id ? fakeDef : undefined),
    list: () => [fakeDef]
  };
}

async function listen(app: ReturnType<typeof createApp>): Promise<string> {
  const server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
  });
  servers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function incrementingClock(): () => number {
  let time = 1_000;
  return () => time++;
}
