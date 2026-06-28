import type { RuntimeModelOption } from "@agent-nexus/shared";

export type RuntimeBuildOptions = {
  model?: string | null;
  reasoning?: string | null;
};

export type RuntimeBuildContext = {
  prompt: string;
  imagePaths?: string[];
  extraAllowedDirs?: string[];
  options?: RuntimeBuildOptions;
  cwd?: string;
  hasPriorAssistantTurn?: boolean;
  resumeSessionId?: string | null;
  newSessionId?: string;
};

export type RuntimeListModels = {
  args: string[];
  timeoutMs?: number;
  parse(stdout: string): RuntimeModelOption[] | null;
};

export type RuntimeAuthProbe = {
  args: string[];
  timeoutMs?: number;
};

export type RuntimeAgentDef = {
  id: string;
  name: string;
  bin: string;
  fallbackBins?: string[];
  configuredEnv?: Record<string, string>;
  versionArgs: string[];
  fallbackModels: RuntimeModelOption[];
  listModels?: RuntimeListModels;
  authProbe?: RuntimeAuthProbe;
  reasoningOptions?: RuntimeModelOption[];
  buildArgs(context: RuntimeBuildContext): string[];
  promptViaStdin?: boolean;
  promptInputFormat?: "text" | "stream-json";
  streamFormat: "plain" | "json-lines" | "claude-stream-json" | "json-event-stream" | "acp-json-rpc";
  eventParser?: string;
  supportsImagePaths?: boolean;
  resumesSessionViaCli?: boolean;
  capturesSessionIdFromStream?: boolean;
  resumesSessionViaAcpLoad?: boolean;
  inactivityTimeoutMs?: number;
};
