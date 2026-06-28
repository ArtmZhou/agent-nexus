import type { DetectedAgent, RunEvent, RunStatusBody, TokenUsage } from "@agent-nexus/shared";

export type ConsoleState = {
  prompt: string;
  reasoning: string;
  cwd: string;
  extraAllowedDirs: string;
};

type RunConsoleProps = {
  agents: DetectedAgent[];
  selectedAgentId: string | null;
  selectedModel: string;
  state: ConsoleState;
  currentRun: RunStatusBody | null;
  events: RunEvent[];
  running: boolean;
  onAgentChange: (agentId: string) => void;
  onModelChange: (model: string) => void;
  onStateChange: (state: ConsoleState) => void;
  onRun: () => void;
  onCancel: () => void;
};

export function RunConsole({
  agents,
  selectedAgentId,
  selectedModel,
  state,
  currentRun,
  events,
  running,
  onAgentChange,
  onModelChange,
  onStateChange,
  onRun,
  onCancel
}: RunConsoleProps) {
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;
  const sections = collectSections(events);

  return (
    <main className="run-console">
      <header className="console-head">
        <div>
          <p className="eyebrow">Local process bridge</p>
          <h1>Local agent console</h1>
        </div>
        <div className={`run-state ${currentRun?.status ?? "idle"}`}>{currentRun?.status ?? "idle"}</div>
      </header>

      <section className="prompt-surface" aria-label="Run controls">
        <div className="control-grid">
          <label>
            Agent
            <select value={selectedAgentId ?? ""} onChange={(event) => onAgentChange(event.target.value)}>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model
            <select value={selectedModel} onChange={(event) => onModelChange(event.target.value)}>
              {(selectedAgent?.models ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reasoning
            <input value={state.reasoning} onChange={(event) => onStateChange({ ...state, reasoning: event.target.value })} placeholder="default" />
          </label>
          <label>
            Working directory
            <input value={state.cwd} onChange={(event) => onStateChange({ ...state, cwd: event.target.value })} placeholder="optional cwd" />
          </label>
          <label className="span-two">
            Extra allowed dirs
            <textarea
              value={state.extraAllowedDirs}
              onChange={(event) => onStateChange({ ...state, extraAllowedDirs: event.target.value })}
              placeholder="One directory per line"
              rows={3}
            />
          </label>
          <label className="span-two">
            Prompt
            <textarea
              value={state.prompt}
              onChange={(event) => onStateChange({ ...state, prompt: event.target.value })}
              placeholder="Ask the selected local agent to do something..."
              rows={5}
            />
          </label>
        </div>

        <div className="run-actions">
          <button className="primary-button" type="button" onClick={onRun} disabled={running || !state.prompt.trim() || !selectedAgentId}>
            Run
          </button>
          <button className="danger-button" type="button" onClick={onCancel} disabled={!currentRun || !running}>
            Cancel
          </button>
        </div>
      </section>

      <section className="stream-grid" aria-label="Streaming output">
        <OutputPane title="Text" value={sections.text || "Waiting for assistant output."} tone="text" />
        <OutputPane title="Thinking" value={sections.thinking || "No reasoning stream yet."} tone="thinking" />
        <OutputPane title="Tools" value={sections.tools.length === 0 ? "No tool calls." : sections.tools.join("\n\n")} tone="tools" />
        <OutputPane title="Stderr" value={sections.stderr || "No stderr."} tone="stderr" />
        <OutputPane title="Errors" value={sections.errors.length === 0 ? "No errors." : sections.errors.join("\n")} tone="errors" />
        <OutputPane title="Usage" value={formatUsage(sections.usage)} tone="usage" />
      </section>
    </main>
  );
}

function OutputPane({ title, value, tone }: { title: string; value: string; tone: string }) {
  return (
    <article className={`output-pane ${tone}`}>
      <h3>{title}</h3>
      <pre>{value}</pre>
    </article>
  );
}

function collectSections(events: RunEvent[]) {
  const sections = {
    text: "",
    thinking: "",
    tools: [] as string[],
    stderr: "",
    errors: [] as string[],
    usage: null as TokenUsage | null
  };

  for (const event of events) {
    if (event.type === "text_delta") sections.text += event.delta;
    if (event.type === "thinking_delta") sections.thinking += event.delta;
    if (event.type === "tool_use") sections.tools.push(`${event.name} ${JSON.stringify(event.input ?? {}, null, 2)}`);
    if (event.type === "tool_result") sections.tools.push(`result:${event.toolUseId} ${event.content ?? ""}`);
    if (event.type === "stderr") sections.stderr += event.chunk;
    if (event.type === "error") sections.errors.push(event.message);
    if (event.type === "usage") sections.usage = event.usage;
  }

  return sections;
}

function formatUsage(usage: TokenUsage | null): string {
  if (!usage) return "No usage reported.";
  const entries = Object.entries(usage).filter(([, value]) => typeof value === "number");
  const total = typeof usage.total_tokens === "number" ? `${usage.total_tokens} tokens` : null;
  return [total, ...entries.map(([key, value]) => `${key}: ${value}`)].filter(Boolean).join("\n");
}
