import type { RunStatusBody, StoredRunEvent } from "@agent-nexus/shared";

type RunInspectorProps = {
  run: RunStatusBody | null;
  rawEvents: StoredRunEvent[];
};

export function RunInspector({ run, rawEvents }: RunInspectorProps) {
  return (
    <aside className="run-inspector" aria-label="Run inspector">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Process state</p>
          <h2>Inspector</h2>
        </div>
      </div>

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

      <div className="raw-events">
        <h3>Raw events</h3>
        <pre>{rawEvents.length === 0 ? "No events captured." : JSON.stringify(rawEvents, null, 2)}</pre>
      </div>
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
