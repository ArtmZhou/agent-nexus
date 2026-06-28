import type { RunEvent } from "@agent-nexus/shared";
import { describe, expect, test } from "vitest";
import { createJsonEventStreamParser } from "../../src/runtimes/parsers/json-event-stream.js";

function collectEvents() {
  const events: RunEvent[] = [];
  return {
    events,
    parser: createJsonEventStreamParser((event) => events.push(event))
  };
}

describe("json event stream parser", () => {
  test("buffers split chunks and emits diagnostics for malformed json lines", () => {
    const { events, parser } = collectEvents();

    parser.write('{"type":"text","text":"hel');
    parser.write('lo"}\nnot-json\n');

    expect(events).toEqual([
      { type: "text_delta", delta: "hello" },
      expect.objectContaining({
        type: "diagnostic",
        name: "malformed_json"
      })
    ]);
  });

  test("normalizes codex lifecycle, assistant items, usage, and errors", () => {
    const { events, parser } = collectEvents();

    parser.write(
      [
        { type: "thread.started", thread_id: "thread-1" },
        { type: "turn.started" },
        {
          type: "item.completed",
          item: { type: "message", role: "assistant", content: [{ type: "text", text: "Hi" }] }
        },
        { type: "turn.completed", usage: { input_tokens: 3, output_tokens: 5 } },
        { type: "turn.failed", error: { message: "boom", code: "E_FAIL" } }
      ]
        .map((event) => JSON.stringify(event))
        .join("\n") + "\n"
    );

    expect(events).toEqual([
      { type: "status", label: "thread.started", sessionId: "thread-1" },
      { type: "status", label: "turn.started" },
      { type: "text_delta", delta: "Hi" },
      { type: "usage", usage: { input_tokens: 3, output_tokens: 5 } },
      { type: "error", message: "boom", code: "E_FAIL", details: { message: "boom", code: "E_FAIL" } }
    ]);
  });

  test("normalizes opencode text, tool events, step usage, and errors", () => {
    const { events, parser } = collectEvents();

    parser.write(
      [
        { type: "step_start", session_id: "session-1", status: "running" },
        { type: "text", text: "hello" },
        { type: "tool_use", id: "tool-1", name: "Read", input: { file: "a.ts" } },
        { type: "tool_result", tool_use_id: "tool-1", content: "done", is_error: false },
        { type: "step_finish", usage: { input_tokens: 1 }, cost: 0.02, duration_ms: 30 },
        { type: "error", message: "bad" }
      ]
        .map((event) => JSON.stringify(event))
        .join("\n") + "\n"
    );

    expect(events).toEqual([
      { type: "status", label: "step_start", detail: "running", sessionId: "session-1" },
      { type: "text_delta", delta: "hello" },
      { type: "tool_use", id: "tool-1", name: "Read", input: { file: "a.ts" } },
      { type: "tool_result", toolUseId: "tool-1", content: "done", isError: false },
      { type: "usage", usage: { input_tokens: 1 }, costUsd: 0.02, durationMs: 30 },
      { type: "error", message: "bad" }
    ]);
  });

  test("normalizes gemini status, content, tool events, warnings, and result usage", () => {
    const { events, parser } = collectEvents();

    parser.write(
      [
        { type: "init", session_id: "gemini-1" },
        { type: "content", role: "assistant", text: "gem" },
        { type: "tool_call", id: "call-1", name: "Search", args: { q: "x" } },
        { type: "tool_response", id: "call-1", content: "ok" },
        { type: "warning", message: "heads up" },
        { type: "result", usage: { total_tokens: 9 } }
      ]
        .map((event) => JSON.stringify(event))
        .join("\n") + "\n"
    );

    expect(events).toEqual([
      { type: "status", label: "init", sessionId: "gemini-1" },
      { type: "text_delta", delta: "gem" },
      { type: "tool_use", id: "call-1", name: "Search", input: { q: "x" } },
      { type: "tool_result", toolUseId: "call-1", content: "ok" },
      { type: "diagnostic", name: "warning", message: "heads up", details: { message: "heads up" } },
      { type: "usage", usage: { total_tokens: 9 } }
    ]);
  });

  test("normalizes cursor-like assistant text, usage, and errors", () => {
    const { events, parser } = collectEvents();

    parser.write(
      [
        { event: "assistant", content: [{ type: "text", text: "cursor" }] },
        { event: "usage", usage: { input_tokens: 2, output_tokens: 4 } },
        { event: "error", error: "oops" }
      ]
        .map((event) => JSON.stringify(event))
        .join("\n") + "\n"
    );

    expect(events).toEqual([
      { type: "text_delta", delta: "cursor" },
      { type: "usage", usage: { input_tokens: 2, output_tokens: 4 } },
      { type: "error", message: "oops", details: "oops" }
    ]);
  });

  test("extracts nested provider error details", () => {
    const { events, parser } = collectEvents();

    parser.write(JSON.stringify({
      type: "error",
      error: {
        name: "APIError",
        data: {
          code: "InvalidSubscription",
          message: "subscription expired"
        }
      }
    }) + "\n");

    expect(events).toEqual([
      {
        type: "error",
        message: "subscription expired",
        code: "InvalidSubscription",
        details: {
          name: "APIError",
          data: {
            code: "InvalidSubscription",
            message: "subscription expired"
          }
        }
      }
    ]);
  });
});
