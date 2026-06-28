import type { AgentDiagnostic, DetectedAgent } from "@agent-nexus/shared";
import { agentNotOnPathDiagnostic } from "./diagnostics.js";
import { inspectAgentExecutableResolution, type ResolveOptions } from "./executables.js";
import { builtinAgentDefs } from "./defs/index.js";
import { withDefaultModel } from "./models.js";
import { loadLocalProfiles, type LocalAgentProfile } from "./local-profiles.js";
import type { RuntimeAgentDef } from "./types.js";

export type AgentRegistry = {
  diagnostics: AgentDiagnostic[];
  get(id: string): RuntimeAgentDef | undefined;
  list(): RuntimeAgentDef[];
};

export type CreateAgentRegistryOptions = {
  profiles?: LocalAgentProfile[];
  profileDiagnostics?: AgentDiagnostic[];
};

export type LoadAgentRegistryOptions = CreateAgentRegistryOptions & Parameters<typeof loadLocalProfiles>[0];

export function createAgentRegistry(options: CreateAgentRegistryOptions = {}): AgentRegistry {
  const diagnostics = [...(options.profileDiagnostics ?? [])];
  const defs = new Map<string, RuntimeAgentDef>();

  for (const def of builtinAgentDefs) {
    defs.set(def.id, def);
  }

  for (const profile of options.profiles ?? []) {
    if (defs.has(profile.id)) {
      diagnostics.push({
        code: "profile.duplicate_id",
        severity: "warning",
        message: `Local agent profile id '${profile.id}' conflicts with an existing agent.`,
        details: { id: profile.id },
      });
      continue;
    }

    if (!isSafeProfileId(profile.id)) {
      diagnostics.push({
        code: "profile.invalid_id",
        severity: "warning",
        message: "Local agent profile id must be filesystem-safe.",
        details: { id: profile.id },
      });
      continue;
    }

    const base = defs.get(profile.baseAgent);
    if (!base) {
      diagnostics.push({
        code: "profile.unknown_base_agent",
        severity: "warning",
        message: `Local agent profile '${profile.id}' refers to unknown base agent '${profile.baseAgent}'.`,
        details: { id: profile.id, baseAgent: profile.baseAgent },
      });
      continue;
    }

    defs.set(profile.id, extendAgentDef(base, profile));
  }

  return {
    diagnostics,
    get: (id) => defs.get(id),
    list: () => Array.from(defs.values()),
  };
}

export function loadAgentRegistry(options: LoadAgentRegistryOptions = {}): AgentRegistry {
  const loaded = loadLocalProfiles(options);
  return createAgentRegistry({
    ...options,
    profiles: [...loaded.profiles, ...(options.profiles ?? [])],
    profileDiagnostics: [...loaded.diagnostics, ...(options.profileDiagnostics ?? [])],
  });
}

export function listRegisteredAgents(registry: AgentRegistry, options: ResolveOptions = {}): DetectedAgent[] {
  return registry.list().map((def) => {
    const resolution = inspectAgentExecutableResolution(def, def.configuredEnv ?? {}, options);
    const diagnostics = resolution.selectedPath ? [] : [agentNotOnPathDiagnostic(def, resolution)];
    return {
      id: def.id,
      name: def.name,
      available: resolution.selectedPath !== null,
      path: resolution.selectedPath ?? undefined,
      version: null,
      models: def.fallbackModels,
      modelsSource: "fallback",
      authStatus: "unknown",
      diagnostics,
    };
  });
}

function extendAgentDef(base: RuntimeAgentDef, profile: LocalAgentProfile): RuntimeAgentDef {
  const profileArgs = profile.args ?? [];
  return {
    ...base,
    id: profile.id,
    name: profile.name,
    bin: profile.bin ?? base.bin,
    configuredEnv: {
      ...(base.configuredEnv ?? {}),
      ...(profile.env ?? {}),
    },
    fallbackModels: withDefaultModel(base.fallbackModels, profile.defaultModel),
    buildArgs: (context) => [...profileArgs, ...base.buildArgs(context)],
  };
}

function isSafeProfileId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id);
}
