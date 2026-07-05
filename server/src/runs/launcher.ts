import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { CreateRunRequest, RunEvent, RunStatusBody } from "@agent-nexus/shared";
import { classifyRunCloseStatus } from "./lifecycle.js";
import type { RunService } from "./service.js";
import { attachAcpSession, type AttachedAcpSession } from "../runtimes/acp.js";
import { prepareAgentCommand } from "../runtimes/command.js";
import { AgentLaunchResolutionError, resolveAgentLaunchConfig } from "../runtimes/launch.js";
import { createClaudeStreamJsonParser } from "../runtimes/parsers/claude-stream.js";
import { createJsonEventStreamParser, type StreamChunkParser } from "../runtimes/parsers/json-event-stream.js";
import type { RuntimeAgentDef } from "../runtimes/types.js";

export type StartAgentRunOptions = {
  runs: RunService;
  runId: string;
  request: CreateRunRequest;
  def: RuntimeAgentDef;
  prompt?: string;
  cwd?: string | null;
  model?: string | null;
  reasoning?: string | null;
  resumeSessionId?: string | null;
  resolvedPath?: string | null;
  env?: Record<string, string | undefined>;
};

export type AgentRunHandle = {
  readonly child: ChildProcessWithoutNullStreams | null;
  readonly done: Promise<RunStatusBody>;
  cancel(message?: string): Promise<RunStatusBody>;
};

type TerminalInput = {
  exitCode: number | null;
  signal: string | null;
  error: Error | null;
};

export function startAgentRun(options: StartAgentRunOptions): AgentRunHandle {
  let child: ChildProcessWithoutNullStreams | null = null;
  let acpSession: AttachedAcpSession | null = null;
  let cancelRequested = false;
  let completedCleanly = false;
  let parserTerminalStatus: Extract<RunEvent, { type: "end" }>["status"] | null = null;
  let streamError: Extract<RunEvent, { type: "error" }> | null = null;
  let terminalPromiseResolve: (body: RunStatusBody) => void = () => undefined;
  const done = new Promise<RunStatusBody>((resolve) => {
    terminalPromiseResolve = resolve;
  });

  try {
    const launch = resolveAgentLaunchConfig(options.def, {
      selectedPath: options.resolvedPath,
      env: options.env
    });
    const cwd = options.cwd ?? options.request.cwd ?? process.cwd();
    const prompt = options.prompt ?? options.request.prompt;
    const args = options.def.buildArgs({
      prompt,
      cwd,
      extraAllowedDirs: options.request.extraAllowedDirs,
      options: {
        model: options.model ?? options.request.model ?? null,
        reasoning: options.reasoning ?? options.request.reasoning ?? null
      },
      resumeSessionId: options.resumeSessionId ?? options.request.resumeSessionId ?? null
    });

    const command = prepareAgentCommand(launch.executablePath, args, process.platform, launch.env);
    child = spawn(command.executablePath, command.args, {
      cwd,
      detached: process.platform !== "win32",
      env: launch.env,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: command.windowsVerbatimArguments,
      stdio: "pipe"
    });

    options.runs.start(options.runId, {
      childPid: child.pid ?? null,
      processGroupId: child.pid ?? null
    });

    const emit = (event: RunEvent) => {
      if (event.type === "end") {
        parserTerminalStatus = event.status;
        completedCleanly = event.status === "succeeded";
        return;
      }
      if (event.type === "error") {
        streamError = event;
      }
      void options.runs.emit(options.runId, event);
    };

    const parser = attachParser(options.def, child, emit, {
      cwd,
      prompt,
      model: options.model ?? options.request.model ?? null,
      resumeSessionId: options.resumeSessionId ?? options.request.resumeSessionId ?? null
    });
    if (parser) {
      child.stdout.on("data", (chunk: string | Uint8Array) => parser.write(chunk));
      child.stdout.on("end", () => parser.end());
    }

    child.stderr.on("data", (chunk: string | Uint8Array) => {
      void options.runs.emit(options.runId, { type: "stderr", chunk: decodeChunk(chunk) });
    });

    child.on("error", (error) => {
      void settle({ exitCode: null, signal: null, error });
    });
    child.on("close", (exitCode, signal) => {
      void settle({ exitCode, signal, error: null });
    });

    writePromptIfNeeded(options.def, child, prompt);
  } catch (error) {
    void failBeforeStart(error);
  }

  return {
    get child() {
      return child;
    },
    done,
    async cancel(message = "Run canceled") {
      cancelRequested = true;
      acpSession?.abort();
      terminateChild(child);
      const body = await options.runs.cancel(options.runId, {
        message,
        code: "user.cancel",
        signal: "SIGTERM"
      });
      terminalPromiseResolve(body);
      return body;
    }
  };

  async function failBeforeStart(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof AgentLaunchResolutionError ? "agent.executable_not_found" : "agent.launch_failed";
    const body = await options.runs.fail(options.runId, { message, code });
    terminalPromiseResolve(body);
  }

  async function settle(input: TerminalInput): Promise<void> {
    const current = options.runs.statusBody(options.runId);
    if (!current || !["queued", "running"].includes(current.status)) {
      terminalPromiseResolve(current ?? await options.runs.wait(options.runId));
      return;
    }

    const status = classifyRunCloseStatus({
      cancelRequested: cancelRequested || current.cancelRequested,
      code: input.exitCode,
      signal: input.signal,
      acpCleanCompletion: acpSession?.completedSuccessfully() ?? false,
      artifactQuietShutdownRequested: false,
      artifactProducedThisRun: false,
      turnCompletedCleanly: completedCleanly,
      parserTerminalStatus
    });

    if (status === "succeeded") {
      if (streamError) {
        terminalPromiseResolve(await options.runs.fail(options.runId, {
          message: streamError.message,
          code: streamError.code ?? "agent.stream_error",
          exitCode: input.exitCode,
          signal: input.signal
        }));
        return;
      }

      terminalPromiseResolve(await options.runs.finish(options.runId, {
        exitCode: input.exitCode,
        signal: input.signal
      }));
      return;
    }

    if (status === "canceled") {
      terminalPromiseResolve(await options.runs.cancel(options.runId, {
        message: "Run canceled",
        code: "user.cancel",
        signal: input.signal
      }));
      return;
    }

    terminalPromiseResolve(await options.runs.fail(options.runId, {
      message: input.error?.message ?? `Agent exited with code ${input.exitCode ?? "null"}`,
      code: input.error ? "agent.process_error" : "agent.exit",
      exitCode: input.exitCode,
      signal: input.signal
    }));
  }

  function attachParser(
    def: RuntimeAgentDef,
    spawned: ChildProcessWithoutNullStreams,
    emit: (event: RunEvent) => void,
    context: { cwd: string; prompt: string; model?: string | null; resumeSessionId?: string | null }
  ): StreamChunkParser | null {
    switch (def.streamFormat) {
      case "json-event-stream":
      case "json-lines":
        return createJsonEventStreamParser(emit);
      case "claude-stream-json":
        return createClaudeStreamJsonParser(emit);
      case "plain":
        return createPlainTextParser(emit);
      case "acp-json-rpc":
        acpSession = attachAcpSession({
          stdin: spawned.stdin,
          stdout: spawned.stdout,
          cwd: context.cwd,
          prompt: context.prompt,
          model: context.model,
          resumeSessionId: context.resumeSessionId,
          emit
        });
        acpSession.start().catch((error: unknown) => {
          void options.runs.emit(options.runId, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
            code: "acp.session"
          });
          terminateChild(spawned);
        });
        return null;
    }
  }
}

function writePromptIfNeeded(def: RuntimeAgentDef, child: ChildProcessWithoutNullStreams, prompt: string): void {
  if (def.streamFormat === "acp-json-rpc") {
    return;
  }

  if (!def.promptViaStdin) {
    child.stdin.end();
    return;
  }

  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE" && error.code !== "EOF") {
      child.emit("error", error);
    }
  });

  const input = def.promptInputFormat === "stream-json"
    ? `${JSON.stringify({ type: "message", role: "user", content: prompt })}\n`
    : prompt;
  child.stdin.end(input);
}

function createPlainTextParser(emit: (event: RunEvent) => void): StreamChunkParser {
  return {
    write(chunk) {
      const text = decodeChunk(chunk);
      if (text) emit({ type: "text_delta", delta: text });
    },
    end() {
      return undefined;
    }
  };
}

function terminateChild(child: ChildProcessWithoutNullStreams | null): void {
  if (!child || child.killed) return;

  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      child.kill("SIGTERM");
      return;
    }
  }

  child.kill("SIGTERM");
}

function decodeChunk(chunk: string | Uint8Array): string {
  return typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
}
