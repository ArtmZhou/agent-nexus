import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RuntimeModelOption } from "@agent-nexus/shared";
import { detectLocalAgents } from "../../src/runtimes/detection.js";
import { parseLineModels } from "../../src/runtimes/models.js";
import type { AgentRegistry } from "../../src/runtimes/registry.js";
import type { RuntimeAgentDef } from "../../src/runtimes/types.js";

function tempDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `agent-nexus-detection-${name}-`));
}

function writeProbeScript(name: string, source: string): string {
  const root = tempDir(name);
  const scriptPath = join(root, "probe.mjs");
  writeFileSync(scriptPath, source, "utf8");
  if (process.platform !== "win32") chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function registry(defs: RuntimeAgentDef[]): AgentRegistry {
  return {
    diagnostics: [],
    get: (id) => defs.find((def) => def.id === id),
    list: () => defs,
  };
}

function nodeAgent(
  id: string,
  scriptPath: string,
  options: {
    modelsParser?: (stdout: string) => RuntimeModelOption[] | null;
    authProbe?: string[];
    reasoningOptions?: RuntimeModelOption[];
  } = {},
): RuntimeAgentDef {
  return {
    id,
    name: id,
    bin: basename(process.execPath),
    versionArgs: [scriptPath, "version"],
    fallbackModels: [{ id: `${id}-fallback`, label: `${id} Fallback` }],
    listModels: {
      args: [scriptPath, "models"],
      parse: options.modelsParser ?? parseLineModels,
    },
    authProbe: options.authProbe ? { args: [scriptPath, ...options.authProbe] } : undefined,
    reasoningOptions: options.reasoningOptions,
    buildArgs: () => [],
    streamFormat: "plain",
  };
}

describe("detectLocalAgents", () => {
  it("keeps detecting other agents when one adapter probe fails", async () => {
    const scriptPath = writeProbeScript("isolated", `
      const mode = process.argv[2];
      if (mode === "version") console.log("ok-agent 1.2.3");
      if (mode === "models") console.log("live-model");
    `);
    const good = nodeAgent("good", scriptPath);
    const bad = nodeAgent("bad", scriptPath, {
      modelsParser: () => {
        throw new Error("bad parser");
      },
    });

    const agents = await detectLocalAgents(registry([bad, good]), {
      resolve: { pathDirs: [dirname(process.execPath)] },
    });

    expect(agents.find((agent) => agent.id === "good")).toMatchObject({
      available: true,
      version: "ok-agent 1.2.3",
      models: [{ id: "live-model", label: "live-model" }],
      modelsSource: "live",
    });
    expect(agents.find((agent) => agent.id === "bad")).toMatchObject({
      available: true,
      models: [{ id: "bad-fallback", label: "bad Fallback" }],
      modelsSource: "fallback",
    });
    expect(agents.find((agent) => agent.id === "bad")?.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
      "agent.models_probe_failed",
    );
  });

  it("captures a successful version probe", async () => {
    const scriptPath = writeProbeScript("version", `
      if (process.argv[2] === "version") console.log("Versioned CLI 9.8.7");
      if (process.argv[2] === "models") console.log("alpha");
    `);

    const [agent] = await detectLocalAgents(registry([nodeAgent("versioned", scriptPath)]), {
      resolve: { pathDirs: [dirname(process.execPath)] },
    });

    expect(agent).toMatchObject({
      available: true,
      path: process.execPath,
      version: "Versioned CLI 9.8.7",
    });
  });

  it("includes runtime reasoning options in detected agents", async () => {
    const scriptPath = writeProbeScript("reasoning", `
      if (process.argv[2] === "version") console.log("reasoning-agent 1.0.0");
      if (process.argv[2] === "models") console.log("alpha");
    `);

    const [agent] = await detectLocalAgents(registry([
      nodeAgent("reasoning", scriptPath, {
        reasoningOptions: [{ id: "high", label: "High" }],
      }),
    ]), {
      resolve: { pathDirs: [dirname(process.execPath)] },
    });

    expect(agent.reasoningOptions).toEqual([{ id: "high", label: "High" }]);
  });

  it("uses fallback models and diagnostics when the live model probe fails", async () => {
    const scriptPath = writeProbeScript("models-fallback", `
      const mode = process.argv[2];
      if (mode === "version") console.log("fallback-models 1.0.0");
      if (mode === "models") {
        console.error("models unavailable");
        process.exit(7);
      }
    `);

    const [agent] = await detectLocalAgents(registry([nodeAgent("fallback", scriptPath)]), {
      resolve: { pathDirs: [dirname(process.execPath)] },
    });

    expect(agent.modelsSource).toBe("fallback");
    expect(agent.models).toEqual([{ id: "fallback-fallback", label: "fallback Fallback" }]);
    expect(agent.diagnostics?.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["agent.models_probe_failed", "agent.models_fallback"]),
    );
  });

  it("reports auth unknown when no auth probe exists and missing when the probe fails", async () => {
    const scriptPath = writeProbeScript("auth", `
      const mode = process.argv[2];
      if (mode === "version") console.log("auth-agent 1.0.0");
      if (mode === "models") console.log("auth-model");
      if (mode === "auth-missing") {
        console.error("not logged in");
        process.exit(2);
      }
    `);

    const noProbe = nodeAgent("no-probe", scriptPath, { authProbe: undefined });
    const missing = nodeAgent("missing-auth", scriptPath, { authProbe: ["auth-missing"] });
    const agents = await detectLocalAgents(registry([noProbe, missing]), {
      resolve: { pathDirs: [dirname(process.execPath)] },
    });

    expect(agents.find((agent) => agent.id === "no-probe")?.authStatus).toBe("unknown");
    expect(agents.find((agent) => agent.id === "missing-auth")).toMatchObject({
      authStatus: "missing",
      authMessage: "not logged in",
    });
    expect(agents.find((agent) => agent.id === "missing-auth")?.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
      "agent.auth_missing",
    );
  });

  it("returns unavailable agents with path diagnostics without probing", async () => {
    const def: RuntimeAgentDef = {
      id: "missing",
      name: "Missing Agent",
      bin: "definitely-not-agent-nexus",
      versionArgs: ["--version"],
      fallbackModels: [{ id: "fallback", label: "Fallback" }],
      buildArgs: () => [],
      streamFormat: "plain",
    };

    const [agent] = await detectLocalAgents(registry([def]), {
      resolve: { pathDirs: [tempDir("empty-path")] },
    });

    expect(agent).toMatchObject({
      id: "missing",
      available: false,
      version: null,
      modelsSource: "fallback",
      authStatus: "unknown",
    });
    expect(agent.diagnostics?.[0]?.code).toBe("agent.not_on_path");
  });
});
