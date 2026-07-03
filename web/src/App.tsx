import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentDiagnostic, DetectedAgent, RunEvent, RunStatusBody, RunSummary, StoredRunEvent } from "@agent-nexus/shared";
import {
  cancelRun,
  createRun,
  fetchAgents,
  fetchRun,
  fetchRunEvents,
  fetchRuns,
  subscribeRunEvents,
  type AgentsConfig,
  type RunEventSubscription
} from "./api.js";
import { RunConsole, type ConsoleState } from "./components/RunConsole.js";

const initialConsoleState: ConsoleState = {
  prompt: "",
  reasoning: "",
  cwd: "",
  extraAllowedDirs: ""
};

const fallbackAgentsConfig: AgentsConfig = {
  agentsConfigPath: "",
  agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG"
};

export default function App() {
  const [agents, setAgents] = useState<DetectedAgent[]>([]);
  const [diagnostics, setDiagnostics] = useState<AgentDiagnostic[]>([]);
  const [agentsConfig, setAgentsConfig] = useState<AgentsConfig>(fallbackAgentsConfig);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [consoleState, setConsoleState] = useState<ConsoleState>(initialConsoleState);
  const [currentRun, setCurrentRun] = useState<RunStatusBody | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [rawEvents, setRawEvents] = useState<StoredRunEvent[]>([]);
  const [runSummaries, setRunSummaries] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [eventsByRunId, setEventsByRunId] = useState<Record<string, RunEvent[]>>({});
  const [rawEventsByRunId, setRawEventsByRunId] = useState<Record<string, StoredRunEvent[]>>({});
  const [loadingRunEvents, setLoadingRunEvents] = useState(false);
  const [runEventsError, setRunEventsError] = useState<string | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const subscriptionRef = useRef<RunEventSubscription | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents.find((agent) => agent.available) ?? null,
    [agents, selectedAgentId]
  );
  const running = currentRun?.status === "queued" || currentRun?.status === "running";
  const selectedRunSummary = useMemo(
    () => runSummaries.find((run) => run.id === selectedRunId) ?? null,
    [runSummaries, selectedRunId]
  );
  const selectedRun = selectedRunSummary?.id === currentRun?.id ? currentRun : selectedRunSummary;
  const selectedRunPrompt = selectedRunSummary?.prompt ?? submittedPrompt;
  const selectedRunEvents = selectedRunId ? eventsByRunId[selectedRunId] ?? [] : events;
  const selectedRunRawEvents = selectedRunId ? rawEventsByRunId[selectedRunId] ?? [] : rawEvents;

  useEffect(() => {
    void refreshAgents();
    void refreshRuns();
    return () => subscriptionRef.current?.close();
  }, []);

  useEffect(() => {
    if (!selectedAgent && agents.length === 0) return;
    const nextAgent = selectedAgent ?? agents.find((agent) => agent.available) ?? null;

    if (!nextAgent) {
      if (selectedAgentId) setSelectedAgentId(null);
      if (selectedModel) setSelectedModel("");
      return;
    }

    if (selectedAgentId !== nextAgent.id) {
      setSelectedAgentId(nextAgent.id);
    }

    if (!nextAgent.models.some((model) => model.id === selectedModel)) {
      setSelectedModel(nextAgent.models[0]?.id ?? "");
    }

    if (consoleState.reasoning && !agentSupportsReasoning(nextAgent, consoleState.reasoning)) {
      setConsoleState((previous) => previous.reasoning ? { ...previous, reasoning: "" } : previous);
    }
  }, [agents, consoleState.reasoning, selectedAgent, selectedAgentId, selectedModel]);

  async function refreshAgents(): Promise<void> {
    setLoadingAgents(true);
    setError(null);
    try {
      const response = await fetchAgents();
      setAgents(response.agents);
      setDiagnostics(response.diagnostics);
      setAgentsConfig(response.config);
      const nextAgent = chooseRunnableAgent(response.agents, selectedAgentId);
      if (nextAgent) {
        setSelectedAgentId(nextAgent.id);
        setSelectedModel(nextAgent.models[0]?.id ?? "");
      } else {
        setSelectedAgentId(null);
        setSelectedModel("");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingAgents(false);
    }
  }

  async function refreshRuns(): Promise<void> {
    try {
      const response = await fetchRuns();
      setRunSummaries(response.runs);
      const nextRunId = selectedRunId ?? response.runs[0]?.id ?? null;
      setSelectedRunId(nextRunId);
      if (nextRunId) {
        void loadRunEvents(nextRunId);
      }
    } catch (caught) {
      setRunEventsError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function selectRun(runId: string): void {
    setSelectedRunId(runId);
    if (!rawEventsByRunId[runId]) {
      void loadRunEvents(runId);
    }
  }

  async function loadRunEvents(runId: string): Promise<void> {
    setLoadingRunEvents(true);
    setRunEventsError(null);
    try {
      const storedEvents = await fetchRunEvents(runId);
      setRawEventsByRunId((previous) => ({ ...previous, [runId]: storedEvents }));
      setEventsByRunId((previous) => ({ ...previous, [runId]: storedEvents.map((event) => event.data) }));
    } catch (caught) {
      setRunEventsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingRunEvents(false);
    }
  }

  function selectAgent(agentId: string): void {
    const agent = agents.find((candidate) => candidate.id === agentId);
    if (!agent?.available) return;
    setSelectedAgentId(agentId);
    setSelectedModel(agent?.models[0]?.id ?? "");
    setConsoleState((previous) =>
      previous.reasoning && (!agent || !agentSupportsReasoning(agent, previous.reasoning))
        ? { ...previous, reasoning: "" }
        : previous
    );
  }

  async function startRun(): Promise<void> {
    if (!selectedAgentId || !selectedAgent?.available) return;
    const prompt = consoleState.prompt;
    if (!prompt.trim()) return;

    setError(null);
    subscriptionRef.current?.close();
    setEvents([]);
    setRawEvents([]);
    setSubmittedPrompt(prompt);
    setConsoleState((previous) => ({ ...previous, prompt: "" }));

    try {
      const reasoning = selectedAgent && agentSupportsReasoning(selectedAgent, consoleState.reasoning)
        ? consoleState.reasoning
        : "";
      const extraAllowedDirs = consoleState.extraAllowedDirs
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
      const run = await createRun({
        agentId: selectedAgentId,
        model: selectedModel || null,
        reasoning: reasoning.trim() || null,
        cwd: consoleState.cwd.trim() || null,
        prompt,
        extraAllowedDirs
      });

      setCurrentRun(run);
      const summary: RunSummary = {
        ...run,
        prompt,
        model: selectedModel || null,
        reasoning: reasoning.trim() || null,
        cwd: consoleState.cwd.trim() || null,
        extraAllowedDirs
      };
      setRunSummaries((previous) => [summary, ...previous.filter((item) => item.id !== run.id)]);
      setSelectedRunId(run.id);
      setEventsByRunId((previous) => ({ ...previous, [run.id]: [] }));
      setRawEventsByRunId((previous) => ({ ...previous, [run.id]: [] }));
      subscriptionRef.current = subscribeRunEvents(
        run.id,
        (storedEvent) => {
          setRawEvents((previous) => [...previous, storedEvent]);
          setEvents((previous) => [...previous, storedEvent.data]);
          setRawEventsByRunId((previous) => ({ ...previous, [run.id]: [...(previous[run.id] ?? []), storedEvent] }));
          setEventsByRunId((previous) => ({ ...previous, [run.id]: [...(previous[run.id] ?? []), storedEvent.data] }));
          if (storedEvent.data.type === "end") {
            const terminalStatus = storedEvent.data.status;
            setCurrentRun((previous) => previous ? { ...previous, status: terminalStatus, updatedAt: Date.now() } : previous);
            setRunSummaries((previous) =>
              previous.map((item) => item.id === run.id ? { ...item, status: terminalStatus, updatedAt: Date.now() } : item)
            );
            subscriptionRef.current?.close();
            void fetchRun(run.id)
              .then((latest) => {
                setCurrentRun(latest);
                setRunSummaries((previous) =>
                  previous.map((item) => item.id === latest.id ? { ...item, ...latest } : item)
                );
              })
              .catch(() => undefined);
          }
        },
        () => setError("Run event stream disconnected")
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function stopRun(): Promise<void> {
    if (!currentRun) return;
    setError(null);
    try {
      const canceled = await cancelRun(currentRun.id);
      setCurrentRun(canceled);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <div className="app-shell">
      {error && (
        <div className="app-error" role="alert">
          {error}
        </div>
      )}

      <RunConsole
        agents={agents}
        diagnostics={diagnostics}
        agentsConfig={agentsConfig}
        selectedAgentId={selectedAgentId}
        selectedModel={selectedModel}
        state={consoleState}
        currentRun={currentRun}
        runSummaries={runSummaries}
        selectedRunId={selectedRunId}
        selectedRunPrompt={selectedRunPrompt}
        selectedRunEvents={selectedRunEvents}
        selectedRunRawEvents={selectedRunRawEvents}
        selectedRun={selectedRun}
        loadingRunEvents={loadingRunEvents}
        runEventsError={runEventsError}
        running={running}
        loadingAgents={loadingAgents}
        detailsOpen={detailsOpen}
        advancedOpen={advancedOpen}
        submittedPrompt={submittedPrompt}
        onAgentChange={selectAgent}
        onModelChange={setSelectedModel}
        onStateChange={setConsoleState}
        onRun={startRun}
        onCancel={stopRun}
        onRunSelect={selectRun}
        onRefresh={refreshAgents}
        onDetailsOpenChange={setDetailsOpen}
        onAdvancedOpenChange={setAdvancedOpen}
      />
    </div>
  );
}

function agentSupportsReasoning(agent: DetectedAgent, reasoning: string): boolean {
  return (agent.reasoningOptions ?? []).some((option) => option.id === reasoning);
}

function chooseRunnableAgent(agents: DetectedAgent[], selectedAgentId: string | null): DetectedAgent | null {
  const current = agents.find((agent) => agent.id === selectedAgentId && agent.available);
  return current ?? agents.find((agent) => agent.available) ?? null;
}
