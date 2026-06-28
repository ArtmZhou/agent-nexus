import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentBinEnvKey, inspectAgentExecutableResolution, resolveOnPath } from "../../src/runtimes/executables.js";
import type { RuntimeAgentDef } from "../../src/runtimes/types.js";

function def(id: string, bin = id): RuntimeAgentDef {
  return {
    id,
    name: id,
    bin,
    versionArgs: ["--version"],
    fallbackModels: [{ id: "default", label: "Default" }],
    buildArgs: () => [],
    streamFormat: "plain",
  };
}

function tempDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `agent-nexus-${name}-`));
}

describe("agentBinEnvKey", () => {
  it("maps known agent ids to explicit binary env vars", () => {
    expect(agentBinEnvKey("codex")).toBe("CODEX_BIN");
    expect(agentBinEnvKey("cursor-agent")).toBe("CURSOR_AGENT_BIN");
  });

  it("returns null for unknown agent ids", () => {
    expect(agentBinEnvKey("custom-agent")).toBeNull();
  });
});

describe("resolveOnPath", () => {
  it("finds executables in supplied directories", () => {
    const root = tempDir("path");
    const bin = process.platform === "win32" ? "demo.cmd" : "demo";
    const executablePath = join(root, bin);
    writeFileSync(executablePath, process.platform === "win32" ? "@echo off\n" : "#!/bin/sh\n");
    if (process.platform !== "win32") chmodSync(executablePath, 0o755);

    expect(resolveOnPath("demo", { pathDirs: [root], platform: process.platform })).toBe(executablePath);
  });

  it("accepts an absolute executable bin path without PATH lookup", () => {
    expect(resolveOnPath(process.execPath, { pathDirs: [], platform: process.platform })).toBe(process.execPath);
  });

  it("uses PATHEXT candidates when resolving Windows executables", () => {
    const root = tempDir("pathext");
    const executablePath = join(root, "demo.CMD");
    writeFileSync(executablePath, "@echo off\n");

    expect(resolveOnPath("demo", {
      env: { PATHEXT: ".COM;.CMD;.EXE" },
      pathDirs: [root],
      platform: "win32",
    })).toBe(executablePath);
  });
});

describe("inspectAgentExecutableResolution", () => {
  it("prefers configured absolute overrides over PATH", () => {
    const overrideRoot = tempDir("override");
    const pathRoot = tempDir("path-bin");
    const overridePath = join(overrideRoot, process.platform === "win32" ? "codex.cmd" : "codex");
    const pathBin = join(pathRoot, process.platform === "win32" ? "codex.cmd" : "codex");
    writeFileSync(overridePath, process.platform === "win32" ? "@echo off\n" : "#!/bin/sh\n");
    writeFileSync(pathBin, process.platform === "win32" ? "@echo off\n" : "#!/bin/sh\n");
    if (process.platform !== "win32") {
      chmodSync(overridePath, 0o755);
      chmodSync(pathBin, 0o755);
    }

    const result = inspectAgentExecutableResolution(def("codex"), { CODEX_BIN: overridePath }, { pathDirs: [pathRoot] });

    expect(result.configuredOverridePath).toBe(overridePath);
    expect(result.pathResolvedPath).toBe(pathBin);
    expect(result.selectedPath).toBe(overridePath);
    expect(result.overrideEnvKey).toBe("CODEX_BIN");
  });

  it("reports searched bins and dirs when nothing is found", () => {
    const root = tempDir("missing");
    const result = inspectAgentExecutableResolution(def("missing", "missing-bin"), {}, { pathDirs: [root] });

    expect(result.selectedPath).toBeNull();
    expect(result.searchedBins).toEqual(["missing-bin"]);
    expect(result.searchedDirs).toEqual([root]);
  });
});
