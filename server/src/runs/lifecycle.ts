import type { RunStatus } from "@agent-nexus/shared";

export const CHAT_RUN_INACTIVITY_TIMEOUT_ENV = "AGENT_NEXUS_CHAT_RUN_INACTIVITY_TIMEOUT_MS";
export const CHAT_RUN_ARTIFACT_QUIET_PERIOD_ENV =
  "AGENT_NEXUS_CHAT_RUN_ARTIFACT_QUIET_PERIOD_MS";
export const CHAT_RUN_SHUTDOWN_GRACE_ENV = "AGENT_NEXUS_CHAT_RUN_SHUTDOWN_GRACE_MS";
export const ACP_STAGE_TIMEOUT_ENV = "AGENT_NEXUS_ACP_STAGE_TIMEOUT_MS";

export const DEFAULT_CHAT_RUN_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_CHAT_RUN_ARTIFACT_QUIET_PERIOD_MS = 60 * 1000;
export const DEFAULT_CHAT_RUN_SHUTDOWN_GRACE_MS = 3000;

export type TimeoutEnv = Record<string, string | undefined>;

export type ActiveInactivityTimeoutOptions = {
  inactivityTimeoutMs: number | null;
  artifactQuietPeriodMs: number | null;
  artifactRegistered: boolean;
};

export type RunCloseClassificationInput = {
  cancelRequested: boolean;
  code: number | null;
  signal: string | null;
  acpCleanCompletion: boolean;
  artifactQuietShutdownRequested: boolean;
  artifactProducedThisRun: boolean;
  turnCompletedCleanly: boolean;
  parserTerminalStatus?: TerminalRunStatus | null;
};

export type TerminalRunStatus = Exclude<RunStatus, "queued" | "running">;

export function resolveChatRunInactivityTimeoutMs(
  env: TimeoutEnv = process.env
): number | null {
  return resolveOptionalPositiveMs(
    env[CHAT_RUN_INACTIVITY_TIMEOUT_ENV],
    DEFAULT_CHAT_RUN_INACTIVITY_TIMEOUT_MS
  );
}

export function resolveChatRunArtifactQuietPeriodMs(env: TimeoutEnv = process.env): number {
  return resolvePositiveMs(
    env[CHAT_RUN_ARTIFACT_QUIET_PERIOD_ENV],
    DEFAULT_CHAT_RUN_ARTIFACT_QUIET_PERIOD_MS
  );
}

export function resolveChatRunShutdownGraceMs(env: TimeoutEnv = process.env): number {
  return resolveNonNegativeMs(env[CHAT_RUN_SHUTDOWN_GRACE_ENV], DEFAULT_CHAT_RUN_SHUTDOWN_GRACE_MS);
}

export function resolveAcpStageTimeoutMs(env: TimeoutEnv = process.env): number | null {
  return resolveOptionalPositiveMs(env[ACP_STAGE_TIMEOUT_ENV], null);
}

export function resolveActiveInactivityTimeoutMs(
  options: ActiveInactivityTimeoutOptions
): number | null {
  if (options.artifactRegistered && isPositiveMs(options.artifactQuietPeriodMs)) {
    return options.artifactQuietPeriodMs;
  }

  return isPositiveMs(options.inactivityTimeoutMs) ? options.inactivityTimeoutMs : null;
}

export function classifyRunCloseStatus(input: RunCloseClassificationInput): TerminalRunStatus {
  if (input.cancelRequested) {
    return "canceled";
  }

  if (input.parserTerminalStatus === "failed" || input.parserTerminalStatus === "canceled") {
    return input.parserTerminalStatus;
  }

  if (input.code === 0) {
    return "succeeded";
  }

  if (input.acpCleanCompletion && input.signal === "SIGTERM") {
    return "succeeded";
  }

  if (input.artifactQuietShutdownRequested) {
    return "succeeded";
  }

  if (input.artifactProducedThisRun && typeof input.code === "number" && input.code !== 0) {
    return "succeeded";
  }

  if (input.turnCompletedCleanly) {
    return "succeeded";
  }

  if (input.parserTerminalStatus === "succeeded") {
    return "succeeded";
  }

  return "failed";
}

function resolveOptionalPositiveMs(
  rawValue: string | undefined,
  defaultValue: number | null
): number | null {
  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  const parsed = parseMs(rawValue);
  if (parsed === null) {
    return defaultValue;
  }

  return parsed > 0 ? parsed : null;
}

function resolvePositiveMs(rawValue: string | undefined, defaultValue: number): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  const parsed = parseMs(rawValue);
  return parsed !== null && parsed > 0 ? parsed : defaultValue;
}

function resolveNonNegativeMs(rawValue: string | undefined, defaultValue: number): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  const parsed = parseMs(rawValue);
  return parsed !== null && parsed >= 0 ? parsed : defaultValue;
}

function parseMs(rawValue: string): number | null {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
  }

  return parsed;
}

function isPositiveMs(value: number | null): value is number {
  return typeof value === "number" && value > 0;
}
