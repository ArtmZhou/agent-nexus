# Local Web Agent Client Design

Date: 2026-06-28

## Goal

Build Agent Nexus as a local Web client that can connect to and run different
agent CLIs installed on the user's machine. The implementation should replicate
the agent-integration capabilities from `nexu-io/open-design`, especially the
runtime registry, local agent detection, model/auth probing, process launch,
stream parsing, run lifecycle, streaming, cancellation, diagnostics, and local
profile extension model.

The first product surface is a local Web app. A desktop shell must be able to
wrap the same daemon and UI in a later phase without replacing the runtime
architecture.

## Reference Behavior

The design is based on these Open Design areas:

- `apps/daemon/src/runtimes/registry.ts`
- `apps/daemon/src/runtimes/defs/*.ts`
- `apps/daemon/src/runtimes/detection.ts`
- `apps/daemon/src/runtimes/executables.ts`
- `apps/daemon/src/runtimes/launch.ts`
- `apps/daemon/src/runtimes/invocation.ts`
- `apps/daemon/src/runtimes/json-event-stream.ts`
- `apps/daemon/src/runtimes/runs.ts`
- `apps/daemon/src/runtimes/chat-run-lifecycle.ts`
- `apps/daemon/src/acp.ts`
- `apps/daemon/src/runtimes/local-profiles.ts`

Agent Nexus should not clone Open Design wholesale. It should recreate the same
runtime concepts in a focused codebase whose first purpose is local agent
interoperability.

## Architecture

Use a TypeScript monorepo:

```text
server/
  src/
    api/
    runtimes/
    runs/
    config/
web/
  src/
shared/
  src/
```

The browser UI talks only to the local daemon.

```text
Browser UI
  -> GET /api/agents
  -> daemon detects installed agents
  -> user selects agent, model, cwd, prompt
  -> POST /api/runs
  -> daemon spawns the local agent CLI
  -> GET /api/runs/:id/events
  -> daemon streams normalized run events over SSE
```

The server owns all local-machine access: PATH walking, binary overrides,
process spawning, stdin, stdout/stderr parsing, cancellation, and event logs.
The Web app is a control surface and inspector.

## Runtime Adapter Model

Each agent is defined by a declarative adapter, following Open Design's
`RuntimeAgentDef` pattern.

```ts
type RuntimeAgentDef = {
  id: string;
  name: string;
  bin: string;
  fallbackBins?: string[];
  versionArgs: string[];
  fallbackModels: RuntimeModelOption[];
  listModels?: RuntimeListModels;
  fetchModels?: RuntimeFetchModels;
  authProbe?: RuntimeAuthProbe;
  reasoningOptions?: RuntimeModelOption[];
  buildArgs(context: RuntimeBuildContext): string[];
  promptViaStdin?: boolean;
  promptInputFormat?: "text" | "stream-json";
  streamFormat:
    | "plain"
    | "json-lines"
    | "claude-stream-json"
    | "json-event-stream"
    | "acp-json-rpc";
  eventParser?: string;
  supportsImagePaths?: boolean;
  resumesSessionViaCli?: boolean;
  capturesSessionIdFromStream?: boolean;
  resumesSessionViaAcpLoad?: boolean;
  externalMcpInjection?:
    | "claude-mcp-json"
    | "acp-merge"
    | "opencode-env-content";
  inactivityTimeoutMs?: number;
};
```

The adapter boundary is strict:

- Adapter definitions know how one CLI is probed, invoked, and parsed.
- Run services know process lifecycle, event history, SSE, logs, and cancel.
- API handlers translate HTTP requests into runtime/run service calls.
- UI components render agent and run state without agent-specific branching.

Initial built-in adapters:

- Codex CLI
- Claude Code
- OpenCode
- Gemini CLI
- Cursor Agent

These cover the main adapter classes needed before adding more agents: JSON
event streams, Claude stream-json, fallback bins, model list parsing, auth
probes, stdin prompt delivery, and session-resume markers.

## Local Detection And Configuration

Detection follows Open Design's layered resolution model:

1. Explicit configured binary path, such as `CODEX_BIN` or `CLAUDE_BIN`.
2. Current process PATH.
3. Common user toolchain directories.
4. Adapter `fallbackBins`.

The daemon should include common user install locations that GUI-launched
processes often miss:

- npm global bin
- pnpm and bun bins
- Homebrew paths on macOS/Linux
- `~/.local/bin`
- common Windows Node/npm locations

Return a normalized detection response:

```ts
type DetectedAgent = {
  id: string;
  name: string;
  available: boolean;
  path?: string;
  version?: string | null;
  models: RuntimeModelOption[];
  modelsSource: "live" | "fallback";
  authStatus?: "ok" | "missing" | "unknown";
  authMessage?: string;
  diagnostics?: AgentDiagnostic[];
};
```

Fault isolation is required: one broken adapter must not prevent other agents
from being returned.

Diagnostics should explain:

- which binary names were tried
- which directories were searched
- which `*_BIN` environment variable can override the path
- whether spawn failed because the target was missing, non-executable, or timed
  out
- whether model probing fell back to static models
- whether auth is missing or unknown

User-local configuration lives under:

```text
~/.agent-nexus/
  agents.local.json
  settings.json
```

`agents.local.json` extends built-in adapters:

```json
{
  "agents": [
    {
      "id": "my-codex",
      "name": "My Codex Wrapper",
      "baseAgent": "codex",
      "bin": "C:/tools/codex-wrapper.exe",
      "args": ["--profile", "work"],
      "defaultModel": "gpt-5.1"
    }
  ]
}
```

Local profiles must be validated before use:

- `id` must be unique and filesystem-safe.
- `baseAgent` must refer to a known built-in adapter.
- env keys must be valid process environment names.
- model ids must be non-empty strings without control characters.
- local profile failures should be skipped with diagnostics, not daemon crashes.

## Run, Streaming, And Cancellation

Run/stream/cancel behavior is a core replication target, not a temporary
subset.

Every agent invocation creates a `Run`:

```ts
type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

type Run = {
  id: string;
  agentId: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  events: StoredRunEvent[];
  nextEventId: number;
  child?: ChildProcess | null;
  childPid?: number | null;
  processGroupId?: number | null;
  exitCode?: number | null;
  signal?: string | null;
  error?: string | null;
  errorCode?: string | null;
  cancelRequested: boolean;
  stdinOpen: boolean;
  acpSession?: AbortableAgentSession | null;
  eventsLogPath?: string | null;
};
```

Required endpoints:

```text
POST /api/runs
GET  /api/runs/:id
GET  /api/runs/:id/events
POST /api/runs/:id/cancel
GET  /api/runs?status=active
POST /api/runs/shutdown-active
```

Run events must be normalized:

```ts
type RunEvent =
  | { type: "status"; label: string; detail?: string; sessionId?: string }
  | { type: "text_delta"; delta: string }
  | { type: "thinking_start" }
  | { type: "thinking_delta"; delta: string }
  | { type: "tool_use"; id: string; name: string; input?: unknown }
  | { type: "tool_result"; toolUseId: string; content?: string; isError?: boolean }
  | { type: "usage"; usage: TokenUsage; costUsd?: number; durationMs?: number }
  | { type: "diagnostic"; name?: string; [key: string]: unknown }
  | { type: "stderr"; chunk: string }
  | { type: "error"; message: string; code?: string; details?: unknown }
  | { type: "end"; status: Exclude<RunStatus, "queued" | "running"> };
```

The run service must provide:

- in-memory event history capped by a configurable limit
- per-run JSONL persistence at `data/runs/<runId>/events.jsonl`
- SSE fan-out to connected clients
- SSE reattach with `Last-Event-ID` or `after`
- terminal event replay to clients that reconnect after completion
- waiters for code paths that need to await terminal status
- delayed cleanup for terminal runs

## Process Launch

The server resolves the agent executable and launch path before spawning. It
must never blindly call `spawn(def.bin)` after detection failed.

Spawn behavior:

- Use `child_process.spawn` with `shell: false`.
- Use `stdio: ["pipe", "pipe", "pipe"]` when prompt stdin or ACP is needed.
- Use `stdio: ["ignore", "pipe", "pipe"]` otherwise.
- Use the user-selected `cwd`.
- On non-Windows platforms, spawn detached so the process group can be killed.
- Patch child PATH with:
  - the current Node binary directory
  - the selected agent binary directory
  - user toolchain directories
- Use adapter env plus user config env plus launch env.

Prompt delivery:

- Prefer stdin by default for supported adapters.
- This avoids Windows command-line length limits.
- For text stdin, write prompt and close stdin.
- For Claude stream-json, write a JSONL user message and keep stdin open until
  clean turn completion or cancellation.
- Swallow fast-exit stdin `EPIPE` and Windows `EOF` as process-close handling
  will surface the actual error.

## Stream Parsers

Implement parser modules that translate agent-specific streams into `RunEvent`.

Required first parser set:

- Codex JSON event stream
  - thread/session start
  - turn status
  - command/tool use
  - tool result
  - assistant text
  - usage
  - structured errors

- OpenCode JSON event stream
  - session id capture
  - text deltas
  - tool use/result
  - usage/cost
  - structured errors that may exit 0

- Claude stream-json
  - assistant text
  - thinking
  - tool use/result
  - usage
  - clean terminal turn bookkeeping

- Gemini-style JSON event stream
  - init/status
  - assistant text
  - tool use/result
  - warning/error/result

- ACP JSON-RPC
  - initialize
  - session/new
  - session/load for resume-capable adapters
  - optional model selection
  - session/prompt
  - session/update text/thinking/tool updates
  - session/request_permission auto-response using safe options
  - usage extraction
  - clean completion detection
  - abort support

Plain stdout/stderr fallback is allowed only for adapters whose stream format is
declared as plain.

## Cancellation And Shutdown

Cancellation should mirror Open Design:

1. Mark `cancelRequested`.
2. Clear retry or restart timers.
3. Close stdin if open.
4. If an ACP/PI-like session exposes `abort()`, call it first.
5. Wait the configured grace window.
6. Send `SIGTERM`.
7. Wait again.
8. Send `SIGKILL` if the process still runs.
9. Finish as `canceled`.

On non-Windows platforms, kill the process group when available. On Windows, use
the child process kill fallback.

`shutdownActive` must apply cancellation to all non-terminal runs when the
daemon exits or the user requests shutdown.

## Lifecycle Classification

The close handler should classify terminal status using Open Design semantics:

- `cancelRequested` always wins and becomes `canceled`.
- exit code `0` becomes `succeeded`.
- ACP clean completion followed by SIGTERM can become `succeeded`.
- artifact quiet shutdown can become `succeeded`.
- a non-zero exit after producing an artifact can become `succeeded`.
- a clean Claude stream-json terminal turn can become `succeeded`.
- otherwise the run becomes `failed`.

The daemon should track:

- first token time
- last agent activity
- stderr tail
- stdout tail
- whether substantive output occurred
- whether a tool call or artifact write occurred
- whether a clean terminal turn occurred

## Watchdogs

Implement Open Design-style timeout controls:

- `AGENT_NEXUS_CHAT_RUN_INACTIVITY_TIMEOUT_MS`
  - default: 10 minutes
  - `0` disables
  - resets on stdout, stderr, or normalized agent events

- `AGENT_NEXUS_CHAT_RUN_ARTIFACT_QUIET_PERIOD_MS`
  - default: 60 seconds
  - used after artifact/file output is observed

- `AGENT_NEXUS_CHAT_RUN_SHUTDOWN_GRACE_MS`
  - default: 3000 ms

- `AGENT_NEXUS_ACP_STAGE_TIMEOUT_MS`
  - stage-level ACP watchdog
  - non-positive disables

## Session Resume

Session resume is in scope for parity with Open Design.

The implementation should preserve the runtime fields needed by:

- specify-style resume, where the daemon mints the session id and passes it to
  the CLI, such as Claude `--session-id` and `--resume`
- capture-style resume, where the CLI reports a session id on the stream, such
  as Codex and OpenCode
- ACP load-style resume, where a durable session id is loaded through
  `session/load`

Resume state should be keyed by conversation id, agent id, model, and cwd. If a
resume attempt fails because the upstream session is stale, clear the stored
session and reseed once with a fresh session.

## UI Design

The Web UI should be a dense local control console.

Left rail:

- agent list
- available/unavailable status
- binary path
- version
- auth status
- model source
- diagnostics summary
- refresh agents button

Center:

- prompt editor
- agent/model/reasoning selectors
- cwd input
- extra allowed dirs input
- send/cancel controls
- streaming assistant output
- thinking/tool/stderr/error/usage sections

Right inspector:

- active runs
- selected run id/status
- pid/process group
- exit code/signal
- raw event log
- diagnostics
- path to persisted JSONL log

Settings:

- show searched PATH directories
- show environment override names
- show local profile config location
- show example `agents.local.json`
- future phase: edit local profiles in the UI

## Testing Strategy

Use test-driven implementation for runtime behavior.

Required test groups:

- executables
  - PATH resolution
  - Windows executable extensions
  - `*_BIN` overrides
  - fallback bins
  - searched directory diagnostics

- registry/local profiles
  - duplicate id rejection
  - invalid profile skipping
  - base adapter inheritance
  - prefix args and default model injection

- detection
  - single adapter failure does not collapse detection
  - version probe classification
  - model list live/fallback behavior
  - auth probe classification
  - concurrent streaming detection results

- adapter args
  - Codex
  - Claude
  - OpenCode
  - Gemini
  - Cursor Agent

- stream parsers
  - Codex
  - OpenCode
  - Claude stream-json
  - Gemini JSON events
  - ACP JSON-RPC
  - malformed JSON fallback/error behavior

- run service
  - create/get/list
  - SSE fan-out
  - historical replay
  - Last-Event-ID reattach
  - JSONL event persistence
  - terminal cleanup
  - waiters

- cancellation/shutdown
  - stdin close
  - ACP abort first
  - SIGTERM then SIGKILL
  - process group kill on non-Windows
  - Windows child kill fallback
  - shutdownActive cancels all active runs

- lifecycle
  - inactivity watchdog
  - artifact quiet period
  - ACP clean SIGTERM success
  - Claude clean turn closes stdin and succeeds
  - non-zero after artifact can succeed
  - no-output failure classification

- UI
  - agent list render
  - diagnostics display
  - run creation
  - SSE event rendering
  - cancel button
  - run inspector

## Out Of Scope For The First Implementation Pass

The following are deferred unless needed for runtime parity:

- Electron/Tauri packaging
- auto-update
- plugin marketplace
- cloud login
- billing
- full project/artifact management
- media generation workflows
- browser automation UI

The daemon should still be designed so a desktop shell can wrap it in a later
phase.

## Acceptance Criteria

The goal is achieved when:

1. The repo contains a runnable local Web client and daemon.
2. The daemon detects supported local agents with clear diagnostics.
3. At least Codex, Claude, OpenCode, Gemini, and Cursor Agent have adapters.
4. Live/fallback model discovery works per adapter.
5. The UI can create runs against available local agents.
6. Runs stream normalized status/text/thinking/tool/usage/error/end events.
7. SSE reattach and event history work.
8. Per-run JSONL event logs are written.
9. Cancel and shutdownActive reliably terminate active runs.
10. Open Design-style lifecycle classification and watchdogs are covered by tests.
11. Local custom agent profiles can extend built-in adapters.
12. The implementation has focused tests for the runtime, parsers, detection,
    cancellation, and UI surfaces above.
