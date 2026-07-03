import type { RunEvent, RunStatusBody, RunSummary } from "@agent-nexus/shared";
import { MessageStream } from "./MessageStream.js";

type TranscriptPaneProps = {
  currentRun: RunStatusBody | null;
  events: RunEvent[];
  prompt: string;
  selectedRunSummary: RunSummary | null;
  readOnlyHistory: boolean;
  onReusePrompt: (prompt: string) => void;
  loading?: boolean;
  error?: string | null;
};

export function TranscriptPane({
  currentRun,
  events,
  prompt,
  selectedRunSummary,
  readOnlyHistory,
  onReusePrompt,
  loading = false,
  error = null
}: TranscriptPaneProps) {
  return (
    <section className="transcript-pane" aria-label="Transcript">
      {readOnlyHistory && selectedRunSummary && (
        <div className="history-readonly-banner">
          <div>
            <strong>Read-only history</strong>
            <span>This run has finished. Start a new run to make changes.</span>
          </div>
          <button type="button" className="ghost-button" onClick={() => onReusePrompt(selectedRunSummary.prompt)}>
            Use prompt again
          </button>
        </div>
      )}
      {loading && <p className="muted">Loading run events...</p>}
      {error && (
        <div className="inline-error">
          <strong>history</strong>
          <span>{error}</span>
        </div>
      )}
      <MessageStream currentRun={currentRun} events={events} prompt={prompt} />
    </section>
  );
}
