# Chat Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the operations-console web UI with a focused chat workbench that renders streamed agent output as readable messages while hiding diagnostics and raw process details by default.

**Architecture:** Keep the existing backend API and `App` state ownership. Move presentation into focused React components: a top bar, message stream, composer, and details drawer. Derive a transcript model from existing `RunEvent[]` so rendering stays independent from SSE subscription and run lifecycle code.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, existing `@agent-nexus/shared` run event types, local CSS.

---

## File Structure

- Modify `web/src/App.tsx`: keep data fetching, run lifecycle, selected agent/model state, and secondary panel state; render the new workbench layout.
- Replace `web/src/components/RunConsole.tsx`: convert from pane grid to chat workbench component composed from local helper renderers.
- Create `web/src/components/MessageStream.tsx`: derive and render transcript messages from `RunEvent[]`.
- Create `web/src/components/MarkdownLite.tsx`: render plain text, fenced code blocks, and inline code without adding a dependency.
- Modify `web/src/components/AgentList.tsx`: shrink into an agent picker surface for secondary UI or remove from default layout usage.
- Modify `web/src/components/RunInspector.tsx`: convert to details drawer content that is only shown when requested.
- Modify `web/src/components/SettingsPanel.tsx`: convert advanced run options into compact form content or remove the default settings panel.
- Replace `web/src/styles.css`: implement the light chat workbench visual system and responsive layout.
- Modify `web/src/__tests__/App.test.tsx`: assert the default workbench, message rendering, secondary details access, run, stream, and cancel behavior.

---

### Task 1: Lock The New Default Screen In A Failing Test

**Files:**
- Modify: `web/src/__tests__/App.test.tsx`

- [ ] **Step 1: Rewrite the main app test around the chat workbench**

Replace the test body with this structure. Keep the existing `FakeEventSource` helper and `jsonResponse` helper.

```tsx
test("runs an agent from the chat workbench and keeps diagnostics in details", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === "/api/agents") {
      return jsonResponse({
        diagnostics: [{ code: "profile.loaded", severity: "info", message: "Local profile loaded" }],
        agents: [
          {
            id: "codex",
            name: "Codex",
            available: true,
            path: "C:/Tools/codex.exe",
            version: "1.2.3",
            models: [{ id: "gpt-5", label: "GPT-5" }],
            modelsSource: "live",
            authStatus: "ok",
            diagnostics: []
          },
          {
            id: "claude",
            name: "Claude",
            available: false,
            models: [{ id: "sonnet", label: "Sonnet" }],
            modelsSource: "fallback",
            authStatus: "missing",
            diagnostics: [{ code: "agent.not_on_path", severity: "warning", message: "Claude is not on PATH" }]
          }
        ]
      });
    }

    if (url === "/api/runs" && init?.method === "POST") {
      expect(JSON.parse(String(init.body))).toMatchObject({
        agentId: "codex",
        model: "gpt-5",
        reasoning: "high",
        cwd: "D:/work",
        extraAllowedDirs: ["D:/work/shared", "D:/work/docs"],
        prompt: "Build the streaming console"
      });

      return jsonResponse({
        id: "run-1",
        agentId: "codex",
        status: "running",
        createdAt: 100,
        updatedAt: 200,
        cancelRequested: false,
        childPid: 4242,
        processGroupId: 4242,
        exitCode: null,
        signal: null,
        error: null,
        errorCode: null,
        eventsLogPath: "D:/logs/run-1.jsonl"
      });
    }

    if (url === "/api/runs/run-1/cancel" && init?.method === "POST") {
      return jsonResponse({
        id: "run-1",
        agentId: "codex",
        status: "canceled",
        createdAt: 100,
        updatedAt: 300,
        cancelRequested: true,
        childPid: 4242,
        processGroupId: 4242,
        exitCode: null,
        signal: "SIGTERM",
        error: null,
        errorCode: null,
        eventsLogPath: "D:/logs/run-1.jsonl"
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);

  expect(await screen.findByRole("heading", { name: "Agent Nexus" })).toBeInTheDocument();
  expect(screen.getByRole("main", { name: "Chat workbench" })).toBeInTheDocument();
  expect(screen.queryByRole("complementary", { name: "Run inspector" })).not.toBeInTheDocument();
  expect(screen.queryByText("AGENT_NEXUS_AGENTS_CONFIG")).not.toBeInTheDocument();
  expect(screen.queryByText("Claude is not on PATH")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  const details = await screen.findByRole("complementary", { name: "Run details" });
  expect(within(details).getByText("Claude is not on PATH")).toBeInTheDocument();
  expect(within(details).getByText("No run selected")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close details" }));
  await waitFor(() => expect(screen.queryByRole("complementary", { name: "Run details" })).not.toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  fireEvent.change(screen.getByLabelText("Reasoning"), { target: { value: "high" } });
  fireEvent.change(screen.getByLabelText("Working directory"), { target: { value: "D:/work" } });
  fireEvent.change(screen.getByLabelText("Extra allowed dirs"), { target: { value: "D:/work/shared\nD:/work/docs" } });

  fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Build the streaming console" } });
  fireEvent.click(screen.getByRole("button", { name: "Run" }));

  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  FakeEventSource.instances[0]?.emit("text_delta", { type: "text_delta", delta: "Here is code:\n```ts\nconst ok = true;\n```" });
  FakeEventSource.instances[0]?.emit("thinking_delta", { type: "thinking_delta", delta: "Checking tools." });
  FakeEventSource.instances[0]?.emit("tool_use", { type: "tool_use", id: "tool-1", name: "shell", input: { command: "pwd" } });
  FakeEventSource.instances[0]?.emit("tool_result", { type: "tool_result", toolUseId: "tool-1", content: "D:/work" });
  FakeEventSource.instances[0]?.emit("stderr", { type: "stderr", chunk: "warning line" });
  FakeEventSource.instances[0]?.emit("usage", { type: "usage", usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } });

  const stream = screen.getByRole("log", { name: "Messages" });
  expect(await within(stream).findByText("Here is code:")).toBeInTheDocument();
  expect(within(stream).getByText("const ok = true;")).toBeInTheDocument();
  expect(within(stream).getByText("Checking tools.")).toBeInTheDocument();
  expect(within(stream).getByText("shell")).toBeInTheDocument();
  expect(within(stream).getByText("D:/work")).toBeInTheDocument();
  expect(within(stream).getByText("warning line")).toBeInTheDocument();
  expect(within(stream).getByText("14 tokens")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.getByText("canceled")).toBeInTheDocument());

  FakeEventSource.instances[0]?.emit("end", { type: "end", status: "canceled" });
  expect(FakeEventSource.instances[0]?.close).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test and verify it fails on the old UI**

Run:

```bash
pnpm --filter @agent-nexus/web test -- src/__tests__/App.test.tsx
```

Expected: FAIL because the old UI still renders `Local agent console`, persistent settings, persistent inspector panes, and no `Chat workbench` main region.

- [ ] **Step 3: Commit the failing test if using strict TDD checkpoints**

```bash
git add web/src/__tests__/App.test.tsx
git commit -m "test: specify chat workbench UI"
```

---

### Task 2: Add Transcript And Lightweight Text Rendering

**Files:**
- Create: `web/src/components/MarkdownLite.tsx`
- Create: `web/src/components/MessageStream.tsx`
- Modify: `web/src/__tests__/App.test.tsx`

- [ ] **Step 1: Create the local text renderer**

Create `web/src/components/MarkdownLite.tsx`:

```tsx
type MarkdownLiteProps = {
  text: string;
};

type Segment =
  | { type: "code"; language: string; value: string }
  | { type: "paragraph"; value: string };

export function MarkdownLite({ text }: MarkdownLiteProps) {
  const segments = splitSegments(text);

  return (
    <div className="markdown-lite">
      {segments.map((segment, index) => {
        if (segment.type === "code") {
          return (
            <pre className="code-block" key={`${segment.type}-${index}`}>
              {segment.language && <span className="code-language">{segment.language}</span>}
              <code>{segment.value}</code>
            </pre>
          );
        }

        return (
          <p key={`${segment.type}-${index}`}>
            {renderInlineCode(segment.value)}
          </p>
        );
      })}
    </div>
  );
}

function splitSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const fencePattern = /```([A-Za-z0-9_-]*)\r?\n([\s\S]*?)```/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(text)) !== null) {
    const before = text.slice(cursor, match.index).trim();
    if (before) segments.push(...paragraphs(before));
    segments.push({
      type: "code",
      language: match[1] ?? "",
      value: (match[2] ?? "").replace(/\s+$/u, "")
    });
    cursor = match.index + match[0].length;
  }

  const after = text.slice(cursor).trim();
  if (after) segments.push(...paragraphs(after));
  return segments.length > 0 ? segments : [{ type: "paragraph", value: "" }];
}

function paragraphs(text: string): Segment[] {
  return text
    .split(/\n{2,}/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => ({ type: "paragraph", value }));
}

function renderInlineCode(text: string): React.ReactNode[] {
  return text.split(/(`[^`]+`)/u).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return <span key={index}>{part}</span>;
  });
}
```

- [ ] **Step 2: Create the message stream**

Create `web/src/components/MessageStream.tsx`:

```tsx
import type { RunEvent, RunStatusBody, TokenUsage } from "@agent-nexus/shared";
import { MarkdownLite } from "./MarkdownLite.js";

type MessageStreamProps = {
  currentRun: RunStatusBody | null;
  events: RunEvent[];
  prompt: string;
};

type Transcript = {
  assistantText: string;
  thinking: string;
  tools: Array<{ id: string; name: string; input?: unknown; result?: string }>;
  stderr: string;
  errors: Array<{ message: string; code?: string }>;
  usage: TokenUsage | null;
};

export function MessageStream({ currentRun, events, prompt }: MessageStreamProps) {
  const transcript = buildTranscript(events);
  const hasPrompt = prompt.trim().length > 0 || currentRun;
  const hasAssistantOutput = transcript.assistantText || transcript.thinking || transcript.tools.length > 0 || transcript.stderr || transcript.errors.length > 0;

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
            {hasAssistantOutput ? <MarkdownLite text={transcript.assistantText} /> : <p className="muted">Waiting for streamed output.</p>}

            {transcript.thinking && (
              <details className="message-detail" open>
                <summary>Thinking</summary>
                <p>{transcript.thinking}</p>
              </details>
            )}

            {transcript.tools.map((tool) => (
              <div className="tool-card" key={tool.id}>
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
      if (existing) existing.result = event.content ?? "";
      else transcript.tools.push({ id: event.toolUseId, name: "tool result", result: event.content ?? "" });
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
  return parts.join(" · ");
}
```

- [ ] **Step 3: Run the focused web test**

Run:

```bash
pnpm --filter @agent-nexus/web test -- src/__tests__/App.test.tsx
```

Expected: still FAIL because `App.tsx` does not render `MessageStream` yet.

- [ ] **Step 4: Commit the rendering primitives**

```bash
git add web/src/components/MarkdownLite.tsx web/src/components/MessageStream.tsx
git commit -m "feat: add chat transcript rendering"
```

---

### Task 3: Replace The Main App Layout With Chat Workbench

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/RunConsole.tsx`
- Modify: `web/src/components/RunInspector.tsx`

- [ ] **Step 1: Update App state for secondary panels**

In `web/src/App.tsx`, add state near the existing `error` state:

```tsx
const [detailsOpen, setDetailsOpen] = useState(false);
const [advancedOpen, setAdvancedOpen] = useState(false);
const submittedPrompt = currentRun ? consoleState.prompt : "";
```

Replace the current JSX return with:

```tsx
return (
  <div className="app-shell">
    {error && (
      <div className="app-error" role="alert">
        {error}
      </div>
    )}

    <RunConsole
      agents={agents}
      diagnostics={diagnostics}
      selectedAgentId={selectedAgentId}
      selectedModel={selectedModel}
      state={consoleState}
      currentRun={currentRun}
      events={events}
      rawEvents={rawEvents}
      running={running}
      loadingAgents={loadingAgents}
      detailsOpen={detailsOpen}
      advancedOpen={advancedOpen}
      submittedPrompt={submittedPrompt}
      onAgentChange={selectAgent}
      onModelChange={setSelectedModel}
      onStateChange={setConsoleState}
      onRun={startRun}
      onCancel={stopRun}
      onRefresh={refreshAgents}
      onDetailsOpenChange={setDetailsOpen}
      onAdvancedOpenChange={setAdvancedOpen}
    />
  </div>
);
```

Remove the persistent `<AgentList />`, `<SettingsPanel />`, and `<RunInspector />` usage from `App.tsx`.

- [ ] **Step 2: Rewrite RunConsole as the workbench shell**

Replace `web/src/components/RunConsole.tsx` with a component that imports `AgentDiagnostic`, `StoredRunEvent`, `MessageStream`, and `RunInspector`. Preserve the exported `ConsoleState` type.

```tsx
import type { AgentDiagnostic, DetectedAgent, RunEvent, RunStatusBody, StoredRunEvent } from "@agent-nexus/shared";
import { MessageStream } from "./MessageStream.js";
import { RunInspector } from "./RunInspector.js";

export type ConsoleState = {
  prompt: string;
  reasoning: string;
  cwd: string;
  extraAllowedDirs: string;
};

type RunConsoleProps = {
  agents: DetectedAgent[];
  diagnostics: AgentDiagnostic[];
  selectedAgentId: string | null;
  selectedModel: string;
  state: ConsoleState;
  currentRun: RunStatusBody | null;
  events: RunEvent[];
  rawEvents: StoredRunEvent[];
  running: boolean;
  loadingAgents: boolean;
  detailsOpen: boolean;
  advancedOpen: boolean;
  submittedPrompt: string;
  onAgentChange: (agentId: string) => void;
  onModelChange: (model: string) => void;
  onStateChange: (state: ConsoleState) => void;
  onRun: () => void;
  onCancel: () => void;
  onRefresh: () => void;
  onDetailsOpenChange: (open: boolean) => void;
  onAdvancedOpenChange: (open: boolean) => void;
};

export function RunConsole(props: RunConsoleProps) {
  const selectedAgent = props.agents.find((agent) => agent.id === props.selectedAgentId) ?? props.agents[0] ?? null;

  return (
    <main className="chat-workbench" aria-label="Chat workbench">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Local agent</p>
          <h1>Agent Nexus</h1>
        </div>

        <div className="top-controls">
          <label>
            Agent
            <select value={props.selectedAgentId ?? ""} onChange={(event) => props.onAgentChange(event.target.value)}>
              {props.agents.map((agent) => (
                <option key={agent.id} value={agent.id} disabled={!agent.available}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model
            <select value={props.selectedModel} onChange={(event) => props.onModelChange(event.target.value)}>
              {(selectedAgent?.models ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <span className={`run-state ${props.currentRun?.status ?? "idle"}`}>{props.currentRun?.status ?? "idle"}</span>
          <button type="button" className="ghost-button" onClick={props.onRefresh} disabled={props.loadingAgents}>
            {props.loadingAgents ? "Scanning" : "Refresh"}
          </button>
          <button type="button" className="ghost-button" onClick={() => props.onAdvancedOpenChange(!props.advancedOpen)}>
            Advanced
          </button>
          <button type="button" className="ghost-button" onClick={() => props.onDetailsOpenChange(true)}>
            Details
          </button>
        </div>
      </header>

      {props.advancedOpen && (
        <section className="advanced-panel" aria-label="Advanced run options">
          <label>
            Reasoning
            <input value={props.state.reasoning} onChange={(event) => props.onStateChange({ ...props.state, reasoning: event.target.value })} aria-label="Reasoning" />
          </label>
          <label>
            Working directory
            <input value={props.state.cwd} onChange={(event) => props.onStateChange({ ...props.state, cwd: event.target.value })} aria-label="Working directory" />
          </label>
          <label>
            Extra allowed dirs
            <textarea
              value={props.state.extraAllowedDirs}
              onChange={(event) => props.onStateChange({ ...props.state, extraAllowedDirs: event.target.value })}
              aria-label="Extra allowed dirs"
              rows={3}
            />
          </label>
        </section>
      )}

      <MessageStream currentRun={props.currentRun} events={props.events} prompt={props.submittedPrompt} />

      <section className="composer" aria-label="Prompt composer">
        <label>
          Prompt
          <textarea
            value={props.state.prompt}
            onChange={(event) => props.onStateChange({ ...props.state, prompt: event.target.value })}
            aria-label="Prompt"
            rows={4}
          />
        </label>
        <div className="run-actions">
          <button className="primary-button" type="button" onClick={props.onRun} disabled={props.running || !props.state.prompt.trim() || !props.selectedAgentId}>
            Run
          </button>
          <button className="danger-button" type="button" onClick={props.onCancel} disabled={!props.currentRun || !props.running}>
            Cancel
          </button>
        </div>
      </section>

      {props.detailsOpen && (
        <RunInspector
          run={props.currentRun}
          rawEvents={props.rawEvents}
          agents={props.agents}
          diagnostics={props.diagnostics}
          onClose={() => props.onDetailsOpenChange(false)}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 3: Convert RunInspector into a drawer**

Update `web/src/components/RunInspector.tsx` props and root markup:

```tsx
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
```

Keep the existing `Row` helper below the component.

- [ ] **Step 4: Run the focused web test**

Run:

```bash
pnpm --filter @agent-nexus/web test -- src/__tests__/App.test.tsx
```

Expected: FAIL only on styling-independent query mismatches or PASS if all required labels and roles are present.

- [ ] **Step 5: Commit the new layout**

```bash
git add web/src/App.tsx web/src/components/RunConsole.tsx web/src/components/RunInspector.tsx
git commit -m "feat: replace dashboard with chat workbench"
```

---

### Task 4: Replace Styling With The Light Workbench Visual System

**Files:**
- Modify: `web/src/styles.css`
- Modify: `web/src/__tests__/App.test.tsx`

- [ ] **Step 1: Replace global layout and palette CSS**

Replace the dark three-column dashboard base with:

```css
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f6f5ef;
  color: #1f2328;
  --bg: #f6f5ef;
  --surface: #ffffff;
  --surface-soft: #fbfaf6;
  --line: #d8d7cf;
  --line-strong: #b8b7ad;
  --muted: #69707a;
  --text: #1f2328;
  --blue: #2563eb;
  --blue-soft: #e8efff;
  --green: #15803d;
  --amber: #a16207;
  --red: #b42318;
  --shadow: 0 18px 45px rgba(31, 35, 40, 0.12);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 0;
  background: var(--bg);
}

button,
input,
select,
textarea {
  font: inherit;
}
```

- [ ] **Step 2: Add workbench layout CSS**

Add:

```css
.app-shell {
  min-height: 100vh;
  padding: 18px;
}

.chat-workbench {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 14px;
  max-width: 1180px;
  min-height: calc(100vh - 36px);
  margin: 0 auto;
}

.top-bar,
.composer,
.advanced-panel,
.message {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
}

.top-controls {
  display: flex;
  align-items: end;
  gap: 10px;
  flex-wrap: wrap;
}

.message-stream {
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 360px;
  overflow: auto;
}

.message {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 12px;
  padding: 14px;
}

.assistant-message {
  border-left: 3px solid var(--blue);
}

.message-label {
  color: var(--muted);
  font-weight: 700;
}

.message-body {
  min-width: 0;
  line-height: 1.55;
}

.composer {
  display: grid;
  gap: 10px;
  padding: 12px;
}

.run-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
```

- [ ] **Step 3: Add drawer, buttons, markdown, and responsive CSS**

Add:

```css
.details-drawer {
  position: fixed;
  inset: 0 0 0 auto;
  width: min(440px, 100vw);
  overflow: auto;
  padding: 18px;
  background: var(--surface);
  border-left: 1px solid var(--line);
  box-shadow: var(--shadow);
  z-index: 20;
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.drawer-section {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.primary-button,
.danger-button,
.ghost-button {
  min-height: 34px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  padding: 0 12px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

.primary-button {
  border-color: var(--blue);
  background: var(--blue);
  color: white;
  font-weight: 800;
}

.danger-button {
  border-color: rgba(180, 35, 24, 0.36);
  color: var(--red);
  background: #fff4f2;
}

.run-state {
  min-width: 86px;
  padding: 8px 10px;
  border-radius: 7px;
  background: var(--surface-soft);
  border: 1px solid var(--line);
  text-align: center;
  color: var(--muted);
}

.run-state.running,
.run-state.queued {
  color: var(--green);
}

.run-state.failed,
.run-state.canceled {
  color: var(--red);
}

input,
select,
textarea {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 9px 10px;
  color: var(--text);
  background: var(--surface);
  outline: none;
}

textarea {
  resize: vertical;
}

input:focus,
select:focus,
textarea:focus,
button:focus-visible {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.16);
}

.code-block,
.tool-card pre,
.drawer-section pre {
  overflow: auto;
  padding: 12px;
  border-radius: 7px;
  background: #111827;
  color: #f8fafc;
  white-space: pre-wrap;
}

.tool-card,
.message-detail,
.inline-error {
  margin-top: 10px;
  padding: 10px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: var(--surface-soft);
}

.inline-error {
  display: grid;
  gap: 4px;
  color: var(--red);
  background: #fff4f2;
}

.usage-line,
.muted {
  color: var(--muted);
}

@media (max-width: 820px) {
  .app-shell {
    padding: 10px;
  }

  .top-bar,
  .message {
    grid-template-columns: 1fr;
  }

  .top-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .top-controls {
    align-items: stretch;
  }
}
```

- [ ] **Step 4: Run web test and inspect rendered app in browser**

Run:

```bash
pnpm --filter @agent-nexus/web test -- src/__tests__/App.test.tsx
pnpm --filter @agent-nexus/web build
```

Expected: both PASS.

Start the dev server if it is not already running:

```bash
pnpm --filter @agent-nexus/web dev
```

Open the app in the browser and verify the first viewport shows the chat workbench, not the old dashboard.

- [ ] **Step 5: Commit visual redesign**

```bash
git add web/src/styles.css web/src/__tests__/App.test.tsx
git commit -m "style: polish chat workbench UI"
```

---

### Task 5: Full Verification And Cleanup

**Files:**
- Review: `web/src/App.tsx`
- Review: `web/src/components/RunConsole.tsx`
- Review: `web/src/components/MessageStream.tsx`
- Review: `web/src/components/MarkdownLite.tsx`
- Review: `web/src/components/RunInspector.tsx`
- Review: `web/src/styles.css`
- Review: `web/src/__tests__/App.test.tsx`

- [ ] **Step 1: Run full checks**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 2: Check git diff for unrelated changes**

Run:

```bash
git status --short
git diff --check
```

Expected: only chat workbench implementation files are modified or staged. Existing untracked `AGENTS.md` and `docs/agents/` remain untouched.

- [ ] **Step 3: Final implementation commit**

If Task 4 did not already commit every changed implementation file, commit the remaining work:

```bash
git add web/src/App.tsx web/src/components web/src/styles.css web/src/__tests__/App.test.tsx
git commit -m "feat: render local agent runs as chat workbench"
```

- [ ] **Step 4: Report verification**

Final response should include:

```text
Implemented the Chat Workbench redesign.
Verified: pnpm test, pnpm typecheck, pnpm build.
Notes: diagnostics/raw events moved behind Details; advanced cwd/reasoning/allowed dirs moved behind Advanced; agent output now renders as assistant messages with code blocks, thinking, tools, warnings, errors, and usage.
```

---

## Self-Review

- Spec coverage: the tasks cover the default workbench, message rendering, secondary surfaces, visual direction, component boundaries, and tests.
- Deferred-work scan: the plan contains no vague implementation gaps.
- Type consistency: `ConsoleState`, `RunEvent`, `RunStatusBody`, `StoredRunEvent`, `DetectedAgent`, and `AgentDiagnostic` match existing shared and component usage.
