import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
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
  modelsSource: "fallback",
  authStatus: "unknown",
  diagnostics: []
};

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => closeServer(server)));
  servers.length = 0;
  vi.restoreAllMocks();
});

describe("local agent HTTP API", () => {
  test("GET /api/agents detects local agents with registry diagnostics", async () => {
    const app = createApp({
      registry: fakeRegistry(),
      runs: createRunService(),
      detectAgents: async () => [detectedFake]
    });

    const response = await fetch(`${await listen(app)}/api/agents`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      agents: [detectedFake],
      diagnostics: []
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
