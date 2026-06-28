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

  test("tracks terminal turn state from events", () => {
    const bookkeeping = createClaudeTurnBookkeeping();

    expect(bookkeeping.status).toBe("running");

    bookkeeping.accept({ type: "message_stop" });
    expect(bookkeeping.status).toBe("succeeded");
    expect(bookkeeping.toEndEvent()).toEqual({ type: "end", status: "succeeded" });
  });
});
