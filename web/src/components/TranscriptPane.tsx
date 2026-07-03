import type { RunEvent, RunStatusBody } from "@agent-nexus/shared";
import { MessageStream } from "./MessageStream.js";

type TranscriptPaneProps = {
  currentRun: RunStatusBody | null;
  events: RunEvent[];
  prompt: string;
  loading?: boolean;
  error?: string | null;
};

export function TranscriptPane({ currentRun, events, prompt, loading = false, error = null }: TranscriptPaneProps) {
  return (
    <section className="transcript-pane" aria-label="Transcript">
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
