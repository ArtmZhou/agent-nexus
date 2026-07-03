import { useState } from "react";
import type { RunStatusBody } from "@agent-nexus/shared";
import type { AgentsConfig } from "../api.js";

type RunInspectorProps = {
  agentsConfig: AgentsConfig;
  run: RunStatusBody | null;
  onClose?: () => void;
  variant?: "drawer" | "embedded";
};

const localProfileExample = `{
  "agents": [
    {
      "id": "work-codex",
      "name": "Work Codex",
      "baseAgent": "codex",
      "args": ["--profile", "work"],
      "defaultModel": "gpt-5",
      "env": {
        "CODEX_HOME": "D:/agent-nexus/codex"
      }
    }
  ]
}`;

export function RunInspector({ agentsConfig, run, onClose, variant = "drawer" }: RunInspectorProps) {
  const embedded = variant === "embedded";
  const [expanded, setExpanded] = useState(!embedded);

  return (
    <aside className={embedded ? "run-inspector embedded" : "details-drawer"} aria-label={embedded ? "Run inspector" : "Run details"}>
      <div className="drawer-head">
        <div>
          <p className="eyebrow">{embedded ? "Inspector" : "Details"}</p>
          <h2>{embedded ? "Run inspector" : "Run details"}</h2>
        </div>
        {!embedded && (
          <button type="button" className="ghost-button" onClick={onClose}>
            Close details
          </button>
        )}
      </div>

      {embedded && !expanded && (
        <button type="button" className="ghost-button inspector-toggle" onClick={() => setExpanded(true)}>
          Show inspector
        </button>
      )}

      {expanded && (
        <>
          {!run && <p className="muted">No run selected</p>}

          <dl className="kv-list">
            <Row label="Run id" value={run?.id ?? "-"} />
            <Row label="Session" value={run?.sessionId ?? "-"} />
            <Row label="Status" value={run?.status ?? "-"} />
            <Row label="PID" value={run?.childPid ?? "-"} />
            <Row label="Process group" value={run?.processGroupId ?? "-"} />
            <Row label="Exit" value={run?.exitCode ?? "-"} />
            <Row label="Signal" value={run?.signal ?? "-"} />
            <Row label="Log path" value={run?.eventsLogPath ?? "-"} />
            <Row label="Error" value={run?.error ?? "-"} />
          </dl>

          <section className="drawer-section agent-config-section">
            <h3>Agent config</h3>
            <dl className="kv-list">
              <Row label="Config path" value={agentsConfig.agentsConfigPath || "-"} />
              <Row label="Override env" value={agentsConfig.agentsConfigEnvKey} />
            </dl>
            <p className="muted">Edit this file externally, then click Refresh.</p>
            <pre>{localProfileExample}</pre>
          </section>
        </>
      )}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{String(value)}</dd>
    </>
  );
}
