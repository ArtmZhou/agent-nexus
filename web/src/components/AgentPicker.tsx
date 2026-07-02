import { useId, useState } from "react";
import type { DetectedAgent } from "@agent-nexus/shared";

type AgentPickerProps = {
  agents: DetectedAgent[];
  selectedAgentId: string | null;
  selectedModel: string;
  onSelect: (agentId: string) => void;
};

const iconByAgentId: Record<string, string> = {
  codex: "CX",
  claude: "CL",
  opencode: "OC",
  gemini: "GM",
  "cursor-agent": "CA",
};

export function AgentPicker({ agents, selectedAgentId, selectedModel, onSelect }: AgentPickerProps) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;

  return (
    <div className="agent-picker">
      <span className="control-label" id={`${listboxId}-label`}>
        Agent
      </span>
      <button
        type="button"
        className="agent-picker-button"
        aria-label={`Agent ${selectedAgent?.name ?? "none"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((value) => !value)}
      >
        <AgentIcon agent={selectedAgent} />
        <span className="agent-picker-copy">
          <strong>{selectedAgent?.name ?? "No agent"}</strong>
          <span>{agentMeta(selectedAgent, selectedModel)}</span>
        </span>
      </button>

      {open && (
        <div className="agent-picker-menu" id={listboxId} role="listbox" aria-label="Agents">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              role="option"
              aria-selected={agent.id === selectedAgent?.id}
              aria-disabled={!agent.available}
              className={`agent-picker-option ${agent.id === selectedAgent?.id ? "selected" : ""}`}
              onClick={() => {
                if (!agent.available) return;
                onSelect(agent.id);
                setOpen(false);
              }}
            >
              <AgentIcon agent={agent} />
              <span className="agent-picker-copy">
                <strong>{agent.name}</strong>
                <span>{agentMeta(agent, agent.models[0]?.label ?? "")}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentIcon({ agent }: { agent: DetectedAgent | null }) {
  return (
    <span className="agent-icon" aria-hidden="true">
      {agentIcon(agent)}
    </span>
  );
}

export function agentIcon(agent: DetectedAgent | null): string {
  if (!agent) return "AG";
  return iconByAgentId[agent.baseAgentId ?? agent.id] ?? "AG";
}

function agentMeta(agent: DetectedAgent | null, selectedModel: string): string {
  if (!agent) return "No runtime selected";
  const availability = agent.available ? "available" : "missing";
  const auth = agent.authStatus ?? "auth unknown";
  const model = selectedModel || agent.models[0]?.label || "model unknown";
  return `${model} / ${availability} / ${auth}`;
}
