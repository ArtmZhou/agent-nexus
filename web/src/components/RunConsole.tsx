import type { AgentDiagnostic, DetectedAgent, RunEvent, RunStatusBody, RunSummary, StoredRunEvent } from "@agent-nexus/shared";
import type { AgentsConfig } from "../api.js";
import { AgentPicker } from "./AgentPicker.js";
import { HistoryRail } from "./HistoryRail.js";
import { RunInspector } from "./RunInspector.js";
import { TranscriptPane } from "./TranscriptPane.js";

export type ConsoleState = {
  prompt: string;
  reasoning: string;
  cwd: string;
  extraAllowedDirs: string;
};

type RunConsoleProps = {
  agents: DetectedAgent[];
  diagnostics: AgentDiagnostic[];
  agentsConfig: AgentsConfig;
  selectedAgentId: string | null;
  selectedModel: string;
  state: ConsoleState;
  currentRun: RunStatusBody | null;
  runSummaries: RunSummary[];
  selectedRunId: string | null;
  selectedRunPrompt: string;
  selectedRunEvents: RunEvent[];
  selectedRunRawEvents: StoredRunEvent[];
  selectedRun: RunStatusBody | null;
  selectedRunSummary: RunSummary | null;
  readOnlyHistory: boolean;
  loadingRunEvents: boolean;
  runEventsError: string | null;
  running: boolean;
  loadingAgents: boolean;
  detailsOpen: boolean;
  advancedOpen: boolean;
  submittedPrompt: string;
  onAgentChange: (agentId: string) => void;
  onModelChange: (model: string) => void;
  onStateChange: (state: ConsoleState) => void;
  onRun: () => void;
  onCancel: () => void;
  onRunSelect: (runId: string) => void;
  onReusePrompt: (prompt: string) => void;
  onRefresh: () => void;
  onDetailsOpenChange: (open: boolean) => void;
  onAdvancedOpenChange: (open: boolean) => void;
};

export function RunConsole(props: RunConsoleProps) {
  const selectedAgent = props.agents.find((agent) => agent.id === props.selectedAgentId) ?? props.agents[0] ?? null;
  const canRunSelectedAgent = selectedAgent?.available === true && selectedAgent.id === props.selectedAgentId;
  const reasoningOptions = selectedAgent?.reasoningOptions ?? [];
  const selectedReasoningValid = reasoningOptions.some((option) => option.id === props.state.reasoning);

  return (
    <main className="chat-workbench" aria-label="Chat workbench">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Local agent</p>
          <h1>Agent Nexus</h1>
        </div>

        <div className="top-controls">
          <AgentPicker
            agents={props.agents}
            selectedAgentId={props.selectedAgentId}
            selectedModel={props.selectedModel}
            onSelect={props.onAgentChange}
          />

          <label>
            Model
            <select value={props.selectedModel} onChange={(event) => props.onModelChange(event.target.value)}>
              {(selectedAgent?.models ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>

          <span className={`run-state ${props.currentRun?.status ?? "idle"}`}>{props.currentRun?.status ?? "idle"}</span>

          <button type="button" className="ghost-button" onClick={props.onRefresh} disabled={props.loadingAgents}>
            {props.loadingAgents ? "Scanning" : "Refresh"}
          </button>

          <button type="button" className="ghost-button" onClick={() => props.onAdvancedOpenChange(!props.advancedOpen)}>
            Advanced
          </button>

          <button type="button" className="ghost-button" onClick={() => props.onDetailsOpenChange(true)}>
            Details
          </button>
        </div>
      </header>

      {props.advancedOpen && (
        <section className="advanced-panel" aria-label="Advanced run options">
          {reasoningOptions.length > 0 && (
            <label>
              Reasoning
              <select
                value={selectedReasoningValid ? props.state.reasoning : ""}
                onChange={(event) => props.onStateChange({ ...props.state, reasoning: event.target.value })}
                aria-label="Reasoning"
              >
                <option value="">Default</option>
                {reasoningOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            Extra allowed dirs
            <textarea
              value={props.state.extraAllowedDirs}
              onChange={(event) => props.onStateChange({ ...props.state, extraAllowedDirs: event.target.value })}
              aria-label="Extra allowed dirs"
              rows={3}
            />
          </label>
        </section>
      )}

      <div className="workbench-grid three-region">
        <HistoryRail runs={props.runSummaries} selectedRunId={props.selectedRunId} onSelect={props.onRunSelect} />
        <TranscriptPane
          currentRun={props.selectedRun}
          events={props.selectedRunEvents}
          prompt={props.selectedRunPrompt}
          selectedRunSummary={props.selectedRunSummary}
          readOnlyHistory={props.readOnlyHistory}
          onReusePrompt={props.onReusePrompt}
          loading={props.loadingRunEvents}
          error={props.runEventsError}
        />
        <div className="inspector-panel">
          <RunInspector
            variant="embedded"
            run={props.selectedRun}
            agentsConfig={props.agentsConfig}
          />
        </div>
      </div>

      <section className="composer" aria-label="Prompt composer">
        <div className="composer-path-row">
          <label>
            Working path
            <input
              value={props.state.cwd}
              onChange={(event) => props.onStateChange({ ...props.state, cwd: event.target.value })}
              aria-label="Working path"
              placeholder="Use server default"
            />
          </label>
        </div>
        <label className="composer-message-label">
          <textarea
            value={props.state.prompt}
            onChange={(event) => props.onStateChange({ ...props.state, prompt: event.target.value })}
            aria-label="Message"
            placeholder="Ask the selected agent..."
            rows={4}
          />
        </label>

        <div className="run-actions">
          <button
            className="primary-button"
            type="button"
            onClick={props.onRun}
            disabled={props.running || !props.state.prompt.trim() || !canRunSelectedAgent}
          >
            Run
          </button>

          <button className="danger-button" type="button" onClick={props.onCancel} disabled={!props.currentRun || !props.running}>
            Cancel
          </button>
        </div>
      </section>

      {props.detailsOpen && (
        <RunInspector
          run={props.selectedRun}
          agentsConfig={props.agentsConfig}
          onClose={() => props.onDetailsOpenChange(false)}
        />
      )}
    </main>
  );
}
