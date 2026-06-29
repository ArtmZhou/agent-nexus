import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentRegistry, listRegisteredAgents } from "../../src/runtimes/registry.js";

function tempDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `agent-nexus-registry-${name}-`));
}

function writeExecutable(dir: string, name: string): string {
  const executablePath = join(dir, process.platform === "win32" ? `${name}.cmd` : name);
  writeFileSync(executablePath, process.platform === "win32" ? "@echo off\n" : "#!/bin/sh\n");
  if (process.platform !== "win32") chmodSync(executablePath, 0o755);
  return executablePath;
}

describe("createAgentRegistry", () => {
  it("contains required built-in agents", () => {
    const registry = createAgentRegistry();

    expect(registry.get("codex")?.name).toBe("Codex CLI");
    expect(registry.get("claude")?.name).toBe("Claude Code");
    expect(registry.get("opencode")?.name).toBe("OpenCode");
    expect(registry.get("gemini")?.name).toBe("Gemini CLI");
    expect(registry.get("cursor-agent")?.name).toBe("Cursor Agent");
  });

  it("applies local profile inheritance, prefixed args, env, and default model", () => {
    const registry = createAgentRegistry({
      profiles: [
        {
          id: "work-codex",
          name: "Work Codex",
          baseAgent: "codex",
          args: ["--profile", "work"],
          defaultModel: "gpt-5.1",
          env: { CODEX_HOME: "/tmp/codex-home" },
        },
      ],
    });

    const profile = registry.get("work-codex");

    expect(profile?.name).toBe("Work Codex");
    expect(profile?.fallbackModels[0]).toEqual({ id: "gpt-5.1", label: "gpt-5.1" });
    expect(profile?.configuredEnv).toEqual({ CODEX_HOME: "/tmp/codex-home" });
    expect(profile?.buildArgs({ prompt: "hello" }).slice(0, 2)).toEqual(["--profile", "work"]);
  });

  it("skips invalid profiles with diagnostics", () => {
    const registry = createAgentRegistry({
      profiles: [
        { id: "bad id", name: "Bad", baseAgent: "codex" },
        { id: "missing-base", name: "Missing", baseAgent: "unknown" },
      ],
    });

    expect(registry.get("bad id")).toBeUndefined();
    expect(registry.get("missing-base")).toBeUndefined();
    expect(registry.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "profile.invalid_id",
      "profile.unknown_base_agent",
    ]);
  });
});

describe("listRegisteredAgents", () => {
  it("combines registry definitions with executable resolution and fallback models", () => {
    const binDir = tempDir("bin");
    const codexPath = writeExecutable(binDir, "codex");
    const agents = listRegisteredAgents(createAgentRegistry(), {
      pathDirs: [binDir],
      platform: process.platform,
      env: { PATH: binDir },
    });

    const codex = agents.find((agent) => agent.id === "codex");
    const claude = agents.find((agent) => agent.id === "claude");

    expect(codex).toMatchObject({
      id: "codex",
      available: true,
      path: codexPath,
      reasoningOptions: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
      ],
      modelsSource: "fallback",
    });
    expect(codex?.models.length).toBeGreaterThan(0);
    expect(claude).toMatchObject({
      id: "claude",
      available: false,
      modelsSource: "fallback",
    });
    expect(claude?.diagnostics?.[0]?.code).toBe("agent.not_on_path");
  });
});
