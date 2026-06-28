import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

  test("spawns Windows cmd shims through the command adapter", async () => {
    if (process.platform !== "win32") return;

    const root = mkdtempSync(join(tmpdir(), "agent-nexus-launcher-cmd-"));
    const cmdPath = join(root, "fake-agent.cmd");
    writeFileSync(cmdPath, `@echo off\r\n"${process.execPath}" "${fakeAgentPath}" json-success\r\n`, "utf8");

    const runs = createRunService({ idGenerator: () => "run_cmd", now: () => 1 });
    const run = runs.create(request());
    const def = {
      ...fakeDef("json-success"),
      bin: cmdPath,
      buildArgs: () => [],
    };

    const handle = startAgentRun({
      runs,
      runId: run.id,
      request: request(),
      def,
      resolvedPath: cmdPath
    });

    await expect(handle.done).resolves.toMatchObject({ status: "succeeded", exitCode: 0 });
    expect(runs.eventsAfter(run.id, 0).map((event) => event.data)).toEqual(
      expect.arrayContaining([{ type: "text_delta", delta: "echo:hello" }])
    );
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
      expect.objectContaining({
        type: "error",
        message: "Fake Agent executable could not be resolved",
        code: "agent.executable_not_found"
      }),
      { type: "end", status: "failed" }
    ]);
  });

  test("fails a run when the stream reports an error even if the process exits zero", async () => {
    const runs = createRunService({ idGenerator: () => "run_stream_error", now: () => 1 });
    const run = runs.create(request());

    const handle = startAgentRun({
      runs,
      runId: run.id,
      request: request(),
      def: fakeDef("json-error-zero"),
      resolvedPath: process.execPath
    });

    await expect(handle.done).resolves.toMatchObject({
      status: "failed",
      error: "subscription missing",
      errorCode: "InvalidSubscription",
      exitCode: 0
    });
    expect(runs.eventsAfter(run.id, 0).map((event) => event.data)).toEqual([
      expect.objectContaining({ type: "error", message: "subscription missing", code: "InvalidSubscription" }),
      { type: "end", status: "failed" }
    ]);
  });

  test("closes stdin for agents that receive prompts through argv", async () => {
    const runs = createRunService({ idGenerator: () => "run_argv_prompt", now: () => 1 });
    const run = runs.create(request());
    const def = {
      ...fakeDef("json-stdin-close"),
      promptViaStdin: false
    };

    const handle = startAgentRun({
      runs,
      runId: run.id,
      request: request(),
      def,
      resolvedPath: process.execPath
    });

    await expect(handle.done).resolves.toMatchObject({ status: "succeeded", exitCode: 0 });
    expect(runs.eventsAfter(run.id, 0).map((event) => event.data)).toEqual([
      { type: "text_delta", delta: "stdin closed" },
      { type: "end", status: "succeeded" }
    ]);
  });
});
