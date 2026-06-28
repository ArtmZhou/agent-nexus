import { dirname } from "node:path";
import type { AgentExecutableResolution, ResolveOptions } from "./executables.js";
import { defaultPathDirs, inspectAgentExecutableResolution } from "./executables.js";
import type { RuntimeAgentDef } from "./types.js";

export type AgentLaunchOptions = ResolveOptions & {
  selectedPath?: string | null;
  env?: Record<string, string | undefined>;
};

export type AgentLaunchConfig = {
  executablePath: string;
  env: NodeJS.ProcessEnv;
  resolution: AgentExecutableResolution;
};

export class AgentLaunchResolutionError extends Error {
  readonly resolution: AgentExecutableResolution;

  constructor(def: RuntimeAgentDef, resolution: AgentExecutableResolution) {
    super(`${def.name} executable could not be resolved`);
    this.name = "AgentLaunchResolutionError";
    this.resolution = resolution;
  }
}

export function resolveAgentLaunchConfig(
  def: RuntimeAgentDef,
  options: AgentLaunchOptions = {}
): AgentLaunchConfig {
  const platform = options.platform ?? process.platform;
  const env = buildAgentLaunchEnv(def, options.env);
  const pathDirs = options.pathDirs ?? defaultPathDirs(env, platform);
  const resolution = inspectAgentExecutableResolution(def, {}, { env, pathDirs, platform });
  const executablePath = options.selectedPath ?? resolution.selectedPath;

  if (!executablePath) {
    throw new AgentLaunchResolutionError(def, resolution);
  }

  return {
    executablePath,
    env: withExecutableOnPath(env, executablePath, platform),
    resolution: {
      ...resolution,
      selectedPath: executablePath
    }
  };
}

export function buildAgentLaunchEnv(
  def: RuntimeAgentDef,
  env: Record<string, string | undefined> = {}
): NodeJS.ProcessEnv {
  return compactEnv({
    ...process.env,
    ...(def.configuredEnv ?? {}),
    ...env
  });
}

function withExecutableOnPath(
  env: NodeJS.ProcessEnv,
  executablePath: string,
  platform: NodeJS.Platform
): NodeJS.ProcessEnv {
  const delimiter = platform === "win32" ? ";" : ":";
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const executableDir = dirname(executablePath);
  const existingPath = env[pathKey];

  return {
    ...env,
    [pathKey]: existingPath ? `${executableDir}${delimiter}${existingPath}` : executableDir
  };
}

function compactEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}
