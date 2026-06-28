import type { RunEvent, TokenUsage } from "@agent-nexus/shared";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

type JsonRecord = Record<string, unknown>;

export type AcpMcpServer = {
  name?: string;
  command: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
};

export type AcpSessionNewParams = {
  cwd: string;
  mcpServers?: AcpMcpServer[];
};

export type AcpSessionNewOptions = {
  mcpServers?: AcpMcpServer[];
};

export type JsonLineStream = {
  write(chunk: string | Uint8Array): void;
  end(): void;
};

export type AttachAcpSessionOptions = {
  stdin: Writable;
  stdout: Readable;
  stderr?: Readable;
  cwd: string;
  prompt: string;
  model?: string | null;
  resumeSessionId?: string | null;
  mcpServers?: AcpMcpServer[];
  emit: (event: RunEvent) => void;
};

export type AttachedAcpSession = {
  start(): Promise<void>;
  abort(): void;
  completedSuccessfully(): boolean;
  getDurableSessionId(): string | null;
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export function buildAcpSessionNewParams(
  cwd: string,
  options: AcpSessionNewOptions = {}
): AcpSessionNewParams {
  const params: AcpSessionNewParams = {
    cwd: path.resolve(cwd)
  };

  if (options.mcpServers !== undefined) {
    params.mcpServers = options.mcpServers;
  }

  return params;
}

export function createJsonLineStream(
  onMessage: (message: unknown) => void,
  onDiagnostic: (diagnostic: Extract<RunEvent, { type: "diagnostic" }>) => void = () => undefined
): JsonLineStream {
  let buffered = "";
  const decoder = new TextDecoder();

  function flushLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      onMessage(JSON.parse(trimmed) as unknown);
    } catch (error) {
      onDiagnostic({
        type: "diagnostic",
        name: "malformed_acp_json",
        raw: trimmed,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    write(chunk) {
      buffered += typeof chunk === "string" ? chunk : decoder.decode(chunk);

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

export function attachAcpSession(options: AttachAcpSessionOptions): AttachedAcpSession {
  let nextId = 1;
  let durableSessionId: string | null = options.resumeSessionId ?? null;
  let completed = false;
  let aborted = false;
  const pending = new Map<number, PendingRequest>();

  const parser = createJsonLineStream(
    (message) => handleMessage(message),
    (diagnostic) => options.emit(diagnostic)
  );

  options.stdout.on("data", (chunk: string | Uint8Array) => parser.write(chunk));
  options.stdout.on("end", () => parser.end());
  options.stderr?.on("data", (chunk: string | Uint8Array) => {
    options.emit({ type: "stderr", chunk: typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk) });
  });

  return {
    async start() {
      await request("initialize", {
        clientInfo: { name: "agent-nexus" },
        protocolVersion: 1
      });

      const sessionResult = options.resumeSessionId
        ? await request("session/load", { sessionId: options.resumeSessionId, cwd: path.resolve(options.cwd) })
        : await request("session/new", buildAcpSessionNewParams(options.cwd, { mcpServers: options.mcpServers }));

      durableSessionId = stringField(sessionResult, "sessionId", "session_id") ?? durableSessionId;
      if (durableSessionId) {
        options.emit({ type: "status", label: "acp.session", sessionId: durableSessionId });
      }

      if (options.model) {
        await request("session/set_model", withSession({ model: options.model }));
      }

      const promptResult = await request("session/prompt", withSession({ prompt: options.prompt }));
      for (const event of normalizeAcpUpdate(promptResult)) {
        if (event.type === "end" && completed) continue;
        acceptEvent(event);
      }
      if (!completed && stopReason(promptResult) === "end_turn") {
        acceptEvent({ type: "end", status: "succeeded" });
      }
    },
    abort() {
      if (completed || aborted) return;
      aborted = true;
      notify("session/cancel", withSession({}));
      acceptEvent({ type: "end", status: "canceled" });
    },
    completedSuccessfully() {
      return completed && !aborted;
    },
    getDurableSessionId() {
      return durableSessionId;
    }
  };

  function request(method: string, params?: unknown): Promise<unknown> {
    const id = nextId++;
    const message: JsonRpcRequest = { jsonrpc: "2.0", id, method };
    if (params !== undefined) message.params = params;

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      writeJsonLine(message);
    });
  }

  function notify(method: string, params?: unknown): void {
    const message: Omit<JsonRpcRequest, "id"> = { jsonrpc: "2.0", method };
    if (params !== undefined) message.params = params;
    writeJsonLine(message);
  }

  function writeJsonLine(message: unknown): void {
    options.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function handleMessage(message: unknown): void {
    if (!isRecord(message)) {
      options.emit({ type: "diagnostic", name: "unexpected_acp_message", message });
      return;
    }

    const id = typeof message.id === "number" ? message.id : null;
    if (id !== null && pending.has(id)) {
      const pendingRequest = pending.get(id);
      pending.delete(id);
      if (!pendingRequest) return;

      if (message.error !== undefined) {
        pendingRequest.reject(toError(message.error));
        return;
      }

      pendingRequest.resolve(message.result);
      return;
    }

    const method = stringField(message, "method");
    if (method === "session/update") {
      for (const event of normalizeAcpUpdate(message.params)) {
        acceptEvent(event);
      }
      return;
    }

    if (method === "session/request_permission") {
      respondToPermissionRequest(message.params);
      return;
    }

    options.emit({ type: "diagnostic", name: "unhandled_acp_message", message });
  }

  function respondToPermissionRequest(params: unknown): void {
    if (!isRecord(params)) {
      options.emit({ type: "diagnostic", name: "invalid_acp_permission_request", params });
      return;
    }

    const requestId = stringField(params, "requestId", "request_id");
    const optionId = selectPermissionOption(params.options);
    if (!requestId || !optionId) {
      options.emit({ type: "diagnostic", name: "invalid_acp_permission_options", params });
      return;
    }

    notify("session/respond_permission", { requestId, optionId });
  }

  function withSession(params: JsonRecord): JsonRecord {
    return durableSessionId ? { ...params, sessionId: durableSessionId } : params;
  }

  function acceptEvent(event: RunEvent): void {
    if (event.type === "status" && event.sessionId) durableSessionId = event.sessionId;
    if (event.type === "end") completed = event.status === "succeeded";
    options.emit(event);
  }
}

export function normalizeAcpUpdate(value: unknown): RunEvent[] {
  if (!isRecord(value)) return [];

  const events: RunEvent[] = [];
  const sessionId = stringField(value, "sessionId", "session_id");
  const delta = stringField(value, "delta", "text");
  const content = contentText(value.content);
  const usage = usageFrom(value.usage) ?? usageFrom(value);
  const error = value.error;
  const reason = stopReason(value);

  if (sessionId && !delta && !content && !usage && error === undefined && !reason) {
    events.push({ type: "status", label: "acp.session", sessionId });
  }
  if (delta) events.push({ type: "text_delta", delta });
  if (content) events.push({ type: "text_delta", delta: content });
  if (usage) events.push({ type: "usage", usage });
  if (error !== undefined) events.push(errorEvent(error));
  if (reason === "end_turn" || reason === "stop" || reason === "completed") {
    events.push({ type: "end", status: "succeeded" });
  }

  return events;
}

function selectPermissionOption(options: unknown): string | null {
  if (!Array.isArray(options)) return null;

  const optionIds = options
    .map((option) => (isRecord(option) ? stringField(option, "id", "optionId", "option_id") : undefined))
    .filter((option): option is string => option !== undefined);

  return (
    optionIds.find((id) => id === "allow_once") ??
    optionIds.find((id) => id.includes("allow_once")) ??
    optionIds.find((id) => id.includes("approve_once")) ??
    optionIds.find((id) => id.includes("deny")) ??
    optionIds[0] ??
    null
  );
}

function stopReason(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return stringField(value, "stopReason", "stop_reason", "status");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, ...keys: string[]): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "string" && field.length > 0) return field;
  }
  return undefined;
}

function contentText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value.map((item) => contentText(item)).filter((item): item is string => item !== undefined).join("");
    return text || undefined;
  }
  if (!isRecord(value)) return undefined;
  return stringField(value, "text", "content", "delta");
}

function usageFrom(value: unknown): TokenUsage | undefined {
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

function assignNumber(target: TokenUsage, key: keyof TokenUsage, ...values: unknown[]): void {
  const value = values.find((item): item is number => typeof item === "number" && Number.isFinite(item));
  if (value !== undefined) target[key] = value;
}

function errorEvent(error: unknown): Extract<RunEvent, { type: "error" }> {
  if (isRecord(error)) {
    const message = stringField(error, "message", "error", "detail", "type") ?? "ACP session error";
    const event: Extract<RunEvent, { type: "error" }> = { type: "error", message };
    const code = stringField(error, "code", "type");
    if (code) event.code = code;
    event.details = error;
    return event;
  }

  return { type: "error", message: typeof error === "string" ? error : "ACP session error", details: error };
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (isRecord(error)) return new Error(stringField(error, "message", "error") ?? "ACP JSON-RPC error");
  return new Error(String(error));
}
