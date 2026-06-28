import type { RunEvent, TokenUsage } from "@agent-nexus/shared";

export type RunEventEmitter = (event: RunEvent) => void;

export type StreamChunkParser = {
  write(chunk: string | Uint8Array): void;
  end(): void;
};

type JsonRecord = Record<string, unknown>;

type JsonEventNormalizer = (value: unknown) => RunEvent[];

export function createJsonEventStreamParser(emit: RunEventEmitter): StreamChunkParser {
  return createLineBufferedJsonParser(emit, normalizeJsonEventStreamEvent);
}

export function createLineBufferedJsonParser(
  emit: RunEventEmitter,
  normalize: JsonEventNormalizer
): StreamChunkParser {
  let buffered = "";

  function flushLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      for (const event of normalize(JSON.parse(trimmed) as unknown)) {
        emit(event);
      }
    } catch (error) {
      emit(malformedJsonDiagnostic(trimmed, error));
    }
  }

  return {
    write(chunk) {
      buffered += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);

      while (true) {
        const newlineIndex = buffered.indexOf("\n");
        if (newlineIndex === -1) break;
        const line = buffered.slice(0, newlineIndex);
        buffered = buffered.slice(newlineIndex + 1);
        flushLine(line);
      }
    },
    end() {
      const line = buffered;
      buffered = "";
      flushLine(line);
    }
  };
}

export function normalizeJsonEventStreamEvent(value: unknown): RunEvent[] {
  if (!isRecord(value)) {
    return [diagnostic("unexpected_json_event", { value })];
  }

  const kind = stringValue(value.type) ?? stringValue(value.event) ?? stringValue(value.name);
  if (!kind) {
    return normalizeCursorLikeEvent(value);
  }

  switch (kind) {
    case "thread.started":
      return [
        {
          type: "status",
          label: kind,
          sessionId: firstString(value.thread_id, value.threadId, value.session_id, value.sessionId, value.id)
        }
      ];
    case "turn.started":
      return [{ type: "status", label: kind }];
    case "item.completed":
      return normalizeAgentItem(value.item);
    case "turn.completed":
    case "step_finish":
    case "result":
      return usageEvent(value);
    case "turn.failed":
    case "error":
      return [errorEvent(value.error ?? value, value.code)];
    case "step_start":
      return [
        {
          type: "status",
          label: kind,
          detail: firstString(value.status, value.message),
          sessionId: firstString(value.session_id, value.sessionId, value.id)
        }
      ];
    case "init":
    case "status":
      return [statusEvent(kind, firstString(value.session_id, value.sessionId, value.id), firstString(value.status, value.message))];
    case "text":
    case "message":
    case "assistant":
    case "content":
      return textEventsFromRecord(value);
    case "tool_use":
    case "tool_call":
    case "function_call":
      return toolUseEvent(value);
    case "tool_result":
    case "tool_response":
    case "function_result":
      return toolResultEvent(value);
    case "usage":
      return usageEvent(value);
    case "warning":
      return [
        diagnostic("warning", {
          message: firstString(value.message, value.warning) ?? "Warning",
          details: { message: firstString(value.message, value.warning) ?? "Warning" }
        })
      ];
    default:
      return normalizeCursorLikeEvent(value);
  }
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value);
    if (text !== undefined) return text;
  }
  return undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function contentText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value.map((item) => contentText(item)).filter((item): item is string => item !== undefined).join("");
    return text || undefined;
  }
  if (!isRecord(value)) return undefined;
  return firstString(value.text, value.content, value.delta);
}

export function usageFrom(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) return undefined;

  const usage: TokenUsage = {};
  assignNumber(usage, "input_tokens", value.input_tokens, value.inputTokens, value.prompt_tokens, value.promptTokens);
  assignNumber(
    usage,
    "output_tokens",
    value.output_tokens,
    value.outputTokens,
    value.completion_tokens,
    value.completionTokens
  );
  assignNumber(usage, "thought_tokens", value.thought_tokens, value.thoughtTokens);
  assignNumber(usage, "cached_read_tokens", value.cached_read_tokens, value.cachedReadTokens);
  assignNumber(usage, "cached_write_tokens", value.cached_write_tokens, value.cachedWriteTokens);
  assignNumber(usage, "total_tokens", value.total_tokens, value.totalTokens);

  return Object.keys(usage).length > 0 ? usage : undefined;
}

export function errorEvent(error: unknown, fallbackCode?: unknown): RunEvent {
  if (isRecord(error)) {
    const nestedData = isRecord(error.data) ? error.data : null;
    const message = firstString(
      error.message,
      error.error,
      error.detail,
      nestedData?.message,
      error.type,
      error.name,
    ) ?? "Agent stream error";
    const rawCode = firstString(error.code, nestedData?.code, error.type, error.name, fallbackCode);
    const event: Extract<RunEvent, { type: "error" }> = { type: "error", message };
    if (rawCode && rawCode !== "error") event.code = rawCode;
    if (hasStructuredErrorDetails(error)) event.details = error;
    return event;
  }

  return {
    type: "error",
    message: firstString(error) ?? "Agent stream error",
    code: firstString(fallbackCode),
    details: error
  };
}

export function diagnostic(name: string, fields: Omit<Extract<RunEvent, { type: "diagnostic" }>, "type" | "name"> = {}): RunEvent {
  return { type: "diagnostic", name, ...fields };
}

function malformedJsonDiagnostic(raw: string, error: unknown): RunEvent {
  return diagnostic("malformed_json", {
    raw,
    message: error instanceof Error ? error.message : String(error)
  });
}

function normalizeAgentItem(item: unknown): RunEvent[] {
  if (!isRecord(item)) return [];

  const role = firstString(item.role);
  const kind = firstString(item.type, item.kind);
  if (role === "assistant" || kind === "message" || kind === "assistant_message") {
    const text = contentText(item.content) ?? contentText(item.text);
    return text ? [{ type: "text_delta", delta: text }] : [];
  }

  if (kind === "tool_use" || kind === "tool_call" || kind === "function_call") {
    return toolUseEvent(item);
  }

  if (kind === "tool_result" || kind === "function_result") {
    return toolResultEvent(item);
  }

  return textEventsFromRecord(item);
}

function normalizeCursorLikeEvent(value: JsonRecord): RunEvent[] {
  const kind = firstString(value.event, value.type);
  if (kind === "usage" || value.usage) return usageEvent(value);
  if (kind === "error" || value.error) return [errorEvent(value.error ?? value, value.code)];

  const text = contentText(value.content) ?? contentText(value.text) ?? contentText(value.message);
  return text ? [{ type: "text_delta", delta: text }] : [];
}

function textEventsFromRecord(value: JsonRecord): RunEvent[] {
  const text = contentText(value.text) ?? contentText(value.delta) ?? contentText(value.content) ?? contentText(value.message);
  return text ? [{ type: "text_delta", delta: text }] : [];
}

function toolUseEvent(value: JsonRecord): RunEvent[] {
  const id = firstString(value.id, value.tool_use_id, value.toolUseId, value.call_id, value.callId) ?? "tool";
  const name = firstString(value.name, value.tool_name, value.toolName, value.function_name, value.functionName) ?? "tool";
  return [{ type: "tool_use", id, name, input: value.input ?? value.args ?? value.arguments }];
}

function toolResultEvent(value: JsonRecord): RunEvent[] {
  const toolUseId =
    firstString(value.tool_use_id, value.toolUseId, value.id, value.call_id, value.callId) ?? "tool";
  const event: Extract<RunEvent, { type: "tool_result" }> = {
    type: "tool_result",
    toolUseId
  };
  const content = contentText(value.content) ?? contentText(value.result) ?? contentText(value.output);
  const isError = boolValue(value.is_error) ?? boolValue(value.isError);
  if (content !== undefined) event.content = content;
  if (isError !== undefined) event.isError = isError;
  return [event];
}

function usageEvent(value: JsonRecord): RunEvent[] {
  const usage = usageFrom(value.usage) ?? usageFrom(value);
  if (!usage) return [];

  const event: Extract<RunEvent, { type: "usage" }> = { type: "usage", usage };
  const costUsd = numberValue(value.cost_usd) ?? numberValue(value.costUsd) ?? numberValue(value.cost);
  const durationMs = numberValue(value.duration_ms) ?? numberValue(value.durationMs);
  if (costUsd !== undefined) event.costUsd = costUsd;
  if (durationMs !== undefined) event.durationMs = durationMs;
  return [event];
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function statusEvent(label: string, sessionId?: string, detail?: string): Extract<RunEvent, { type: "status" }> {
  const event: Extract<RunEvent, { type: "status" }> = { type: "status", label };
  if (detail !== undefined) event.detail = detail;
  if (sessionId !== undefined) event.sessionId = sessionId;
  return event;
}

function hasStructuredErrorDetails(error: JsonRecord): boolean {
  if (firstString(error.type) && error.type !== "error") return true;
  return Object.keys(error).some((key) => !["type", "message", "error"].includes(key));
}

function assignNumber(target: TokenUsage, key: keyof TokenUsage, ...values: unknown[]): void {
  const value = values.map(numberValue).find((item): item is number => item !== undefined);
  if (value !== undefined) target[key] = value;
}
