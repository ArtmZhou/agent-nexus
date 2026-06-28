import type { AgentDiagnostic, DetectedAgent } from "@agent-nexus/shared";

type AgentListProps = {
  agents: DetectedAgent[];
  diagnostics: AgentDiagnostic[];
  selectedAgentId: string | null;
  loading: boolean;
  onRefresh: () => void;
  onSelect: (agentId: string) => void;
};

export function AgentList({ agents, diagnostics, selectedAgentId, loading, onRefresh, onSelect }: AgentListProps) {
  return (
    <aside className="agent-list" aria-label="Agents">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Runtimes</p>
          <h2>Agents</h2>
        </div>
        <button className="ghost-button" type="button" onClick={onRefresh} disabled={loading}>
          {loading ? "Scanning" : "Refresh"}
        </button>
      </div>

      <div className="agent-stack">
        {agents.map((agent) => {
          const selected = agent.id === selectedAgentId;
          const diagnosticsCount = agent.diagnostics?.length ?? 0;
          return (
            <button
              key={agent.id}
              type="button"
              className={`agent-row ${selected ? "selected" : ""}`}
              aria-pressed={selected}
              onClick={() => onSelect(agent.id)}
            >
              <span className={`status-dot ${agent.available ? "ok" : "missing"}`} aria-hidden="true" />
              <span className="agent-main">
                <strong>{agent.name}</strong>
                <span>{agent.path ?? "not on PATH"}</span>
              </span>
              <span className="agent-meta">
                <span>{agent.available ? "available" : "missing"}</span>
                <span>{agent.version ?? "version unknown"}</span>
                <span>{agent.authStatus ?? "auth unknown"}</span>
                <span>{agent.modelsSource}</span>
                <span>{diagnosticsCount === 0 ? "clean" : `${diagnosticsCount} diagnostic${diagnosticsCount === 1 ? "" : "s"}`}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="diagnostics-strip">
        <h3>Diagnostics</h3>
        {[...diagnostics, ...agents.flatMap((agent) => agent.diagnostics ?? [])].length === 0 ? (
          <p>No diagnostics reported.</p>
        ) : (
          [...diagnostics, ...agents.flatMap((agent) => agent.diagnostics ?? [])].map((diagnostic, index) => (
            <p key={`${diagnostic.code}-${index}`} className={`diagnostic ${diagnostic.severity}`}>
              <span>{diagnostic.code}</span>
              {diagnostic.message}
            </p>
          ))
        )}
      </div>
    </aside>
  );
}
