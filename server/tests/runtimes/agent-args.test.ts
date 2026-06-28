import { describe, expect, it } from "vitest";
import { createAgentRegistry } from "../../src/runtimes/registry.js";

describe("built-in agent buildArgs", () => {
  it("builds Codex streaming args", () => {
    const codex = createAgentRegistry().get("codex");

    expect(codex?.buildArgs({ prompt: "hello", options: { model: "gpt-5" } })).toContain("--json");
    expect(codex?.buildArgs({ prompt: "hello", options: { model: "gpt-5" } })).toContain("gpt-5");
  });

  it("builds Claude stream-json args with resume support", () => {
    const claude = createAgentRegistry().get("claude");

    expect(claude?.promptInputFormat).toBe("text");
    expect(claude?.buildArgs({
      prompt: "hello",
      options: { model: "sonnet" },
      resumeSessionId: "session-1",
      extraAllowedDirs: ["D:/shared"],
    })).toEqual(expect.arrayContaining(["--output-format", "stream-json", "--verbose", "--resume", "session-1", "--add-dir", "D:/shared"]));
  });

  it("builds OpenCode JSON run args with the prompt as the message", () => {
    const opencode = createAgentRegistry().get("opencode");

    expect(opencode?.promptViaStdin).toBe(false);
    expect(opencode?.fallbackModels[0]).toEqual({ id: "", label: "Default" });
    expect(opencode?.buildArgs({
      prompt: "hello from opencode",
      cwd: "D:/work",
      options: { model: "anthropic/claude-sonnet-4" },
    })).toEqual([
      "run",
      "--format",
      "json",
      "--model",
      "anthropic/claude-sonnet-4",
      "--dir",
      "D:/work",
      "hello from opencode",
    ]);
  });

  it("builds ACP args for Cursor Agent", () => {
    const cursor = createAgentRegistry().get("cursor-agent");

    expect(cursor?.streamFormat).toBe("acp-json-rpc");
    expect(cursor?.buildArgs({ prompt: "hello" })).toEqual(expect.arrayContaining(["--acp"]));
  });
});
