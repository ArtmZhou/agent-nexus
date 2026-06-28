import type { AgentDiagnostic, DetectedAgent, RunStatusBody, StoredRunEvent } from "@agent-nexus/shared";

type RunInspectorProps = {
  agents: DetectedAgent[];
  diagnostics: AgentDiagnostic[];
  run: RunStatusBody | null;
  rawEvents: StoredRunEvent[];
  onClose: () => void;
};

export function RunInspector({ agents, diagnostics, run, rawEvents, onClose }: RunInspectorProps) {
  const allDiagnostics = [...diagnostics, ...agents.flatMap((agent) => agent.diagnostics ?? [])];

  return (
    <aside className="details-drawer" aria-label="Run details">
      <div className="drawer-head">
        <div>
          <p className="eyebrow">Details</p>
          <h2>Run details</h2>
        </div>
        <button type="button" className="ghost-button" onClick={onClose}>
          Close details
        </button>
      </div>

      {!run && <p className="muted">No run selected</p>}

      <dl className="kv-list">
        <Row label="Run id" value={run?.id ?? "-"} />
        <Row label="Status" value={run?.status ?? "-"} />
        <Row label="PID" value={run?.childPid ?? "-"} />
        <Row label="Process group" value={run?.processGroupId ?? "-"} />
        <Row label="Exit" value={run?.exitCode ?? "-"} />
        <Row label="Signal" value={run?.signal ?? "-"} />
        <Row label="Log path" value={run?.eventsLogPath ?? "-"} />
        <Row label="Error" value={run?.error ?? "-"} />
      </dl>

      <section className="drawer-section">
        <h3>Diagnostics</h3>
        {allDiagnostics.length === 0 ? (
          <p className="muted">No diagnostics reported.</p>
        ) : (
          allDiagnostics.map((diagnostic, index) => (
            <p key={`${diagnostic.code}-${index}`} className={`diagnostic ${diagnostic.severity}`}>
              <span>{diagnostic.code}</span>
              {diagnostic.message}
            </p>
          ))
        )}
      </section>

      <section className="drawer-section">
        <h3>Raw events</h3>
        <pre>{rawEvents.length === 0 ? "No events captured." : JSON.stringify(rawEvents, null, 2)}</pre>
      </section>
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
