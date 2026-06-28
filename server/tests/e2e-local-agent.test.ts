import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { RunEvent, RunStatusBody } from "@agent-nexus/shared";
import { afterEach, describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { createRunService } from "../src/runs/service.js";
import type { AgentRegistry } from "../src/runtimes/registry.js";
import type { RuntimeAgentDef } from "../src/runtimes/types.js";

const fixturePath = join(import.meta.dirname, "fixtures", "fake-agent.js");
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => closeServer(server)));
  servers.length = 0;
});

describe("local fake-agent e2e", () => {
  test("streams normalized text deltas and terminal success over the HTTP API", async () => {
    const baseUrl = await listen(createApp({
      registry: fakeRegistry("json-success"),
      runs: createRunService({ idGenerator: () => "run_e2e_success" })
    }));

    const createResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "fake-json-success",
        prompt: "hello from e2e"
      })
    });
    const created = await createResponse.json() as RunStatusBody;

    expect(createResponse.status).toBe(201);
    expect(created).toMatchObject({
      id: "run_e2e_success",
      agentId: "fake-json-success"
    });

    const events = await readSseEvents(`${baseUrl}/api/runs/${created.id}/events`);

    expect(events).toContainEqual(expect.objectContaining({
      type: "text_delta",
      delta: "echo:hello from e2e"
    }));
    expect(events.at(-1)).toEqual({ type: "end", status: "succeeded" });
  });

  test("cancels a long-running local process and leaves no active handle behind", async () => {
    const activeHandles = new Map();
    const baseUrl = await listen(createApp({
      registry: fakeRegistry("json-wait"),
      runs: createRunService({ idGenerator: () => "run_e2e_cancel" }),
      activeHandles
    }));

    const createResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "fake-json-wait",
        prompt: "stay alive"
      })
    });
    const created = await createResponse.json() as RunStatusBody;
    expect(createResponse.status).toBe(201);

    const eventsUrl = `${baseUrl}/api/runs/${created.id}/events`;
    const firstEvents = await readSseEvents(eventsUrl, (events) =>
      events.some((event) => event.type === "status" && event.detail === "ready")
    );
    expect(firstEvents).toContainEqual(expect.objectContaining({
      type: "status",
      label: "status",
      detail: "ready"
    }));

    const runningResponse = await fetch(`${baseUrl}/api/runs/${created.id}`);
    const running = await runningResponse.json() as RunStatusBody;
    expect(running.childPid).toEqual(expect.any(Number));

    const cancelResponse = await fetch(`${baseUrl}/api/runs/${created.id}/cancel`, { method: "POST" });
    const canceled = await cancelResponse.json() as RunStatusBody;

    expect(cancelResponse.status).toBe(200);
    expect(canceled).toMatchObject({
      status: "canceled",
      cancelRequested: true
    });

    const terminalEvents = await readSseEvents(eventsUrl);
    expect(terminalEvents.at(-1)).toEqual({ type: "end", status: "canceled" });
    expect(activeHandles.size).toBe(0);
    await expectProcessToExit(canceled.childPid);
  });
});

function fakeRegistry(mode: "json-success" | "json-wait"): AgentRegistry {
  const def: RuntimeAgentDef = {
    id: `fake-${mode}`,
    name: `Fake ${mode}`,
    bin: process.execPath,
    versionArgs: ["--version"],
    fallbackModels: [{ id: "fake-model", label: "Fake Model" }],
    promptViaStdin: true,
    promptInputFormat: "text",
    streamFormat: "json-event-stream",
    buildArgs: () => [fixturePath, mode]
  };

  return {
    diagnostics: [],
    get: (id) => (id === def.id ? def : undefined),
    list: () => [def]
  };
}

async function readSseEvents(
  url: string,
  stopWhen: (events: RunEvent[]) => boolean = (events) => events.some((event) => event.type === "end")
): Promise<RunEvent[]> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");

  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE response did not include a body");

  const decoder = new TextDecoder();
  let buffer = "";
  const events: RunEvent[] = [];

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      drainSseBuffer(buffer, events);
      buffer = trailingSseBuffer(buffer);

      if (stopWhen(events)) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  drainSseBuffer(buffer + decoder.decode(), events);
  return events;
}

function drainSseBuffer(buffer: string, events: RunEvent[]): void {
  const blocks = buffer.split(/\r?\n\r?\n/u).slice(0, -1);
  for (const block of blocks) {
    const data = block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length))
      .join("\n");

    if (data) {
      events.push(JSON.parse(data) as RunEvent);
    }
  }
}

function trailingSseBuffer(buffer: string): string {
  const normalized = buffer.replace(/\r\n/gu, "\n");
  const lastSeparator = normalized.lastIndexOf("\n\n");
  return lastSeparator === -1 ? buffer : normalized.slice(lastSeparator + 2);
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

async function expectProcessToExit(pid: number | null): Promise<void> {
  expect(pid).toEqual(expect.any(Number));

  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Process ${pid} was still active after cancellation`);
}

function isProcessAlive(pid: number | null): boolean {
  if (!pid) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
