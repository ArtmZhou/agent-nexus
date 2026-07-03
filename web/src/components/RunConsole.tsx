import type { AgentDiagnostic, DetectedAgent, RunEvent, RunStatusBody, StoredRunEvent } from "@agent-nexus/shared";
import type { AgentsConfig } from "../api.js";
import { AgentPicker } from "./AgentPicker.js";
import { MessageStream } from "./MessageStream.js";
import { RunInspector } from "./RunInspector.js";

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
  events: RunEvent[];
  rawEvents: StoredRunEvent[];
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
            Working directory
            <input
              value={props.state.cwd}
              onChange={(event) => props.onStateChange({ ...props.state, cwd: event.target.value })}
              aria-label="Working directory"
            />
          </label>

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

      <MessageStream currentRun={props.currentRun} events={props.events} prompt={props.submittedPrompt} />

      <section className="composer" aria-label="Prompt composer">
        <label>
          Prompt
          <textarea
            value={props.state.prompt}
            onChange={(event) => props.onStateChange({ ...props.state, prompt: event.target.value })}
            aria-label="Prompt"
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
          run={props.currentRun}
          rawEvents={props.rawEvents}
          agents={props.agents}
          diagnostics={props.diagnostics}
          agentsConfig={props.agentsConfig}
          onClose={() => props.onDetailsOpenChange(false)}
        />
      )}
    </main>
  );
}
