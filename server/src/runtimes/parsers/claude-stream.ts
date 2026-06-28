import type { RunEvent, RunStatus } from "@agent-nexus/shared";
import {
  contentText,
  createLineBufferedJsonParser,
  diagnostic,
  errorEvent,
  firstString,
  isRecord,
  usageFrom
} from "./json-event-stream.js";

type JsonRecord = Record<string, unknown>;

export function createClaudeStreamJsonParser(emit: (event: RunEvent) => void) {
  let thinkingStarted = false;

  return createLineBufferedJsonParser(emit, (value) => {
    const events = normalizeClaudeStreamJsonEvent(value);
    const expandedEvents: RunEvent[] = [];

    for (const event of events) {
      if (event.type === "thinking_delta" && !thinkingStarted) {
        expandedEvents.push({ type: "thinking_start" });
        thinkingStarted = true;
      }
      expandedEvents.push(event);
    }

    return expandedEvents;
  });
}

export function normalizeClaudeStreamJsonEvent(value: unknown): RunEvent[] {
  if (!isRecord(value)) {
    return [diagnostic("unexpected_json_event", { value })];
  }

  const kind = firstString(value.type);
  switch (kind) {
    case "system":
      return systemEvents(value);
    case "message_start":
      return usageEvent(value.message);
    case "message_delta":
      return usageEvent(value.usage ?? value.delta);
    case "content_block_start":
      return contentBlockStartEvents(value.content_block);
    case "content_block_delta":
      return contentBlockDeltaEvents(value.delta);
    case "content_block_stop":
      return [];
    case "message_stop":
      return [];
    case "error":
      return [errorEvent(value.error ?? value, value.code)];
    default:
      return [diagnostic("unhandled_json_event", { event: value })];
  }
}

export type ClaudeTurnBookkeeping = {
  readonly status: Exclude<RunStatus, "queued">;
  readonly error: Extract<RunEvent, { type: "error" }> | null;
  accept(value: unknown): void;
  acceptEvent(event: RunEvent): void;
  toEndEvent(): Extract<RunEvent, { type: "end" }>;
};

export function createClaudeTurnBookkeeping(): ClaudeTurnBookkeeping {
  let status: Exclude<RunStatus, "queued"> = "running";
  let lastError: Extract<RunEvent, { type: "error" }> | null = null;

  return {
    get status() {
      return status;
    },
    get error() {
      return lastError;
    },
    accept(value) {
      for (const event of normalizeClaudeStreamJsonEvent(value)) {
        this.acceptEvent(event);
      }

      if (isRecord(value) && value.type === "message_stop" && status === "running") {
        status = "succeeded";
      }
    },
    acceptEvent(event) {
      if (event.type === "error") {
        lastError = event;
        status = "failed";
      }
      if (event.type === "end") {
        status = event.status;
      }
    },
    toEndEvent() {
      return { type: "end", status: terminalStatus(status) };
    }
  };
}

function systemEvents(value: JsonRecord): RunEvent[] {
  const subtype = firstString(value.subtype) ?? "system";
  return [
    {
      type: "status",
      label: subtype,
      sessionId: firstString(value.session_id, value.sessionId)
    }
  ];
}

function contentBlockStartEvents(block: unknown): RunEvent[] {
  if (!isRecord(block)) return [];

  const kind = firstString(block.type);
  if (kind === "tool_use") {
    return [
      {
        type: "tool_use",
        id: firstString(block.id) ?? "tool",
        name: firstString(block.name) ?? "tool",
        input: block.input
      }
    ];
  }

  if (kind === "tool_result") {
    return [
      {
        type: "tool_result",
        toolUseId: firstString(block.tool_use_id, block.toolUseId, block.id) ?? "tool",
        content: contentText(block.content),
        isError: typeof block.is_error === "boolean" ? block.is_error : undefined
      }
    ];
  }

  return [];
}

function contentBlockDeltaEvents(delta: unknown): RunEvent[] {
  if (!isRecord(delta)) return [];

  const kind = firstString(delta.type);
  if (kind === "text_delta") {
    const text = firstString(delta.text) ?? contentText(delta);
    return text ? [{ type: "text_delta", delta: text }] : [];
  }

  if (kind === "thinking_delta") {
    const thinking = firstString(delta.thinking) ?? firstString(delta.text);
    return thinking ? [{ type: "thinking_delta", delta: thinking }] : [];
  }

  return [];
}

function usageEvent(value: unknown): RunEvent[] {
  if (!isRecord(value)) return [];
  const usage = usageFrom(value.usage) ?? usageFrom(value);
  return usage ? [{ type: "usage", usage }] : [];
}

function terminalStatus(status: Exclude<RunStatus, "queued">): Exclude<RunStatus, "queued" | "running"> {
  return status === "running" ? "succeeded" : status;
}
