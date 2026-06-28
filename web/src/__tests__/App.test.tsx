import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    vi.restoreAllMocks();
  });

  test("runs an agent and renders streamed output, diagnostics, settings, and inspector data", async () => {
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

    expect(await screen.findByRole("heading", { name: "Local agent console" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Codex/ })).toHaveTextContent("live");
    expect(screen.getByRole("button", { name: /Claude/ })).toHaveTextContent("missing");
    expect(screen.getByText("Claude is not on PATH")).toBeInTheDocument();
    expect(screen.getByText("AGENT_NEXUS_AGENTS_CONFIG")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Build the streaming console" } });
    fireEvent.change(screen.getByLabelText("Reasoning"), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Working directory"), { target: { value: "D:/work" } });
    fireEvent.change(screen.getByLabelText("Extra allowed dirs"), { target: { value: "D:/work/shared\nD:/work/docs" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0]?.url).toBe("/api/runs/run-1/events");

    FakeEventSource.instances[0]?.emit("text_delta", { type: "text_delta", delta: "Hello agent." });
    FakeEventSource.instances[0]?.emit("thinking_delta", { type: "thinking_delta", delta: "Checking tools." });
    FakeEventSource.instances[0]?.emit("tool_use", { type: "tool_use", id: "tool-1", name: "shell", input: { command: "pwd" } });
    FakeEventSource.instances[0]?.emit("stderr", { type: "stderr", chunk: "warning line" });
    FakeEventSource.instances[0]?.emit("usage", { type: "usage", usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } });

    const streamingOutput = screen.getByRole("region", { name: "Streaming output" });
    expect(await within(streamingOutput).findByText("Hello agent.")).toBeInTheDocument();
    expect(within(streamingOutput).getByText("Checking tools.")).toBeInTheDocument();
    expect(within(streamingOutput).getByText(/shell/)).toBeInTheDocument();
    expect(within(streamingOutput).getByText("warning line")).toBeInTheDocument();
    expect(within(streamingOutput).getByText(/14 tokens/)).toBeInTheDocument();

    const inspector = screen.getByRole("complementary", { name: "Run inspector" });
    expect(within(inspector).getByText("run-1")).toBeInTheDocument();
    expect(within(inspector).getAllByText("4242").length).toBeGreaterThan(0);
    expect(within(inspector).getByText("D:/logs/run-1.jsonl")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getAllByText("canceled").length).toBeGreaterThan(0));

    FakeEventSource.instances[0]?.emit("end", { type: "end", status: "canceled" });
    expect(FakeEventSource.instances[0]?.close).toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
