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

    expect(claude?.buildArgs({
      prompt: "hello",
      options: { model: "sonnet" },
      resumeSessionId: "session-1",
    })).toEqual(expect.arrayContaining(["--output-format", "stream-json", "--resume", "session-1"]));
  });

  it("builds ACP args for Cursor Agent", () => {
    const cursor = createAgentRegistry().get("cursor-agent");

    expect(cursor?.streamFormat).toBe("acp-json-rpc");
    expect(cursor?.buildArgs({ prompt: "hello" })).toEqual(expect.arrayContaining(["--acp"]));
  });
});
