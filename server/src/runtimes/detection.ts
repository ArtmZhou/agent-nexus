import type { AgentDiagnostic, DetectedAgent, RuntimeModelOption } from "@agent-nexus/shared";
import { agentNotOnPathDiagnostic } from "./diagnostics.js";
import { inspectAgentExecutableResolution, type ResolveOptions } from "./executables.js";
import { execFileProbe, type ProbeInvocationOptions, type ProbeInvocationResult } from "./invocation.js";
import type { AgentRegistry } from "./registry.js";
import type { RuntimeAgentDef } from "./types.js";

export type DetectionOptions = {
  resolve?: ResolveOptions;
  invoke?: ProbeInvoker;
  defaultProbeTimeoutMs?: number;
};

export type ProbeInvoker = (options: ProbeInvocationOptions) => Promise<ProbeInvocationResult>;

const defaultProbeTimeoutMs = 3_000;

export async function detectLocalAgents(registry: AgentRegistry, options: DetectionOptions = {}): Promise<DetectedAgent[]> {
  const invoke = options.invoke ?? execFileProbe;

  return Promise.all(
    registry.list().map(async (def) => {
      try {
        return await detectLocalAgent(def, invoke, options);
      } catch (cause) {
        return detectionFailureAgent(def, cause);
      }
    }),
  );
}

async function detectLocalAgent(
  def: RuntimeAgentDef,
  invoke: ProbeInvoker,
  options: DetectionOptions,
): Promise<DetectedAgent> {
  const resolution = inspectAgentExecutableResolution(def, def.configuredEnv ?? {}, options.resolve ?? {});
  const diagnostics: AgentDiagnostic[] = [];

  if (!resolution.selectedPath) {
    diagnostics.push(agentNotOnPathDiagnostic(def, resolution));
    return {
      id: def.id,
      name: def.name,
      available: false,
      version: null,
      models: def.fallbackModels,
      modelsSource: "fallback",
      authStatus: "unknown",
      diagnostics,
    };
  }

  const executablePath = resolution.selectedPath;
  const version = await probeVersion(def, executablePath, invoke, options, diagnostics);
  const { models, modelsSource } = await probeModels(def, executablePath, invoke, options, diagnostics);
  const auth = await probeAuth(def, executablePath, invoke, options, diagnostics);

  return {
    id: def.id,
    name: def.name,
    available: true,
    path: executablePath,
    version,
    models,
    modelsSource,
    authStatus: auth.status,
    authMessage: auth.message,
    diagnostics,
  };
}

async function probeVersion(
  def: RuntimeAgentDef,
  executablePath: string,
  invoke: ProbeInvoker,
  options: DetectionOptions,
  diagnostics: AgentDiagnostic[],
): Promise<string | null> {
  const result = await invokeProbe(def, executablePath, def.versionArgs, def.inactivityTimeoutMs, invoke, options);

  if (result.ok) {
    return firstOutputLine(result) ?? null;
  }

  diagnostics.push({
    code: "agent.version_probe_failed",
    severity: "warning",
    message: `${def.name} version probe failed.`,
    details: probeFailureDetails(def, executablePath, result),
  });
  return null;
}

async function probeModels(
  def: RuntimeAgentDef,
  executablePath: string,
  invoke: ProbeInvoker,
  options: DetectionOptions,
  diagnostics: AgentDiagnostic[],
): Promise<{ models: RuntimeModelOption[]; modelsSource: DetectedAgent["modelsSource"] }> {
  if (!def.listModels) {
    diagnostics.push(modelsFallbackDiagnostic(def, "No live model probe is configured."));
    return { models: def.fallbackModels, modelsSource: "fallback" };
  }

  try {
    const result = await invokeProbe(def, executablePath, def.listModels.args, def.listModels.timeoutMs, invoke, options);
    if (!result.ok) {
      diagnostics.push({
        code: "agent.models_probe_failed",
        severity: "warning",
        message: `${def.name} model probe failed.`,
        details: probeFailureDetails(def, executablePath, result),
      });
      diagnostics.push(modelsFallbackDiagnostic(def, stderrOrError(result) ?? "Live model probe failed."));
      return { models: def.fallbackModels, modelsSource: "fallback" };
    }

    const parsed = def.listModels.parse(result.stdout);
    if (parsed && parsed.length > 0) {
      return { models: parsed, modelsSource: "live" };
    }

    diagnostics.push(modelsFallbackDiagnostic(def, "Live model probe returned no models."));
    return { models: def.fallbackModels, modelsSource: "fallback" };
  } catch (cause) {
    diagnostics.push({
      code: "agent.models_probe_failed",
      severity: "warning",
      message: `${def.name} model probe could not be parsed.`,
      details: {
        agentId: def.id,
        path: executablePath,
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    });
    diagnostics.push(modelsFallbackDiagnostic(def, cause instanceof Error ? cause.message : String(cause)));
    return { models: def.fallbackModels, modelsSource: "fallback" };
  }
}

async function probeAuth(
  def: RuntimeAgentDef,
  executablePath: string,
  invoke: ProbeInvoker,
  options: DetectionOptions,
  diagnostics: AgentDiagnostic[],
): Promise<{ status: NonNullable<DetectedAgent["authStatus"]>; message?: string }> {
  if (!def.authProbe) {
    return { status: "unknown" };
  }

  const result = await invokeProbe(def, executablePath, def.authProbe.args, def.authProbe.timeoutMs, invoke, options);
  if (result.ok) {
    return { status: "ok", message: firstOutputLine(result) ?? undefined };
  }

  const message = stderrOrError(result) ?? `${def.name} auth probe failed.`;
  diagnostics.push({
    code: "agent.auth_missing",
    severity: "warning",
    message: `${def.name} authentication is missing or unavailable.`,
    details: probeFailureDetails(def, executablePath, result),
  });

  return { status: "missing", message };
}

async function invokeProbe(
  def: RuntimeAgentDef,
  executablePath: string,
  args: string[],
  timeoutMs: number | undefined,
  invoke: ProbeInvoker,
  options: DetectionOptions,
): Promise<ProbeInvocationResult> {
  try {
    return await invoke({
      executablePath,
      args,
      env: def.configuredEnv,
      timeoutMs: timeoutMs ?? options.defaultProbeTimeoutMs ?? defaultProbeTimeoutMs,
    });
  } catch (cause) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
      timedOut: false,
      error: cause instanceof Error ? cause : new Error(String(cause)),
    };
  }
}

function detectionFailureAgent(def: RuntimeAgentDef, cause: unknown): DetectedAgent {
  return {
    id: def.id,
    name: def.name,
    available: false,
    version: null,
    models: def.fallbackModels,
    modelsSource: "fallback",
    authStatus: "unknown",
    diagnostics: [
      {
        code: "agent.detection_failed",
        severity: "error",
        message: `${def.name} detection failed.`,
        details: {
          agentId: def.id,
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      },
    ],
  };
}

function modelsFallbackDiagnostic(def: RuntimeAgentDef, reason: string): AgentDiagnostic {
  return {
    code: "agent.models_fallback",
    severity: "info",
    message: `${def.name} is using fallback models.`,
    details: { agentId: def.id, reason },
  };
}

function firstOutputLine(result: ProbeInvocationResult): string | null {
  const output = result.stdout.trim() || result.stderr.trim();
  return output.split(/\r?\n/u).find((line) => line.trim().length > 0)?.trim() ?? null;
}

function stderrOrError(result: ProbeInvocationResult): string | null {
  return firstOutputLine({
    ...result,
    stdout: result.stderr,
    stderr: result.error?.message ?? "",
  });
}

function probeFailureDetails(
  def: RuntimeAgentDef,
  executablePath: string,
  result: ProbeInvocationResult,
): Record<string, unknown> {
  return {
    agentId: def.id,
    path: executablePath,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    stderr: result.stderr.trim() || undefined,
    error: result.error?.message,
  };
}
