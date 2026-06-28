import { execFile } from "node:child_process";
import { prepareAgentCommand } from "./command.js";

export type ProbeInvocationOptions = {
  executablePath: string;
  args: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  timeoutMs?: number;
  maxBuffer?: number;
};

export type ProbeInvocationResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  error: Error | null;
};

type ExecFileError = Error & {
  code?: string | number | null;
  signal?: NodeJS.Signals | null;
  killed?: boolean;
};

export function execFileProbe(options: ProbeInvocationOptions): Promise<ProbeInvocationResult> {
  return new Promise((resolve) => {
    const command = prepareAgentCommand(options.executablePath, options.args, process.platform, options.env);
    execFile(
      command.executablePath,
      command.args,
      {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        maxBuffer: options.maxBuffer ?? 1024 * 1024,
        shell: false,
        timeout: options.timeoutMs,
        windowsVerbatimArguments: command.windowsVerbatimArguments,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const execError = error as ExecFileError | null;
        const exitCode = typeof execError?.code === "number" ? execError.code : error ? 1 : 0;
        resolve({
          ok: error === null,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          exitCode,
          signal: execError?.signal ?? null,
          timedOut: execError?.code === "ETIMEDOUT" || (execError?.killed === true && execError.signal === "SIGTERM"),
          error: error ?? null,
        });
      },
    );
  });
}
