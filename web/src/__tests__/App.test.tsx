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
          config: {
            agentsConfigPath: "D:/agent-nexus/agents.local.json",
            agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG"
          },
          agents: [
            {
              id: "codex",
              name: "Codex",
              available: true,
              path: "C:/Tools/codex.exe",
              version: "1.2.3",
              models: [{ id: "gpt-5", label: "GPT-5" }],
              reasoningOptions: [
                { id: "low", label: "Low" },
                { id: "medium", label: "Medium" },
                { id: "high", label: "High" }
              ],
              modelsSource: "live",
              authStatus: "ok",
              diagnostics: []
            },
            {
              id: "claude",
              baseAgentId: "claude",
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

      if (url === "/api/runs") {
        return runsResponse([]);
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
    expect(screen.getByRole("button", { name: /Agent Codex/i })).toHaveTextContent("CX");
    fireEvent.click(screen.getByRole("button", { name: /Agent Codex/i }));
    const agentChoices = await screen.findByRole("group", { name: "Agents" });
    expect(within(agentChoices).getByRole("button", { name: /Codex/i })).toHaveTextContent("CX");
    const unavailableClaude = within(agentChoices).getByRole("button", { name: /Claude/i });
    expect(unavailableClaude).toHaveTextContent("CL");
    expect(unavailableClaude).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(unavailableClaude);
    expect(screen.getByRole("button", { name: /Agent Codex/i })).toBeInTheDocument();
    const inspector = screen.getByRole("complementary", { name: "Run inspector" });
    expect(within(inspector).getByText("No run selected")).toBeInTheDocument();
    expect(within(inspector).getByText("AGENT_NEXUS_AGENTS_CONFIG")).toBeInTheDocument();
    expect(within(inspector).getByText("Claude is not on PATH")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const details = await screen.findByRole("complementary", { name: "Run details" });
    expect(within(details).getByText("Claude is not on PATH")).toBeInTheDocument();
    expect(within(details).getByText("No run selected")).toBeInTheDocument();
    expect(within(details).getByText("Agent config")).toBeInTheDocument();
    expect(within(details).getByText("D:/agent-nexus/agents.local.json")).toBeInTheDocument();
    expect(within(details).getByText("AGENT_NEXUS_AGENTS_CONFIG")).toBeInTheDocument();
    expect(within(details).getByText(/work-codex/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Run details" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByRole("combobox", { name: "Reasoning" })).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getAllByText("canceled").length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: /Build the streaming console/i })).toHaveTextContent("canceled");

    FakeEventSource.instances[0]?.emit("end", { type: "end", status: "canceled" });
    expect(FakeEventSource.instances[0]?.close).toHaveBeenCalled();
  });

  test("surfaces an inline error and a terminal placeholder when the agent fails without text output", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/agents") {
        return jsonResponse({
          diagnostics: [],
          config: {
            agentsConfigPath: "D:/agent-nexus/agents.local.json",
            agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG"
          },
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

      if (url === "/api/runs") {
        return runsResponse([]);
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

  test("only sends reasoning for agents that advertise reasoning options", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/agents") {
        return jsonResponse({
          diagnostics: [],
          config: {
            agentsConfigPath: "D:/agent-nexus/agents.local.json",
            agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG"
          },
          agents: [
            {
              id: "codex",
              name: "Codex",
              available: true,
              path: "C:/Tools/codex.exe",
              version: "1.2.3",
              models: [{ id: "gpt-5", label: "GPT-5" }],
              reasoningOptions: [{ id: "high", label: "High" }],
              modelsSource: "live",
              authStatus: "ok",
              diagnostics: []
            },
            {
              id: "claude",
              name: "Claude",
              available: true,
              path: "C:/Tools/claude.exe",
              version: "2.0.0",
              models: [{ id: "sonnet", label: "Sonnet" }],
              modelsSource: "fallback",
              authStatus: "ok",
              diagnostics: []
            }
          ]
        });
      }

      if (url === "/api/runs" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toMatchObject({
          agentId: "claude",
          model: "sonnet",
          reasoning: null,
          prompt: "Run without Codex reasoning"
        });

        return jsonResponse({
          id: "run-3",
          agentId: "claude",
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

      if (url === "/api/runs") {
        return runsResponse([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Agent Nexus" });
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(screen.getByLabelText("Reasoning"), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: /Agent Codex/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Claude/i }));

    await waitFor(() => expect(screen.queryByLabelText("Reasoning")).not.toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Run without Codex reasoning" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  });

  test("uses stable agent icons for base identities and falls back for unknown agents", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/agents") {
        return jsonResponse({
          diagnostics: [],
          config: {
            agentsConfigPath: "D:/agent-nexus/agents.local.json",
            agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG"
          },
          agents: [
            {
              id: "work-codex",
              baseAgentId: "codex",
              name: "Work Codex",
              available: true,
              models: [{ id: "gpt-5", label: "GPT-5" }],
              modelsSource: "fallback",
              authStatus: "ok",
              diagnostics: []
            },
            {
              id: "custom",
              name: "Custom Agent",
              available: true,
              models: [{ id: "custom-model", label: "Custom Model" }],
              modelsSource: "fallback",
              authStatus: "unknown",
              diagnostics: []
            }
          ]
        });
      }

      if (url === "/api/runs") {
        return runsResponse([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("button", { name: /Agent Work Codex/i })).toHaveTextContent("CX");
    fireEvent.click(screen.getByRole("button", { name: /Agent Work Codex/i }));
    expect(await screen.findByRole("button", { name: /Custom Agent/i })).toHaveTextContent("AG");
    fireEvent.click(screen.getByRole("button", { name: /Custom Agent/i }));
    expect(screen.getByRole("button", { name: /Agent Custom Agent/i })).toHaveTextContent("AG");
  });

  test("defaults to the first available agent and does not run unavailable agents", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/agents") {
        return jsonResponse({
          diagnostics: [],
          config: {
            agentsConfigPath: "D:/agent-nexus/agents.local.json",
            agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG"
          },
          agents: [
            {
              id: "claude",
              baseAgentId: "claude",
              name: "Claude",
              available: false,
              models: [{ id: "sonnet", label: "Sonnet" }],
              modelsSource: "fallback",
              authStatus: "missing",
              diagnostics: []
            },
            {
              id: "codex",
              name: "Codex",
              available: true,
              models: [{ id: "gpt-5", label: "GPT-5" }],
              modelsSource: "live",
              authStatus: "ok",
              diagnostics: []
            }
          ]
        });
      }

      if (url === "/api/runs" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toMatchObject({
          agentId: "codex",
          model: "gpt-5",
          prompt: "Use the available agent"
        });

        return jsonResponse({
          id: "run-available",
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

      if (url === "/api/runs") {
        return runsResponse([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("button", { name: /Agent Codex/i })).toHaveTextContent("CX");
    fireEvent.click(screen.getByRole("button", { name: /Agent Codex/i }));
    const agentChoices = await screen.findByRole("group", { name: "Agents" });
    expect(within(agentChoices).getByRole("button", { name: /Claude/i })).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Use the available agent" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  test("keeps run disabled when every agent is unavailable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/agents") {
        return jsonResponse({
          diagnostics: [],
          config: {
            agentsConfigPath: "D:/agent-nexus/agents.local.json",
            agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG"
          },
          agents: [
            {
              id: "claude",
              baseAgentId: "claude",
              name: "Claude",
              available: false,
              models: [{ id: "sonnet", label: "Sonnet" }],
              modelsSource: "fallback",
              authStatus: "missing",
              diagnostics: []
            }
          ]
        });
      }

      if (url === "/api/runs") {
        return runsResponse([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("button", { name: /Agent Claude/i })).toHaveTextContent("CL");
    fireEvent.click(screen.getByRole("button", { name: /Agent Claude/i }));
    const agentChoices = await screen.findByRole("group", { name: "Agents" });
    expect(within(agentChoices).getByRole("button", { name: /Claude/i })).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Cannot run this" } });
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  test("loads persistent history and replays a selected run transcript", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/agents") {
        return jsonResponse({
          diagnostics: [],
          config: {
            agentsConfigPath: "D:/agent-nexus/agents.local.json",
            agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG"
          },
          agents: [
            {
              id: "codex",
              baseAgentId: "codex",
              name: "Codex",
              available: true,
              models: [{ id: "gpt-5", label: "GPT-5" }],
              modelsSource: "live",
              authStatus: "ok",
              diagnostics: []
            }
          ]
        });
      }

      if (url === "/api/runs") {
        return jsonResponse({
          runs: [
            {
              id: "run-history",
              agentId: "codex",
              status: "succeeded",
              createdAt: 100,
              updatedAt: 200,
              cancelRequested: false,
              childPid: null,
              processGroupId: null,
              exitCode: 0,
              signal: null,
              error: null,
              errorCode: null,
              eventsLogPath: "D:/runs/run-history.jsonl",
              prompt: "Summarize the repo",
              model: "gpt-5",
              reasoning: null,
              cwd: "D:/repo",
              extraAllowedDirs: []
            }
          ]
        });
      }

      if (url === "/api/runs/run-history/events") {
        return sseResponse([
          { id: 1, event: "text_delta", data: { type: "text_delta", delta: "Repo summary" } },
          { id: 2, event: "end", data: { type: "end", status: "succeeded" } }
        ]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("complementary", { name: "Run history" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Summarize the repo/i })).toBeInTheDocument();
    expect(await screen.findByText("Repo summary")).toBeInTheDocument();
  });

  test("does not fetch replay text for active summaries from history", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/agents") {
        return jsonResponse({
          diagnostics: [],
          config: {
            agentsConfigPath: "D:/agent-nexus/agents.local.json",
            agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG"
          },
          agents: [
            {
              id: "codex",
              baseAgentId: "codex",
              name: "Codex",
              available: true,
              models: [{ id: "gpt-5", label: "GPT-5" }],
              modelsSource: "live",
              authStatus: "ok",
              diagnostics: []
            }
          ]
        });
      }

      if (url === "/api/runs") {
        return runsResponse([
          runSummary({
            id: "run-active",
            status: "running",
            prompt: "Still running"
          })
        ]);
      }

      if (url === "/api/runs/run-active/events") {
        throw new Error("Active summaries should not be fetched with text replay");
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("button", { name: /Still running/i })).toHaveTextContent("running");
    expect(await screen.findByText("Waiting for streamed output.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/runs/run-active/events");
  });

  test("ignores stale replay errors after selecting another historical run", async () => {
    let firstReplaySettled = false;
    let rejectFirstReplay: (error: Error) => void = () => undefined;
    const firstReplay = new Promise<Response>((_resolve, reject) => {
      rejectFirstReplay = reject;
    }).finally(() => {
      firstReplaySettled = true;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/agents") {
        return jsonResponse({
          diagnostics: [],
          config: {
            agentsConfigPath: "D:/agent-nexus/agents.local.json",
            agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG"
          },
          agents: [
            {
              id: "codex",
              baseAgentId: "codex",
              name: "Codex",
              available: true,
              models: [{ id: "gpt-5", label: "GPT-5" }],
              modelsSource: "live",
              authStatus: "ok",
              diagnostics: []
            }
          ]
        });
      }

      if (url === "/api/runs") {
        return runsResponse([
          runSummary({ id: "run-a", prompt: "First history" }),
          runSummary({ id: "run-b", prompt: "Second history", createdAt: 90, updatedAt: 120 })
        ]);
      }

      if (url === "/api/runs/run-a/events") {
        return firstReplay;
      }

      if (url === "/api/runs/run-b/events") {
        return sseResponse([{ id: 1, event: "text_delta", data: { type: "text_delta", delta: "Second output" } }]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Second history/i }));
    expect(await screen.findByText("Second output")).toBeInTheDocument();

    rejectFirstReplay(new Error("First replay failed late"));

    await waitFor(() => expect(firstReplaySettled).toBe(true));
    expect(screen.queryByText("First replay failed late")).not.toBeInTheDocument();
    expect(screen.getByText("Second output")).toBeInTheDocument();
  });

  test("copies a historical prompt into the composer without mutating history", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/agents") {
        return jsonResponse({
          diagnostics: [],
          config: {
            agentsConfigPath: "D:/agent-nexus/agents.local.json",
            agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG"
          },
          agents: [
            {
              id: "codex",
              baseAgentId: "codex",
              name: "Codex",
              available: true,
              models: [{ id: "gpt-5", label: "GPT-5" }],
              modelsSource: "live",
              authStatus: "ok",
              diagnostics: []
            }
          ]
        });
      }

      if (url === "/api/runs") {
        return jsonResponse({
          runs: [
            {
              id: "run-copy",
              agentId: "codex",
              status: "succeeded",
              createdAt: 100,
              updatedAt: 200,
              cancelRequested: false,
              childPid: null,
              processGroupId: null,
              exitCode: 0,
              signal: null,
              error: null,
              errorCode: null,
              eventsLogPath: "D:/runs/run-copy.jsonl",
              prompt: "Reuse this prompt",
              model: "gpt-5",
              reasoning: null,
              cwd: null,
              extraAllowedDirs: []
            }
          ]
        });
      }

      if (url === "/api/runs/run-copy/events") {
        return sseResponse([{ id: 1, event: "end", data: { type: "end", status: "succeeded" } }]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("Read-only history")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use prompt again" }));
    expect(screen.getByLabelText("Prompt")).toHaveValue("Reuse this prompt");
    expect(screen.getByRole("button", { name: /Reuse this prompt/i })).toBeInTheDocument();
  });

  test("opens, selects, and closes the agent menu from the keyboard", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/agents") {
        return jsonResponse({
          diagnostics: [],
          config: {
            agentsConfigPath: "D:/agent-nexus/agents.local.json",
            agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG"
          },
          agents: [
            {
              id: "codex",
              name: "Codex",
              available: true,
              models: [{ id: "gpt-5", label: "GPT-5" }],
              modelsSource: "live",
              authStatus: "ok",
              diagnostics: []
            },
            {
              id: "gemini",
              name: "Gemini",
              available: true,
              models: [{ id: "gemini-pro", label: "Gemini Pro" }],
              modelsSource: "fallback",
              authStatus: "ok",
              diagnostics: []
            }
          ]
        });
      }

      if (url === "/api/runs") {
        return runsResponse([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const trigger = await screen.findByRole("button", { name: /Agent Codex/i });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(await screen.findByRole("group", { name: "Agents" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("group", { name: "Agents" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("group", { name: "Agents" })).not.toBeInTheDocument());

    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(await screen.findByRole("button", { name: /Gemini/i }), { key: "Enter" });
    expect(screen.getByRole("button", { name: /Agent Gemini/i })).toHaveTextContent("GM");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function runsResponse(runs: unknown[]): Response {
  return jsonResponse({ runs });
}

function runSummary(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "run-history",
    agentId: "codex",
    status: "succeeded",
    createdAt: 100,
    updatedAt: 200,
    cancelRequested: false,
    childPid: null,
    processGroupId: null,
    exitCode: 0,
    signal: null,
    error: null,
    errorCode: null,
    eventsLogPath: "D:/runs/run-history.jsonl",
    prompt: "Historical prompt",
    model: "gpt-5",
    reasoning: null,
    cwd: null,
    extraAllowedDirs: [],
    ...overrides
  };
}

function sseResponse(events: Array<{ id: number; event: string; data: unknown }>): Response {
  return new Response(
    events
      .map((event) => [`id: ${event.id}`, `event: ${event.event}`, `data: ${JSON.stringify(event.data)}`, "", ""].join("\n"))
      .join(""),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    }
  );
}
