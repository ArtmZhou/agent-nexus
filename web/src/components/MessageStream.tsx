import type { RunEvent, RunStatusBody, TokenUsage } from "@agent-nexus/shared";
import { MarkdownLite } from "./MarkdownLite.js";

type MessageStreamProps = {
  currentRun: RunStatusBody | null;
  events: RunEvent[];
  prompt: string;
};

type TranscriptTool = {
  id: string;
  name: string;
  input?: unknown;
  result?: string;
  isError?: boolean;
};

type Transcript = {
  assistantText: string;
  thinking: string;
  tools: TranscriptTool[];
  stderr: string;
  errors: Array<{ message: string; code?: string }>;
  usage: TokenUsage | null;
};

export function MessageStream({ currentRun, events, prompt }: MessageStreamProps) {
  const transcript = buildTranscript(events);
  const hasPrompt = prompt.trim().length > 0 || currentRun !== null;
  const hasAssistantOutput =
    transcript.assistantText.length > 0 ||
    transcript.thinking.length > 0 ||
    transcript.tools.length > 0 ||
    transcript.stderr.length > 0 ||
    transcript.errors.length > 0 ||
    transcript.usage !== null;

  return (
    <section className="message-stream" role="log" aria-label="Messages">
      {!hasPrompt && (
        <div className="empty-state">
          <p className="eyebrow">Ready</p>
          <h2>Ask a local agent to do something.</h2>
          <p>Choose an agent, write a prompt, and stream the answer here.</p>
        </div>
      )}

      {hasPrompt && (
        <article className="message user-message">
          <div className="message-label">You</div>
          <div className="message-body">{prompt}</div>
        </article>
      )}

      {hasPrompt && (
        <article className="message assistant-message">
          <div className="message-label">Agent</div>
          <div className="message-body">
            {hasAssistantOutput ? (
              <MarkdownLite text={transcript.assistantText} />
            ) : (
              <p className="muted">Waiting for streamed output.</p>
            )}

            {transcript.thinking && (
              <details className="message-detail" open>
                <summary>Thinking</summary>
                <p>{transcript.thinking}</p>
              </details>
            )}

            {transcript.tools.map((tool) => (
              <div className={`tool-card${tool.isError ? " error" : ""}`} key={tool.id}>
                <strong>{tool.name}</strong>
                {tool.input !== undefined && <pre>{JSON.stringify(tool.input, null, 2)}</pre>}
                {tool.result && <p>{tool.result}</p>}
              </div>
            ))}

            {transcript.stderr && (
              <details className="message-detail warning" open>
                <summary>Warnings</summary>
                <p>{transcript.stderr}</p>
              </details>
            )}

            {transcript.errors.map((error, index) => (
              <div className="inline-error" key={`${error.code ?? "error"}-${index}`}>
                <strong>{error.code ?? "error"}</strong>
                <span>{error.message}</span>
              </div>
            ))}

            {transcript.usage && <p className="usage-line">{formatUsage(transcript.usage)}</p>}
          </div>
        </article>
      )}
    </section>
  );
}

export function buildTranscript(events: RunEvent[]): Transcript {
  const transcript: Transcript = {
    assistantText: "",
    thinking: "",
    tools: [],
    stderr: "",
    errors: [],
    usage: null
  };

  for (const event of events) {
    if (event.type === "text_delta") transcript.assistantText += event.delta;
    if (event.type === "thinking_delta") transcript.thinking += event.delta;
    if (event.type === "tool_use") {
      transcript.tools.push({ id: event.id, name: event.name, input: event.input });
    }
    if (event.type === "tool_result") {
      const existing = transcript.tools.find((tool) => tool.id === event.toolUseId);
      if (existing) {
        existing.result = event.content ?? "";
        existing.isError = event.isError;
      } else {
        transcript.tools.push({
          id: event.toolUseId,
          name: "tool result",
          result: event.content ?? "",
          isError: event.isError
        });
      }
    }
    if (event.type === "stderr") transcript.stderr += event.chunk;
    if (event.type === "error") transcript.errors.push({ message: event.message, code: event.code });
    if (event.type === "usage") transcript.usage = event.usage;
  }

  return transcript;
}

function formatUsage(usage: TokenUsage): string {
  if (typeof usage.total_tokens === "number") return `${usage.total_tokens} tokens`;

  const parts = Object.entries(usage)
    .filter(([, value]) => typeof value === "number")
    .map(([key, value]) => `${key}: ${value}`);

  return parts.join(", ");
}
