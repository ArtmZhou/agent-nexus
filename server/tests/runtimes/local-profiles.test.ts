import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLocalProfiles, resolveLocalProfilesPath } from "../../src/runtimes/local-profiles.js";

describe("resolveLocalProfilesPath", () => {
  it("uses AGENT_NEXUS_AGENTS_CONFIG before the home default", () => {
    expect(resolveLocalProfilesPath({
      env: { AGENT_NEXUS_AGENTS_CONFIG: "C:/custom/agents.json" },
      homeDir: "C:/Users/demo",
    })).toBe("C:/custom/agents.json");
  });
});

describe("loadLocalProfiles", () => {
  it("loads valid local profiles from JSON config", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-nexus-profiles-"));
    const configPath = join(root, "agents.local.json");
    writeFileSync(configPath, JSON.stringify({
      agents: [
        {
          id: "work-codex",
          name: "Work Codex",
          baseAgent: "codex",
          bin: "codex-work",
          args: ["--profile", "work"],
          defaultModel: "gpt-5.1",
          env: { CODEX_HOME: "/tmp/codex" },
        },
      ],
    }));

    const loaded = loadLocalProfiles({ configPath });

    expect(loaded.profiles).toHaveLength(1);
    expect(loaded.profiles[0]).toMatchObject({
      id: "work-codex",
      baseAgent: "codex",
      bin: "codex-work",
      args: ["--profile", "work"],
    });
    expect(loaded.diagnostics).toEqual([]);
  });

  it("skips malformed profiles while keeping valid profiles", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-nexus-profiles-"));
    const configPath = join(root, "agents.local.json");
    writeFileSync(configPath, JSON.stringify({
      agents: [
        { id: "bad/id", name: "Bad", baseAgent: "codex" },
        { id: "ok", name: "OK", baseAgent: "codex", env: { "BAD KEY": "value" } },
        { id: "valid", name: "Valid", baseAgent: "codex" },
      ],
    }));

    const loaded = loadLocalProfiles({ configPath });

    expect(loaded.profiles.map((profile) => profile.id)).toEqual(["valid"]);
    expect(loaded.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "profile.invalid_id",
      "profile.invalid_env",
    ]);
  });
});
