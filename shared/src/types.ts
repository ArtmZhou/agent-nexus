export type RuntimeModelOption = {
  id: string;
  label: string;
};

export type AgentDiagnostic = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  details?: Record<string, unknown>;
};

export type DetectedAgent = {
  id: string;
  name: string;
  available: boolean;
  path?: string;
  version?: string | null;
  models: RuntimeModelOption[];
  modelsSource: "live" | "fallback";
  authStatus?: "ok" | "missing" | "unknown";
  authMessage?: string;
  diagnostics?: AgentDiagnostic[];
};

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
  thought_tokens?: number;
  cached_read_tokens?: number;
  cached_write_tokens?: number;
  total_tokens?: number;
};

export type RunEvent =
  | { type: "status"; label: string; detail?: string; sessionId?: string }
  | { type: "text_delta"; delta: string }
  | { type: "thinking_start" }
  | { type: "thinking_delta"; delta: string }
  | { type: "tool_use"; id: string; name: string; input?: unknown }
  | { type: "tool_result"; toolUseId: string; content?: string; isError?: boolean }
  | { type: "usage"; usage: TokenUsage; costUsd?: number; durationMs?: number }
  | { type: "diagnostic"; name?: string; [key: string]: unknown }
  | { type: "stderr"; chunk: string }
  | { type: "error"; message: string; code?: string; details?: unknown }
  | { type: "end"; status: Exclude<RunStatus, "queued" | "running"> };

export type StoredRunEvent = {
  id: number;
  event: string;
  data: RunEvent;
  timestamp: number;
};

export type RunStatusBody = {
  id: string;
  agentId: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  cancelRequested: boolean;
  childPid: number | null;
  processGroupId: number | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  errorCode: string | null;
  eventsLogPath: string | null;
};

export type CreateRunRequest = {
  agentId: string;
  model?: string | null;
  reasoning?: string | null;
  cwd?: string | null;
  prompt: string;
  extraAllowedDirs?: string[];
};
