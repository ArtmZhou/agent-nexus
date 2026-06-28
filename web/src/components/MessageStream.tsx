import type { RunEvent, RunStatus, RunStatusBody, TokenUsage } from "@agent-nexus/shared";
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

type TranscriptStatus = {
  label: string;
  detail?: string;
};

type Transcript = {
  assistantText: string;
  thinking: string;
  tools: TranscriptTool[];
  stderr: string;
  errors: Array<{ message: string; code?: string }>;
  statuses: TranscriptStatus[];
  diagnostics: Array<{ name: string; message: string }>;
  usage: TokenUsage | null;
};

const terminalStatuses = new Set<RunStatus>(["succeeded", "failed", "canceled"]);

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
  const isTerminal = currentRun !== null && terminalStatuses.has(currentRun.status);
  const runError = currentRun?.error?.trim() ? currentRun.error : null;
  const runErrorCode = currentRun?.errorCode ?? undefined;
  const showRunError = isTerminal && runError !== null && !transcript.errors.some((error) => error.message === runError);
  const placeholderText = placeholderFor(currentRun, transcript);

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
            {transcript.assistantText.length > 0 ? (
              <MarkdownLite text={transcript.assistantText} />
            ) : (
              !hasAssistantOutput && <p className="muted">{placeholderText}</p>
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

            {showRunError && (
              <div className="inline-error" key="run-error">
                <strong>{runErrorCode ?? currentRun?.status ?? "error"}</strong>
                <span>{runError}</span>
              </div>
            )}

            {transcript.diagnostics.length > 0 && (
              <details className="message-detail" open>
                <summary>Diagnostics</summary>
                {transcript.diagnostics.map((diagnostic, index) => (
                  <p key={`${diagnostic.name}-${index}`}>
                    <strong>{diagnostic.name}</strong>
                    {diagnostic.message && ` — ${diagnostic.message}`}
                  </p>
                ))}
              </details>
            )}

            {transcript.usage && <p className="usage-line">{formatUsage(transcript.usage)}</p>}
          </div>
        </article>
      )}
    </section>
  );
}

function placeholderFor(currentRun: RunStatusBody | null, transcript: Transcript): string {
  if (currentRun && terminalStatuses.has(currentRun.status)) {
    if (currentRun.status === "canceled") return "Run canceled.";
    if (currentRun.status === "failed") return currentRun.error?.trim() ? currentRun.error : "Run failed.";
    return "Run finished without text output.";
  }

  const latestStatus = transcript.statuses.at(-1);
  if (latestStatus) {
    return latestStatus.detail ? `${latestStatus.label}: ${latestStatus.detail}` : `Status: ${latestStatus.label}`;
  }

  return "Waiting for streamed output.";
}

export function buildTranscript(events: RunEvent[]): Transcript {
  const transcript: Transcript = {
    assistantText: "",
    thinking: "",
    tools: [],
    stderr: "",
    errors: [],
    statuses: [],
    diagnostics: [],
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
    if (event.type === "status") {
      transcript.statuses.push({ label: event.label, detail: event.detail });
    }
    if (event.type === "diagnostic") {
      const name = event.name ?? "diagnostic";
      const message = typeof event.message === "string" ? event.message : "";
      transcript.diagnostics.push({ name, message });
    }
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
