import { homedir } from "node:os";
import { join } from "node:path";

export type AgentNexusPaths = {
  homeDir: string;
  dataDir: string;
  agentsConfigPath: string;
  runsLogDir: string;
};

export type ResolveAgentNexusPathsOptions = {
  env?: Record<string, string | undefined>;
  homeDir?: string;
};

export function resolveAgentNexusPaths(options: ResolveAgentNexusPathsOptions = {}): AgentNexusPaths {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const dataDir = env.AGENT_NEXUS_HOME ?? join(homeDir, ".agent-nexus");

  return {
    homeDir,
    dataDir,
    agentsConfigPath: env.AGENT_NEXUS_AGENTS_CONFIG ?? join(dataDir, "agents.local.json"),
    runsLogDir: env.AGENT_NEXUS_RUNS_LOG_DIR ?? join(dataDir, "runs")
  };
}
