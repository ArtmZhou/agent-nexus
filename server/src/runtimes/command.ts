import { extname } from "node:path";

export type PreparedAgentCommand = {
  args: string[];
  executablePath: string;
  windowsVerbatimArguments?: boolean;
};

export function prepareAgentCommand(
  executablePath: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): PreparedAgentCommand {
  if (platform !== "win32" || !isWindowsCommandScript(executablePath)) {
    return { executablePath, args };
  }

  return {
    executablePath: env.ComSpec ?? env.comspec ?? "cmd.exe",
    args: ["/d", "/s", "/c", buildCmdCommandLine(executablePath, args)],
    windowsVerbatimArguments: true,
  };
}

function isWindowsCommandScript(executablePath: string): boolean {
  const ext = extname(executablePath).toLowerCase();
  return ext === ".cmd" || ext === ".bat";
}

function buildCmdCommandLine(executablePath: string, args: string[]): string {
  return `"${[executablePath, ...args].map(quoteCmdArg).join(" ")}"`;
}

function quoteCmdArg(arg: string): string {
  const normalized = arg.replace(/\r?\n/gu, " ");
  const escaped = normalized.replace(/(["^&|<>()%!])/gu, "^$1");
  return `"${escaped}"`;
}
