import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execFileProbe } from "../../src/runtimes/invocation.js";

function tempDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `agent-nexus-invocation-${name}-`));
}

describe("execFileProbe", () => {
  it("executes Windows cmd shims without PowerShell or shell=true", async () => {
    if (process.platform !== "win32") return;

    const root = tempDir("cmd");
    const scriptPath = join(root, "probe.mjs");
    const cmdPath = join(root, "probe.cmd");
    writeFileSync(scriptPath, "console.log(JSON.stringify(process.argv.slice(2)))\n", "utf8");
    writeFileSync(cmdPath, `@echo off\r\n"${process.execPath}" "%~dp0probe.mjs" %*\r\n`, "utf8");

    const result = await execFileProbe({
      executablePath: cmdPath,
      args: ["hello", "two words"],
    });

    expect(result).toMatchObject({ ok: true, exitCode: 0 });
    expect(JSON.parse(result.stdout)).toEqual(["hello", "two words"]);
  });
});
