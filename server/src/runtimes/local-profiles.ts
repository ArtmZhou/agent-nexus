import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentDiagnostic } from "@agent-nexus/shared";

export type LocalAgentProfile = {
  id: string;
  name: string;
  baseAgent: string;
  bin?: string;
  args?: string[];
  env?: Record<string, string>;
  defaultModel?: string;
};

export type LoadedLocalProfiles = {
  configPath: string;
  profiles: LocalAgentProfile[];
  diagnostics: AgentDiagnostic[];
};

export type ResolveLocalProfilesPathOptions = {
  env?: Record<string, string | undefined>;
  homeDir?: string;
};

export type LoadLocalProfilesOptions = ResolveLocalProfilesPathOptions & {
  configPath?: string;
};

const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function resolveLocalProfilesPath(options: ResolveLocalProfilesPathOptions = {}): string {
  const env = options.env ?? process.env;
  return env.AGENT_NEXUS_AGENTS_CONFIG ?? join(options.homeDir ?? homedir(), ".agent-nexus", "agents.local.json");
}

export function loadLocalProfiles(options: LoadLocalProfilesOptions = {}): LoadedLocalProfiles {
  const configPath = options.configPath ?? resolveLocalProfilesPath(options);
  if (!existsSync(configPath)) {
    return { configPath, profiles: [], diagnostics: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    return {
      configPath,
      ...parseLocalProfilesConfig(parsed),
    };
  } catch (error) {
    return {
      configPath,
      profiles: [],
      diagnostics: [{
        code: "profile.config_unreadable",
        severity: "error",
        message: "Local agent profile config could not be read.",
        details: { configPath, cause: error instanceof Error ? error.message : String(error) },
      }],
    };
  }
}

function parseLocalProfilesConfig(input: unknown): Omit<LoadedLocalProfiles, "configPath"> {
  if (!isObject(input)) {
    return {
      profiles: [],
      diagnostics: [profileDiagnostic("profile.invalid_config", "Local agent profile config must be a JSON object.")],
    };
  }

  const agents = input.agents;
  if (agents === undefined) return { profiles: [], diagnostics: [] };
  if (!Array.isArray(agents)) {
    return {
      profiles: [],
      diagnostics: [profileDiagnostic("profile.invalid_config", "Local agent profile config agents must be an array.")],
    };
  }

  const profiles: LocalAgentProfile[] = [];
  const diagnostics: AgentDiagnostic[] = [];
  const seen = new Set<string>();

  for (const agent of agents) {
    const result = parseLocalProfile(agent, seen);
    if (result.profile) profiles.push(result.profile);
    diagnostics.push(...result.diagnostics);
  }

  return { profiles, diagnostics };
}

function parseLocalProfile(input: unknown, seen: Set<string>): { profile: LocalAgentProfile | null; diagnostics: AgentDiagnostic[] } {
  if (!isObject(input)) {
    return { profile: null, diagnostics: [profileDiagnostic("profile.invalid", "Local agent profile must be an object.")] };
  }

  const id = input.id;
  const name = input.name;
  const baseAgent = input.baseAgent;
  const diagnostics: AgentDiagnostic[] = [];

  if (typeof id !== "string" || !PROFILE_ID_PATTERN.test(id)) {
    diagnostics.push(profileDiagnostic("profile.invalid_id", "Local agent profile id must be filesystem-safe.", { id }));
  }
  if (typeof id === "string" && seen.has(id)) {
    diagnostics.push(profileDiagnostic("profile.duplicate_id", "Local agent profile id must be unique.", { id }));
  }
  if (typeof name !== "string" || name.trim() === "") {
    diagnostics.push(profileDiagnostic("profile.invalid_name", "Local agent profile name must be a non-empty string.", { id }));
  }
  if (typeof baseAgent !== "string" || baseAgent.trim() === "") {
    diagnostics.push(profileDiagnostic("profile.invalid_base_agent", "Local agent profile baseAgent must be a non-empty string.", { id }));
  }
  if (input.bin !== undefined && (typeof input.bin !== "string" || input.bin.trim() === "")) {
    diagnostics.push(profileDiagnostic("profile.invalid_bin", "Local agent profile bin must be a non-empty string.", { id }));
  }
  if (input.args !== undefined && (!Array.isArray(input.args) || input.args.some((arg) => typeof arg !== "string"))) {
    diagnostics.push(profileDiagnostic("profile.invalid_args", "Local agent profile args must be an array of strings.", { id }));
  }
  if (input.env !== undefined && !isValidEnv(input.env)) {
    diagnostics.push(profileDiagnostic("profile.invalid_env", "Local agent profile env must use valid process environment keys.", { id }));
  }
  if (input.defaultModel !== undefined && !isValidModelId(input.defaultModel)) {
    diagnostics.push(profileDiagnostic("profile.invalid_model", "Local agent profile defaultModel must be a non-empty model id.", { id }));
  }

  if (diagnostics.length > 0) return { profile: null, diagnostics };

  seen.add(id as string);
  return {
    profile: {
      id: id as string,
      name: name as string,
      baseAgent: baseAgent as string,
      bin: input.bin as string | undefined,
      args: input.args as string[] | undefined,
      env: input.env as Record<string, string> | undefined,
      defaultModel: input.defaultModel as string | undefined,
    },
    diagnostics,
  };
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isValidEnv(input: unknown): input is Record<string, string> {
  return isObject(input) && Object.entries(input).every(([key, value]) => ENV_KEY_PATTERN.test(key) && typeof value === "string");
}

function isValidModelId(input: unknown): input is string {
  return typeof input === "string" && input.trim() !== "" && !/[\u0000-\u001f\u007f]/u.test(input);
}

function profileDiagnostic(code: string, message: string, details?: Record<string, unknown>): AgentDiagnostic {
  return { code, severity: "warning", message, details };
}
