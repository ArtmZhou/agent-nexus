import type { AgentDiagnostic } from "@agent-nexus/shared";
import type { AgentExecutableResolution } from "./executables.js";
import type { RuntimeAgentDef } from "./types.js";

export function agentNotOnPathDiagnostic(def: RuntimeAgentDef, resolution: AgentExecutableResolution): AgentDiagnostic {
  return {
    code: "agent.not_on_path",
    severity: "warning",
    message: `${def.name} is not available on PATH.`,
    details: {
      agentId: def.id,
      bin: def.bin,
      overrideEnvKey: resolution.overrideEnvKey,
      searchedBins: resolution.searchedBins,
      searchedDirs: resolution.searchedDirs,
    },
  };
}

export function agentNotInvocableDiagnostic(def: RuntimeAgentDef, executablePath: string, cause: unknown): AgentDiagnostic {
  return {
    code: "agent.not_invocable",
    severity: "error",
    message: `${def.name} was found but could not be invoked.`,
    details: {
      agentId: def.id,
      path: executablePath,
      cause: cause instanceof Error ? cause.message : String(cause),
    },
  };
}
