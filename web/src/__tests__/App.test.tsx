import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "../App.js";

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
}

describe("App", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test("runs an agent from the chat workbench and keeps diagnostics in details", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/agents") {
        return jsonResponse({
          diagnostics: [{ code: "profile.loaded", severity: "info", message: "Local profile loaded" }],
          agents: [
            {
              id: "codex",
              name: "Codex",
              available: true,
              path: "C:/Tools/codex.exe",
              version: "1.2.3",
              models: [{ id: "gpt-5", label: "GPT-5" }],
              modelsSource: "live",
              authStatus: "ok",
              diagnostics: []
            },
            {
              id: "claude",
              name: "Claude",
              available: false,
              models: [{ id: "sonnet", label: "Sonnet" }],
              modelsSource: "fallback",
              authStatus: "missing",
              diagnostics: [{ code: "agent.not_on_path", severity: "warning", message: "Claude is not on PATH" }]
            }
          ]
        });
      }

      if (url === "/api/runs" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toMatchObject({
          agentId: "codex",
          model: "gpt-5",
          reasoning: "high",
          cwd: "D:/work",
          extraAllowedDirs: ["D:/work/shared", "D:/work/docs"],
          prompt: "Build the streaming console"
        });

        return jsonResponse({
          id: "run-1",
          agentId: "codex",
          status: "running",
          createdAt: 100,
          updatedAt: 200,
          cancelRequested: false,
          childPid: 4242,
          processGroupId: 4242,
          exitCode: null,
          signal: null,
          error: null,
          errorCode: null,
          eventsLogPath: "D:/logs/run-1.jsonl"
        });
      }

      if (url === "/api/runs/run-1/cancel" && init?.method === "POST") {
        return jsonResponse({
          id: "run-1",
          agentId: "codex",
          status: "canceled",
          createdAt: 100,
          updatedAt: 300,
          cancelRequested: true,
          childPid: 4242,
          processGroupId: 4242,
          exitCode: null,
          signal: "SIGTERM",
          error: null,
          errorCode: null,
          eventsLogPath: "D:/logs/run-1.jsonl"
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Agent Nexus" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Chat workbench" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Run inspector" })).not.toBeInTheDocument();
    expect(screen.queryByText("AGENT_NEXUS_AGENTS_CONFIG")).not.toBeInTheDocument();
    expect(screen.queryByText("Claude is not on PATH")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const details = await screen.findByRole("complementary", { name: "Run details" });
    expect(within(details).getByText("Claude is not on PATH")).toBeInTheDocument();
    expect(within(details).getByText("No run selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Run details" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(screen.getByLabelText("Reasoning"), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Working directory"), { target: { value: "D:/work" } });
    fireEvent.change(screen.getByLabelText("Extra allowed dirs"), { target: { value: "D:/work/shared\nD:/work/docs" } });

    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Build the streaming console" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0]?.emit("text_delta", { type: "text_delta", delta: "Here is code:\n```ts\nconst ok = true;\n```" });
    FakeEventSource.instances[0]?.emit("thinking_delta", { type: "thinking_delta", delta: "Checking tools." });
    FakeEventSource.instances[0]?.emit("tool_use", { type: "tool_use", id: "tool-1", name: "shell", input: { command: "pwd" } });
    FakeEventSource.instances[0]?.emit("tool_result", { type: "tool_result", toolUseId: "tool-1", content: "D:/work" });
    FakeEventSource.instances[0]?.emit("stderr", { type: "stderr", chunk: "warning line" });
    FakeEventSource.instances[0]?.emit("usage", { type: "usage", usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } });

    const stream = screen.getByRole("log", { name: "Messages" });
    expect(await within(stream).findByText("Here is code:")).toBeInTheDocument();
    expect(within(stream).getByText("const ok = true;")).toBeInTheDocument();
    expect(within(stream).getByText("Checking tools.")).toBeInTheDocument();
    expect(within(stream).getByText("shell")).toBeInTheDocument();
    expect(within(stream).getByText("D:/work")).toBeInTheDocument();
    expect(within(stream).getByText("warning line")).toBeInTheDocument();
    expect(within(stream).getByText("14 tokens")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByText("canceled")).toBeInTheDocument());

    FakeEventSource.instances[0]?.emit("end", { type: "end", status: "canceled" });
    expect(FakeEventSource.instances[0]?.close).toHaveBeenCalled();
  });

  test("surfaces an inline error and a terminal placeholder when the agent fails without text output", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/agents") {
        return jsonResponse({
          diagnostics: [],
          agents: [
            {
              id: "codex",
              name: "Codex",
              available: true,
              path: "C:/Tools/codex.exe",
              version: "1.2.3",
              models: [{ id: "gpt-5", label: "GPT-5" }],
              modelsSource: "live",
              authStatus: "ok",
              diagnostics: []
            }
          ]
        });
      }

      if (url === "/api/runs" && init?.method === "POST") {
        return jsonResponse({
          id: "run-2",
          agentId: "codex",
          status: "running",
          createdAt: 100,
          updatedAt: 100,
          cancelRequested: false,
          childPid: null,
          processGroupId: null,
          exitCode: null,
          signal: null,
          error: null,
          errorCode: null,
          eventsLogPath: null
        });
      }

      if (url === "/api/runs/run-2") {
        return jsonResponse({
          id: "run-2",
          agentId: "codex",
          status: "failed",
          createdAt: 100,
          updatedAt: 200,
          cancelRequested: false,
          childPid: null,
          processGroupId: null,
          exitCode: null,
          signal: null,
          error: "Codex executable could not be resolved",
          errorCode: "agent.executable_not_found",
          eventsLogPath: null
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Agent Nexus" });

    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Make it work" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0]?.emit("error", {
      type: "error",
      message: "Codex executable could not be resolved",
      code: "agent.executable_not_found"
    });
    FakeEventSource.instances[0]?.emit("end", { type: "end", status: "failed" });

    const stream = screen.getByRole("log", { name: "Messages" });
    expect(await within(stream).findByText("Codex executable could not be resolved")).toBeInTheDocument();
    expect(within(stream).getByText("agent.executable_not_found")).toBeInTheDocument();
    expect(within(stream).queryByText("Waiting for streamed output.")).not.toBeInTheDocument();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
