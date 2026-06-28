import type { RunEvent } from "@agent-nexus/shared";
import { describe, expect, test } from "vitest";
import {
  createClaudeStreamJsonParser,
  createClaudeTurnBookkeeping
} from "../../src/runtimes/parsers/claude-stream.js";

function collectEvents() {
  const events: RunEvent[] = [];
  return {
    events,
    parser: createClaudeStreamJsonParser((event) => events.push(event))
  };
}

describe("claude stream-json parser", () => {
  test("normalizes text deltas, thinking, tool use, tool results, usage, and errors", () => {
    const { events, parser } = collectEvents();

    parser.write(
      [
        { type: "system", subtype: "init", session_id: "claude-1" },
        { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "plan" } },
        {
          type: "content_block_start",
          content_block: { type: "tool_use", id: "tool-1", name: "Read", input: { file: "x.ts" } }
        },
        {
          type: "content_block_start",
          content_block: {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: [{ type: "text", text: "done" }],
            is_error: true
          }
        },
        { type: "message_delta", usage: { input_tokens: 1, output_tokens: 2 } },
        { type: "error", error: { message: "bad", type: "api_error" } }
      ]
        .map((event) => JSON.stringify(event))
        .join("\n") + "\n"
    );

    expect(events).toEqual([
      { type: "status", label: "init", sessionId: "claude-1" },
      { type: "text_delta", delta: "Hello" },
      { type: "thinking_start" },
      { type: "thinking_delta", delta: "plan" },
      { type: "tool_use", id: "tool-1", name: "Read", input: { file: "x.ts" } },
      { type: "tool_result", toolUseId: "tool-1", content: "done", isError: true },
      { type: "usage", usage: { input_tokens: 1, output_tokens: 2 } },
      { type: "error", message: "bad", code: "api_error", details: { message: "bad", type: "api_error" } }
    ]);
  });

  test("reports malformed stream-json lines as diagnostics", () => {
    const { events, parser } = collectEvents();

    parser.write("{bad json}\n");

    expect(events).toEqual([
      expect.objectContaining({
        type: "diagnostic",
        name: "malformed_json"
      })
    ]);
  });

  test("normalizes the Claude CLI wrapper format (assistant/user/result)", () => {
    const { events, parser } = collectEvents();

    parser.write(
      [
        { type: "system", subtype: "init", session_id: "claude-1" },
        {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Hello" },
              { type: "tool_use", id: "tool-1", name: "Read", input: { file: "x.ts" } }
            ]
          }
        },
        {
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "tool-1", content: [{ type: "text", text: "done" }] }
            ]
          }
        },
        {
          type: "result",
          subtype: "success",
          total_cost_usd: 0.05,
          duration_ms: 1200,
          usage: { input_tokens: 3, output_tokens: 7 }
        }
      ]
        .map((event) => JSON.stringify(event))
        .join("\n") + "\n"
    );

    expect(events).toEqual([
      { type: "status", label: "init", sessionId: "claude-1" },
      { type: "text_delta", delta: "Hello" },
      { type: "tool_use", id: "tool-1", name: "Read", input: { file: "x.ts" } },
      { type: "tool_result", toolUseId: "tool-1", content: "done" },
      { type: "usage", usage: { input_tokens: 3, output_tokens: 7 }, costUsd: 0.05, durationMs: 1200 }
    ]);
  });

  test("treats result subtypes other than success as turn errors", () => {
    const { events, parser } = collectEvents();

    parser.write(
      JSON.stringify({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        usage: { input_tokens: 1 }
      }) + "\n"
    );

    expect(events).toEqual([
      expect.objectContaining({ type: "error", code: "error_max_turns" }),
      { type: "usage", usage: { input_tokens: 1 } }
    ]);
  });

  test("ignores unknown wrapper events without emitting diagnostics", () => {
    const { events, parser } = collectEvents();

    parser.write(JSON.stringify({ type: "something_new", payload: 1 }) + "\n");

    expect(events).toEqual([]);
  });

  test("tracks terminal turn state from events", () => {
    const bookkeeping = createClaudeTurnBookkeeping();

    expect(bookkeeping.status).toBe("running");

    bookkeeping.accept({ type: "message_stop" });
    expect(bookkeeping.status).toBe("succeeded");
    expect(bookkeeping.toEndEvent()).toEqual({ type: "end", status: "succeeded" });
  });

  test("treats a successful result wrapper as a terminal succeeded event", () => {
    const bookkeeping = createClaudeTurnBookkeeping();

    bookkeeping.accept({ type: "result", subtype: "success", usage: { input_tokens: 1 } });

    expect(bookkeeping.status).toBe("succeeded");
    expect(bookkeeping.toEndEvent()).toEqual({ type: "end", status: "succeeded" });
  });

  test("treats a non-success result wrapper as a terminal failed event", () => {
    const bookkeeping = createClaudeTurnBookkeeping();

    bookkeeping.accept({ type: "result", subtype: "error_during_execution" });

    expect(bookkeeping.status).toBe("failed");
    expect(bookkeeping.error?.code).toBe("error_during_execution");
  });
});
