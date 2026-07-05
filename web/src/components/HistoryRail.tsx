import type { RunSummary } from "@agent-nexus/shared";
import { AgentIcon } from "./AgentPicker.js";

type HistoryRailProps = {
  runs: RunSummary[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
};

export function HistoryRail({ runs, selectedRunId, onSelect }: HistoryRailProps) {
  return (
    <aside className="history-rail" aria-label="Run history">
      <div className="panel-head">
        <div>
          <p className="eyebrow">History</p>
          <h2>Runs</h2>
        </div>
      </div>

      <div className="history-list">
        {runs.length === 0 ? (
          <p className="muted">No runs yet.</p>
        ) : (
          runs.map((run) => (
            <button
              key={run.id}
              type="button"
              className={`history-item ${run.id === selectedRunId ? "selected" : ""}`}
              aria-pressed={run.id === selectedRunId}
              onClick={() => onSelect(run.id)}
            >
              <span className="history-agent-mark">
                <AgentIcon agent={{ id: run.agentId, name: run.agentId, available: true, models: [], modelsSource: "fallback" }} />
                <span className={`status-dot ${run.status}`} aria-hidden="true" />
              </span>
              <span className="history-copy">
                <strong>{run.prompt}</strong>
                <span>
                  {run.agentId} / {run.model ?? "default model"} / {run.status}
                </span>
                <span>
                  Updated {formatRunTime(run.updatedAt)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

function formatRunTime(timestamp: number): string {
  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 16);
}
