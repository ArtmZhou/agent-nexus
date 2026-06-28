import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import type { CreateRunRequest } from "@agent-nexus/shared";
import { createRunService } from "../../src/runs/service.js";
import { startAgentRun } from "../../src/runs/launcher.js";
import type { RuntimeAgentDef } from "../../src/runtimes/types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fakeAgentPath = join(fixturesDir, "fake-agent.js");

function request(overrides: Partial<CreateRunRequest> = {}): CreateRunRequest {
  return {
    agentId: "fake",
    prompt: "hello",
    cwd: fixturesDir,
    model: null,
    reasoning: null,
    extraAllowedDirs: [],
    ...overrides
  };
}

function fakeDef(mode: string): RuntimeAgentDef {
  return {
    id: "fake",
    name: "Fake Agent",
    bin: "node",
    versionArgs: ["--version"],
    fallbackModels: [],
    buildArgs: () => [fakeAgentPath, mode],
    promptViaStdin: true,
    promptInputFormat: "text",
    streamFormat: "json-event-stream",
    eventParser: "fake"
  };
}

describe("startAgentRun", () => {
  test("spawns the resolved executable, streams normalized JSON events, and finishes successfully", async () => {
    const runs = createRunService({ idGenerator: () => "run_success", now: () => 1 });
    const run = runs.create(request());

    const handle = startAgentRun({
      runs,
      runId: run.id,
      request: request(),
      def: fakeDef("json-success"),
      resolvedPath: process.execPath
    });

    await expect(handle.done).resolves.toMatchObject({ status: "succeeded", exitCode: 0 });

    const body = runs.statusBody(run.id);
    expect(body).toMatchObject({
      status: "succeeded",
      childPid: expect.any(Number),
      processGroupId: expect.any(Number),
      exitCode: 0
    });
    const events = runs.eventsAfter(run.id, 0).map((event) => event.data);
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "status", label: "status", detail: "started" },
        { type: "text_delta", delta: "echo:hello" },
        { type: "usage", usage: { input_tokens: 1, output_tokens: 2 } },
        { type: "stderr", chunk: "fake stderr\n" }
      ])
    );
    expect(events.at(-1)).toEqual({ type: "end", status: "succeeded" });
  });

  test("cancels a running child and records one terminal canceled event", async () => {
    const runs = createRunService({ idGenerator: () => "run_cancel", now: () => 1 });
    const run = runs.create(request({ prompt: "wait" }));
    const ready = new Promise<void>((resolve) => {
      runs.subscribe(run.id, (event) => {
        if (event.data.type === "status" && event.data.detail === "ready") resolve();
      });
    });

    const handle = startAgentRun({
      runs,
      runId: run.id,
      request: request({ prompt: "wait" }),
      def: fakeDef("json-wait"),
      resolvedPath: process.execPath
    });

    await ready;
    await handle.cancel("user canceled");
    await expect(handle.done).resolves.toMatchObject({ status: "canceled", cancelRequested: true });

    const terminalEvents = runs
      .eventsAfter(run.id, 0)
      .map((event) => event.data)
      .filter((event) => event.type === "end");

    expect(runs.statusBody(run.id)).toMatchObject({
      status: "canceled",
      cancelRequested: true,
      error: "user canceled",
      errorCode: "user.cancel"
    });
    expect(terminalEvents).toEqual([{ type: "end", status: "canceled" }]);
  });

  test("fails before spawn when no executable can be resolved", async () => {
    const runs = createRunService({ idGenerator: () => "run_missing", now: () => 1 });
    const run = runs.create(request());
    const missingDef = {
      ...fakeDef("json-success"),
      bin: "agent-nexus-missing-launcher-bin"
    };

    const handle = startAgentRun({
      runs,
      runId: run.id,
      request: request(),
      def: missingDef
    });

    await expect(handle.done).resolves.toMatchObject({
      status: "failed",
      errorCode: "agent.executable_not_found"
    });
    expect(handle.child).toBeNull();
    expect(runs.eventsAfter(run.id, 0).map((event) => event.data)).toEqual([
      { type: "end", status: "failed" }
    ]);
  });
});
