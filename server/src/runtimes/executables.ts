import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import type { RuntimeAgentDef } from "./types.js";

const AGENT_BIN_ENV_KEYS = new Map<string, string>([
  ["codex", "CODEX_BIN"],
  ["claude", "CLAUDE_BIN"],
  ["opencode", "OPENCODE_BIN"],
  ["gemini", "GEMINI_BIN"],
  ["cursor-agent", "CURSOR_AGENT_BIN"],
]);

export type ResolveOptions = {
  env?: Record<string, string | undefined>;
  pathDirs?: string[];
  platform?: NodeJS.Platform;
};

export type AgentExecutableResolution = {
  configuredOverridePath: string | null;
  configuredOverrideValue: string | null;
  overrideEnvKey: string | null;
  pathResolvedPath: string | null;
  searchedBins: string[];
  searchedDirs: string[];
  selectedPath: string | null;
};

export function agentBinEnvKey(agentId: string | undefined): string | null {
  if (!agentId) return null;
  return AGENT_BIN_ENV_KEYS.get(agentId) ?? null;
}

export function defaultPathDirs(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const pathValue = getEnvCaseInsensitive(env, "PATH") ?? "";
  const delimiter = platform === "win32" ? ";" : ":";
  return pathValue.split(delimiter).filter(Boolean);
}

function getEnvCaseInsensitive(env: Record<string, string | undefined>, key: string): string | undefined {
  const found = Object.entries(env).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return found?.[1];
}

function windowsExecutableExts(env: Record<string, string | undefined>): string[] {
  const pathext = getEnvCaseInsensitive(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD";
  const exts = pathext
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean)
    .map((ext) => ext.toUpperCase());
  return exts.length > 0 ? exts : [".COM", ".EXE", ".BAT", ".CMD"];
}

function candidateNames(bin: string, env: Record<string, string | undefined>, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [bin];
  if (extname(bin)) return [bin];
  return windowsExecutableExts(env).map((ext) => `${bin}${ext}`);
}

function isExecutableFile(filePath: string, env: Record<string, string | undefined>, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(filePath).isFile()) return false;
    if (platform === "win32") {
      const ext = extname(filePath).toUpperCase();
      return windowsExecutableExts(env).includes(ext);
    }
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveConfiguredOverride(def: RuntimeAgentDef, env: Record<string, string | undefined>, platform: NodeJS.Platform): {
  configuredOverridePath: string | null;
  configuredOverrideValue: string | null;
  overrideEnvKey: string | null;
} {
  const overrideEnvKey = agentBinEnvKey(def.id);
  const configuredOverrideValue = overrideEnvKey ? env[overrideEnvKey] ?? null : null;
  if (!configuredOverrideValue || !isAbsolute(configuredOverrideValue)) {
    return { configuredOverridePath: null, configuredOverrideValue, overrideEnvKey };
  }
  const configuredOverridePath = isExecutableFile(configuredOverrideValue, env, platform) ? configuredOverrideValue : null;
  return { configuredOverridePath, configuredOverrideValue, overrideEnvKey };
}

export function resolveOnPath(bin: string, options: ResolveOptions = {}): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathDirs = options.pathDirs ?? defaultPathDirs(env, platform);

  for (const dir of pathDirs) {
    for (const name of candidateNames(bin, env, platform)) {
      const candidate = join(dir, name);
      const resolvedCandidate = platform === "win32" ? resolveWindowsActualPath(dir, name) : candidate;
      if (existsSync(resolvedCandidate) && isExecutableFile(resolvedCandidate, env, platform)) {
        return resolvedCandidate;
      }
    }
  }

  return null;
}

function resolveWindowsActualPath(dir: string, name: string): string {
  try {
    const actualName = readdirSync(dir).find((entry) => entry.toLowerCase() === name.toLowerCase());
    return actualName ? join(dir, actualName) : join(dir, name);
  } catch {
    return join(dir, name);
  }
}

export function inspectAgentExecutableResolution(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string | undefined> = {},
  options: ResolveOptions = {},
): AgentExecutableResolution {
  const platform = options.platform ?? process.platform;
  const env = { ...(options.env ?? process.env), ...configuredEnv };
  const searchedBins = [def.bin, ...(def.fallbackBins ?? [])];
  const searchedDirs = options.pathDirs ?? defaultPathDirs(env, platform);
  const override = resolveConfiguredOverride(def, env, platform);
  const pathResolvedPath = searchedBins
    .map((bin) => resolveOnPath(bin, { env, pathDirs: searchedDirs, platform }))
    .find((resolved): resolved is string => resolved !== null) ?? null;

  return {
    ...override,
    pathResolvedPath,
    searchedBins,
    searchedDirs,
    selectedPath: override.configuredOverridePath ?? pathResolvedPath,
  };
}
