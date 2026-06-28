import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentDiagnostic, DetectedAgent, RunEvent, RunStatusBody, StoredRunEvent } from "@agent-nexus/shared";
import { cancelRun, createRun, fetchAgents, subscribeRunEvents, type RunEventSubscription } from "./api.js";
import { AgentList } from "./components/AgentList.js";
import { RunConsole, type ConsoleState } from "./components/RunConsole.js";
import { RunInspector } from "./components/RunInspector.js";
import { SettingsPanel } from "./components/SettingsPanel.js";

const initialConsoleState: ConsoleState = {
  prompt: "",
  reasoning: "",
  cwd: "",
  extraAllowedDirs: ""
};

export default function App() {
  const [agents, setAgents] = useState<DetectedAgent[]>([]);
  const [diagnostics, setDiagnostics] = useState<AgentDiagnostic[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [consoleState, setConsoleState] = useState<ConsoleState>(initialConsoleState);
  const [currentRun, setCurrentRun] = useState<RunStatusBody | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [rawEvents, setRawEvents] = useState<StoredRunEvent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subscriptionRef = useRef<RunEventSubscription | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId]
  );
  const running = currentRun?.status === "queued" || currentRun?.status === "running";

  useEffect(() => {
    void refreshAgents();
    return () => subscriptionRef.current?.close();
  }, []);

  useEffect(() => {
    if (!selectedAgent && agents.length === 0) return;
    const nextAgent = selectedAgent ?? agents[0];
    if (!nextAgent) return;

    if (!selectedAgentId) {
      setSelectedAgentId(nextAgent.id);
    }

    if (!nextAgent.models.some((model) => model.id === selectedModel)) {
      setSelectedModel(nextAgent.models[0]?.id ?? "");
    }
  }, [agents, selectedAgent, selectedAgentId, selectedModel]);

  async function refreshAgents(): Promise<void> {
    setLoadingAgents(true);
    setError(null);
    try {
      const response = await fetchAgents();
      setAgents(response.agents);
      setDiagnostics(response.diagnostics);
      if (!selectedAgentId && response.agents[0]) {
        setSelectedAgentId(response.agents[0].id);
        setSelectedModel(response.agents[0].models[0]?.id ?? "");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingAgents(false);
    }
  }

  function selectAgent(agentId: string): void {
    const agent = agents.find((candidate) => candidate.id === agentId);
    setSelectedAgentId(agentId);
    setSelectedModel(agent?.models[0]?.id ?? "");
  }

  async function startRun(): Promise<void> {
    if (!selectedAgentId) return;
    setError(null);
    subscriptionRef.current?.close();
    setEvents([]);
    setRawEvents([]);

    try {
      const run = await createRun({
        agentId: selectedAgentId,
        model: selectedModel || null,
        reasoning: consoleState.reasoning.trim() || null,
        cwd: consoleState.cwd.trim() || null,
        prompt: consoleState.prompt,
        extraAllowedDirs: consoleState.extraAllowedDirs
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter(Boolean)
      });

      setCurrentRun(run);
      subscriptionRef.current = subscribeRunEvents(
        run.id,
        (storedEvent) => {
          setRawEvents((previous) => [...previous, storedEvent]);
          setEvents((previous) => [...previous, storedEvent.data]);
          if (storedEvent.data.type === "end") {
            const terminalStatus = storedEvent.data.status;
            setCurrentRun((previous) => previous ? { ...previous, status: terminalStatus, updatedAt: Date.now() } : previous);
            subscriptionRef.current?.close();
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
      <AgentList
        agents={agents}
        diagnostics={diagnostics}
        selectedAgentId={selectedAgentId}
        loading={loadingAgents}
        onRefresh={refreshAgents}
        onSelect={selectAgent}
      />

      <div className="workbench">
        {error && (
          <div className="app-error" role="alert">
            {error}
          </div>
        )}
        <RunConsole
          agents={agents}
          selectedAgentId={selectedAgentId}
          selectedModel={selectedModel}
          state={consoleState}
          currentRun={currentRun}
          events={events}
          running={running}
          onAgentChange={selectAgent}
          onModelChange={setSelectedModel}
          onStateChange={setConsoleState}
          onRun={startRun}
          onCancel={stopRun}
        />
        <SettingsPanel selectedAgentId={selectedAgentId} />
      </div>

      <RunInspector run={currentRun} rawEvents={rawEvents} />
    </div>
  );
}
