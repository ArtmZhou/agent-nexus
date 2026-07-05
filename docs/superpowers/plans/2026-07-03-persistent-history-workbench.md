# Persistent History Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent, history-aware Agent Nexus workbench with restored run summaries, historical event replay, a rich agent picker, and the Instrument Atelier three-region UI.

**Architecture:** Implement this as five issue-bound vertical slices: backend run summary persistence (#1), historical event replay (#2), rich agent identity selection (#3), frontend history shell (#4), and final workbench polish/reuse behavior (#5). Persist a lightweight `runs/index.json` beside existing JSONL event logs, expose a shared `RunSummary` for history lists, and keep transcript reconstruction based on normalized `StoredRunEvent` data.

**Tech Stack:** TypeScript, Express, React 19, Vite, Vitest, Testing Library, GitHub Issues via `gh`.

---

## Issue Binding

- #1: Persist run summaries and restore history after restart
- #2: Replay historical run events from disk
- #3: Add rich agent picker with stable agent icons
- #4: Introduce the persistent history workbench shell
- #5: Polish the three-region Instrument Atelier UI

The plan intentionally follows dependency order for #1, #2, #4, and #5. #3 can run in parallel after Task 1, but Task 5 assumes #3 and #4 are merged.

## File Structure

Shared types:

- Modify `shared/src/types.ts`: add `RunSummary`, `RunListResponse`, optional `DetectedAgent.baseAgentId`, and optional `RunEvent` diagnostic/error shape support already needed by replay errors.

Backend:

- Create `server/src/runs/persistence.ts`: parse/write `runs/index.json`, read JSONL event logs, tolerate malformed records, and expose pure helpers for tests.
- Modify `server/src/runs/service.ts`: store request metadata, update summaries, restore indexed runs, replay events for restored runs, and expose summary/list helpers.
- Modify `server/src/api/runs.ts`: return `RunListResponse` from `GET /api/runs`, stream active events as today, replay restored events from disk, and preserve cursor semantics.
- Modify `server/src/runtimes/types.ts`: add optional `baseAgentId` to `RuntimeAgentDef`.
- Modify `server/src/runtimes/registry.ts`: stamp local profile defs with `baseAgentId` and expose it on detected agents.
- Modify `server/src/api/agents.ts` only if the response typing needs to include `baseAgentId`; no route behavior change expected.
- Test `server/tests/runs/service.test.ts`: persistence, restore, transitions, malformed index.
- Test `server/tests/api.test.ts`: `GET /api/runs` summaries and historical event replay.
- Test `server/tests/runtimes/local-profiles.test.ts` or `server/tests/runtimes/registry.test.ts`: base agent identity survives local profiles.

Frontend:

- Modify `web/src/api.ts`: add `fetchRuns`, `fetchRunEvents`, and response types.
- Create `web/src/components/AgentPicker.tsx`: rich accessible agent selector with stable icon mapping.
- Create `web/src/components/HistoryRail.tsx`: run history list and selection.
- Create `web/src/components/TranscriptPane.tsx`: selected run transcript, empty state, loading/error states, and read-only historical affordance.
- Modify `web/src/components/RunConsole.tsx`: reshape workbench composition around history, picker, transcript, composer, and inspector.
- Modify `web/src/components/RunInspector.tsx`: follow selected run and support historical raw events.
- Modify `web/src/components/MessageStream.tsx`: reuse `buildTranscript` from historical event arrays; export helpers if needed.
- Modify `web/src/App.tsx`: load runs, select runs, manage per-run event caches and live subscriptions.
- Modify `web/src/styles.css`: Instrument Atelier three-region layout, rich picker, history rail, status chips, responsive rules.
- Test `web/src/__tests__/App.test.tsx`: history load/selection, replay, new run insertion, rich picker, reuse prompt, existing run/cancel behavior.

## Task 1: #1 Persist Run Summaries and Restore History

**Files:**
- Modify: `shared/src/types.ts`
- Create: `server/src/runs/persistence.ts`
- Modify: `server/src/runs/service.ts`
- Modify: `server/src/api/runs.ts`
- Test: `server/tests/runs/service.test.ts`
- Test: `server/tests/api.test.ts`

- [ ] **Step 1: Add failing shared type and service persistence tests**

Add these types to `shared/src/types.ts` before implementation users need them:

```ts
export type RunSummary = RunStatusBody & {
  prompt: string;
  model?: string | null;
  reasoning?: string | null;
  cwd?: string | null;
  extraAllowedDirs?: string[];
};

export type RunListResponse = {
  runs: RunSummary[];
};
```

Append this test to `server/tests/runs/service.test.ts`:

```ts
test("persists run summaries and restores them in a new service instance", async () => {
  const runsLogDir = await tempDir();
  let now = 100;
  const firstService = createRunService({
    idGenerator: () => "run_persisted",
    now: () => now,
    runsLogDir
  });

  const created = firstService.create(request({
    prompt: "remember this run",
    model: "gpt-5",
    reasoning: "high",
    cwd: "D:/work",
    extraAllowedDirs: ["D:/shared"]
  }));
  now = 110;
  firstService.start(created.id, { childPid: 123, processGroupId: 123 });
  now = 120;
  await firstService.finish(created.id, { exitCode: 0 });

  const restoredService = createRunService({
    now: () => 200,
    runsLogDir
  });

  expect(restoredService.listSummaries()).toEqual([
    expect.objectContaining({
      id: "run_persisted",
      agentId: "codex",
      status: "succeeded",
      prompt: "remember this run",
      model: "gpt-5",
      reasoning: "high",
      cwd: "D:/work",
      extraAllowedDirs: ["D:/shared"],
      childPid: 123,
      processGroupId: 123,
      exitCode: 0,
      eventsLogPath: join(runsLogDir, "run_persisted.jsonl")
    })
  ]);
});
```

Add this malformed index test to the same file:

```ts
test("ignores malformed run index files instead of crashing", async () => {
  const runsLogDir = await tempDir();
  await mkdir(runsLogDir, { recursive: true });
  await writeFile(join(runsLogDir, "index.json"), "{not-json", "utf8");

  const service = createRunService({ runsLogDir });

  expect(service.listSummaries()).toEqual([]);
});
```

Update imports at the top of `server/tests/runs/service.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
```

- [ ] **Step 2: Run the failing service tests**

Run:

```bash
pnpm --filter @agent-nexus/server test -- tests/runs/service.test.ts
```

Expected: FAIL because `listSummaries` and persistence do not exist.

- [ ] **Step 3: Implement persistence helpers**

Create `server/src/runs/persistence.ts`:

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunSummary } from "@agent-nexus/shared";

export const RUN_INDEX_FILE = "index.json";

type RunIndexFile = {
  runs: RunSummary[];
};

export async function readRunIndex(runsLogDir: string): Promise<RunSummary[]> {
  try {
    const raw = await readFile(runIndexPath(runsLogDir), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed) || !Array.isArray(parsed.runs)) return [];
    return parsed.runs.filter(isRunSummary);
  } catch {
    return [];
  }
}

export async function writeRunIndex(runsLogDir: string, runs: RunSummary[]): Promise<void> {
  await mkdir(runsLogDir, { recursive: true });
  const target = runIndexPath(runsLogDir);
  const temp = `${target}.tmp`;
  const body: RunIndexFile = {
    runs: [...runs].sort((a, b) => b.createdAt - a.createdAt)
  };
  await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

export function runIndexPath(runsLogDir: string): string {
  return join(runsLogDir, RUN_INDEX_FILE);
}

function isRunSummary(input: unknown): input is RunSummary {
  return isObject(input) &&
    typeof input.id === "string" &&
    typeof input.agentId === "string" &&
    typeof input.prompt === "string" &&
    typeof input.status === "string" &&
    typeof input.createdAt === "number" &&
    typeof input.updatedAt === "number" &&
    typeof input.cancelRequested === "boolean";
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
```

- [ ] **Step 4: Wire summaries into the run service**

Modify `server/src/runs/service.ts`:

1. Import `RunSummary` and persistence helpers.
2. Create a `summaries` map initialized from a sync load fallback.
3. Add `listSummaries(filter?: RunListFilter): RunSummary[]`.
4. Add `persistSummariesSoon()` that writes asynchronously and does not throw into request paths.
5. Update create/start/terminal transitions to sync the summary.

Use this shape for the new methods and helpers:

```ts
function listSummaries(filter: RunListFilter = {}): RunSummary[] {
  const statuses = normalizeStatuses(filter.status);

  return Array.from(summaries.values())
    .filter((summary) => {
      if (filter.active === true && !activeStatuses.has(summary.status)) return false;
      if (filter.active === false && activeStatuses.has(summary.status)) return false;
      return statuses ? statuses.has(summary.status) : true;
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(cloneSummary);
}

function upsertSummary(record: RunRecord): void {
  summaries.set(record.body.id, {
    ...cloneBody(record.body),
    prompt: record.request.prompt,
    model: record.request.model ?? null,
    reasoning: record.request.reasoning ?? null,
    cwd: record.request.cwd ?? null,
    extraAllowedDirs: record.request.extraAllowedDirs ? [...record.request.extraAllowedDirs] : []
  });
  void persistSummaries();
}

async function persistSummaries(): Promise<void> {
  if (!options.runsLogDir) return;
  await writeRunIndex(options.runsLogDir, listSummaries());
}

function cloneSummary(summary: RunSummary): RunSummary {
  return {
    ...summary,
    extraAllowedDirs: summary.extraAllowedDirs ? [...summary.extraAllowedDirs] : []
  };
}
```

At construction time, synchronously load summaries with a helper that uses `existsSync/readFileSync` or change `createRunService` to accept `initialSummaries` for tests. Keep the public service creation synchronous because the current app construction is synchronous.

Return `listSummaries` from the service object.

- [ ] **Step 5: Run service tests**

Run:

```bash
pnpm --filter @agent-nexus/server test -- tests/runs/service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add API test for run summaries**

Add this test to `server/tests/api.test.ts`:

```ts
test("GET /api/runs returns persistent run summaries", async () => {
  const runs = createRunService({ idGenerator: () => "run_list", now: incrementingClock() });
  const run = runs.create({
    agentId: "fake",
    prompt: "show in history",
    model: "fake-model",
    cwd: "D:/work"
  });
  await runs.finish(run.id);
  const app = createApp({
    registry: fakeRegistry(),
    runs,
    detectAgents: async () => [detectedFake]
  });

  const response = await fetch(`${await listen(app)}/api/runs`);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    runs: [
      expect.objectContaining({
        id: "run_list",
        agentId: "fake",
        prompt: "show in history",
        model: "fake-model",
        cwd: "D:/work",
        status: "succeeded"
      })
    ]
  });
});
```

- [ ] **Step 7: Update `GET /api/runs` to return summaries**

Modify `server/src/api/runs.ts`:

```ts
router.get("/", (request, response) => {
  const status = parseStatusFilter(request.query.status);
  if (status === "invalid") {
    response.status(400).json({ error: "Invalid run status filter" });
    return;
  }

  response.json({
    runs: status === "active"
      ? services.runs.listSummaries({ active: true })
      : services.runs.listSummaries(status ? { status } : {})
  });
});
```

- [ ] **Step 8: Run API and type checks**

Run:

```bash
pnpm --filter @agent-nexus/server test -- tests/api.test.ts
pnpm --filter @agent-nexus/shared typecheck
pnpm --filter @agent-nexus/server typecheck
```

Expected: all PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add shared/src/types.ts server/src/runs/persistence.ts server/src/runs/service.ts server/src/api/runs.ts server/tests/runs/service.test.ts server/tests/api.test.ts
git commit -m "feat: persist run history summaries"
```

## Task 2: #2 Replay Historical Run Events From Disk

**Files:**
- Modify: `server/src/runs/persistence.ts`
- Modify: `server/src/runs/service.ts`
- Modify: `server/src/api/runs.ts`
- Test: `server/tests/runs/service.test.ts`
- Test: `server/tests/api.test.ts`

- [ ] **Step 1: Add failing replay tests**

Add this test to `server/tests/runs/service.test.ts`:

```ts
test("restores historical events from a persisted JSONL log", async () => {
  const runsLogDir = await tempDir();
  const firstService = createRunService({
    idGenerator: () => "run_replay",
    now: incrementingClock(),
    runsLogDir
  });
  const run = firstService.create(request({ prompt: "replay me" }));
  await firstService.emit(run.id, { type: "text_delta", delta: "saved output" });
  await firstService.finish(run.id);

  const restoredService = createRunService({ runsLogDir });

  expect(await restoredService.eventsAfterAsync(run.id, 0)).toEqual([
    expect.objectContaining({ id: 1, event: "text_delta", data: { type: "text_delta", delta: "saved output" } }),
    expect.objectContaining({ id: 2, event: "end", data: { type: "end", status: "succeeded" } })
  ]);
});
```

Add this test to `server/tests/api.test.ts`:

```ts
test("GET /api/runs/:id/events replays restored JSONL events", async () => {
  const runsLogDir = await mkdtemp(join(tmpdir(), "agent-nexus-api-runs-"));
  const firstRuns = createRunService({
    idGenerator: () => "run_restored_sse",
    now: incrementingClock(),
    runsLogDir
  });
  const run = firstRuns.create({ agentId: "fake", prompt: "restore events" });
  await firstRuns.emit(run.id, { type: "text_delta", delta: "from disk" });
  await firstRuns.finish(run.id);

  const restoredRuns = createRunService({ runsLogDir });
  const app = createApp({
    registry: fakeRegistry(),
    runs: restoredRuns,
    detectAgents: async () => [detectedFake]
  });

  const response = await fetch(`${await listen(app)}/api/runs/${run.id}/events`);
  const body = await response.text();

  expect(response.status).toBe(200);
  expect(body).toContain("event: text_delta");
  expect(body).toContain('"delta":"from disk"');
  expect(body).toContain("event: end");

  await rm(runsLogDir, { recursive: true, force: true });
});
```

Update `server/tests/api.test.ts` imports:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

- [ ] **Step 2: Run failing replay tests**

Run:

```bash
pnpm --filter @agent-nexus/server test -- tests/runs/service.test.ts tests/api.test.ts
```

Expected: FAIL because `eventsAfterAsync` and disk replay do not exist.

- [ ] **Step 3: Add JSONL event reader**

Append to `server/src/runs/persistence.ts`:

```ts
import type { StoredRunEvent } from "@agent-nexus/shared";

export async function readRunEventsFromLog(eventsLogPath: string, afterEventId = 0): Promise<StoredRunEvent[]> {
  try {
    const raw = await readFile(eventsLogPath, "utf8");
    return raw
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown)
      .filter(isStoredRunEvent)
      .filter((event) => event.id > afterEventId);
  } catch {
    return [{
      id: afterEventId + 1,
      event: "error",
      timestamp: Date.now(),
      data: {
        type: "error",
        message: "Unable to replay stored run events",
        code: "run.events_replay_failed"
      }
    }];
  }
}

function isStoredRunEvent(input: unknown): input is StoredRunEvent {
  return isObject(input) &&
    typeof input.id === "number" &&
    typeof input.event === "string" &&
    typeof input.timestamp === "number" &&
    isObject(input.data) &&
    typeof input.data.type === "string";
}
```

- [ ] **Step 4: Add async event replay to run service**

Modify `server/src/runs/service.ts`:

```ts
async function eventsAfterAsync(id: string, afterEventId = 0): Promise<StoredRunEvent[]> {
  const record = runs.get(id);
  if (record) {
    return eventsAfter(id, afterEventId);
  }

  const summary = summaries.get(id);
  if (!summary?.eventsLogPath) {
    return [];
  }

  return readRunEventsFromLog(summary.eventsLogPath, afterEventId);
}
```

Return `eventsAfterAsync` from the service object.

- [ ] **Step 5: Update events route to await replay before subscribing**

Modify `server/src/api/runs.ts` in `router.get("/:id/events", ...)`:

```ts
router.get("/:id/events", async (request, response) => {
  const run = services.runs.statusBody(request.params.id);
  if (!run) {
    response.status(404).json({ error: "Run not found" });
    return;
  }

  const after = parseEventCursor(request.query.after, request.get("Last-Event-ID"));
  if (after === null) {
    response.status(400).json({ error: "Invalid event cursor" });
    return;
  }
  const afterCursor = after;

  response.status(200);
  response.setHeader("content-type", "text/event-stream; charset=utf-8");
  response.setHeader("cache-control", "no-cache, no-transform");
  response.setHeader("connection", "keep-alive");
  response.flushHeaders?.();

  let closed = false;
  const sent = new Set<number>();
  const unsubscribe = services.runs.hasInMemoryRun(run.id)
    ? services.runs.subscribe(run.id, send)
    : () => undefined;
  request.on("close", close);

  for (const event of await services.runs.eventsAfterAsync(run.id, afterCursor)) {
    send(event);
    if (closed) break;
  }

  if (!services.runs.hasInMemoryRun(run.id)) {
    close();
  }

  function send(event: StoredRunEvent): void {
    if (closed || event.id <= afterCursor || sent.has(event.id)) return;
    sent.add(event.id);
    response.write(encodeSseEvent(event.id, event.event, event.data));
    if (isTerminalEvent(event)) close();
  }

  function close(): void {
    if (closed) return;
    closed = true;
    unsubscribe();
    response.end();
  }
});
```

Add `hasInMemoryRun(id: string): boolean` to `server/src/runs/service.ts`:

```ts
function hasInMemoryRun(id: string): boolean {
  return runs.has(id);
}
```

- [ ] **Step 6: Run replay tests**

Run:

```bash
pnpm --filter @agent-nexus/server test -- tests/runs/service.test.ts tests/api.test.ts
pnpm --filter @agent-nexus/server typecheck
```

Expected: all PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add server/src/runs/persistence.ts server/src/runs/service.ts server/src/api/runs.ts server/tests/runs/service.test.ts server/tests/api.test.ts
git commit -m "feat: replay persisted run events"
```

## Task 3: #3 Add Rich Agent Picker With Stable Icons

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `server/src/runtimes/types.ts`
- Modify: `server/src/runtimes/registry.ts`
- Test: `server/tests/runtimes/registry.test.ts`
- Create: `web/src/components/AgentPicker.tsx`
- Modify: `web/src/components/RunConsole.tsx`
- Test: `web/src/__tests__/App.test.tsx`

- [ ] **Step 1: Add failing registry test for profile base identity**

Append to `server/tests/runtimes/registry.test.ts`:

```ts
test("local profile detected agents expose base agent identity", () => {
  const registry = createAgentRegistry({
    profiles: [{
      id: "codex-work",
      name: "Work Codex",
      baseAgent: "codex"
    }]
  });

  const detected = listRegisteredAgents(registry, {
    env: { CODEX_BIN: "codex" },
    pathLookup: () => "C:/Tools/codex.exe"
  });

  expect(detected.find((agent) => agent.id === "codex-work")).toMatchObject({
    id: "codex-work",
    name: "Work Codex",
    baseAgentId: "codex"
  });
});
```

- [ ] **Step 2: Run failing registry test**

Run:

```bash
pnpm --filter @agent-nexus/server test -- tests/runtimes/registry.test.ts
```

Expected: FAIL because `baseAgentId` is not exposed.

- [ ] **Step 3: Add base agent identity to shared and runtime types**

Modify `shared/src/types.ts`:

```ts
export type DetectedAgent = {
  id: string;
  baseAgentId?: string;
  name: string;
  available: boolean;
  path?: string;
  version?: string | null;
  models: RuntimeModelOption[];
  reasoningOptions?: RuntimeModelOption[];
  modelsSource: "live" | "fallback";
  authStatus?: "ok" | "missing" | "unknown";
  authMessage?: string;
  diagnostics?: AgentDiagnostic[];
};
```

Modify `server/src/runtimes/types.ts`:

```ts
export type RuntimeAgentDef = {
  id: string;
  baseAgentId?: string;
  name: string;
  bin: string;
  // keep the rest of the existing fields unchanged
};
```

Modify `extendAgentDef` in `server/src/runtimes/registry.ts`:

```ts
return {
  ...base,
  id: profile.id,
  baseAgentId: base.baseAgentId ?? base.id,
  name: profile.name,
  bin: profile.bin ?? base.bin,
  configuredEnv: {
    ...(base.configuredEnv ?? {}),
    ...(profile.env ?? {}),
  },
  fallbackModels: withDefaultModel(base.fallbackModels, profile.defaultModel),
  buildArgs: (context) => [...profileArgs, ...base.buildArgs(context)],
};
```

Modify `listRegisteredAgents` to include:

```ts
baseAgentId: def.baseAgentId,
```

- [ ] **Step 4: Run registry and type checks**

Run:

```bash
pnpm --filter @agent-nexus/server test -- tests/runtimes/registry.test.ts
pnpm --filter @agent-nexus/shared typecheck
pnpm --filter @agent-nexus/server typecheck
```

Expected: all PASS.

- [ ] **Step 5: Add failing frontend test for rich picker**

In `web/src/__tests__/App.test.tsx`, after the initial render in the main workbench test, add:

```ts
expect(await screen.findByRole("button", { name: /Agent Codex/i })).toHaveTextContent("CX");
fireEvent.click(screen.getByRole("button", { name: /Agent Codex/i }));
expect(await screen.findByRole("option", { name: /Codex/i })).toHaveTextContent("CX");
expect(screen.getByRole("option", { name: /Claude/i })).toHaveTextContent("CL");
expect(screen.getByRole("option", { name: /Claude/i })).toHaveAttribute("aria-disabled", "true");
```

In the mocked Claude agent, add:

```ts
baseAgentId: "claude",
```

- [ ] **Step 6: Run failing frontend test**

Run:

```bash
pnpm --filter @agent-nexus/web test -- src/__tests__/App.test.tsx
```

Expected: FAIL because `AgentPicker` does not exist.

- [ ] **Step 7: Create `AgentPicker`**

Create `web/src/components/AgentPicker.tsx`:

```tsx
import { useId, useState } from "react";
import type { DetectedAgent } from "@agent-nexus/shared";

type AgentPickerProps = {
  agents: DetectedAgent[];
  selectedAgentId: string | null;
  selectedModel: string;
  onSelect: (agentId: string) => void;
};

const iconByAgentId: Record<string, string> = {
  codex: "CX",
  claude: "CL",
  opencode: "OC",
  gemini: "GM",
  "cursor-agent": "CA"
};

export function AgentPicker({ agents, selectedAgentId, selectedModel, onSelect }: AgentPickerProps) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;

  return (
    <div className="agent-picker">
      <span className="control-label">Agent</span>
      <button
        type="button"
        className="agent-picker-button"
        aria-label={`Agent ${selectedAgent?.name ?? "none"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((value) => !value)}
      >
        <AgentIcon agent={selectedAgent} />
        <span className="agent-picker-copy">
          <strong>{selectedAgent?.name ?? "No agent"}</strong>
          <span>{agentMeta(selectedAgent, selectedModel)}</span>
        </span>
      </button>

      {open && (
        <div className="agent-picker-menu" id={listboxId} role="listbox" aria-label="Agents">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              role="option"
              aria-selected={agent.id === selectedAgent?.id}
              aria-disabled={!agent.available}
              className={`agent-picker-option ${agent.id === selectedAgent?.id ? "selected" : ""}`}
              onClick={() => {
                if (!agent.available) return;
                onSelect(agent.id);
                setOpen(false);
              }}
            >
              <AgentIcon agent={agent} />
              <span className="agent-picker-copy">
                <strong>{agent.name}</strong>
                <span>{agentMeta(agent, agent.models[0]?.label ?? "")}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentIcon({ agent }: { agent: DetectedAgent | null }) {
  return <span className="agent-icon" aria-hidden="true">{agentIcon(agent)}</span>;
}

export function agentIcon(agent: DetectedAgent | null): string {
  if (!agent) return "AG";
  return iconByAgentId[agent.baseAgentId ?? agent.id] ?? "AG";
}

function agentMeta(agent: DetectedAgent | null, selectedModel: string): string {
  if (!agent) return "No runtime selected";
  const availability = agent.available ? "available" : "missing";
  const auth = agent.authStatus ?? "auth unknown";
  const model = selectedModel || agent.models[0]?.label || "model unknown";
  return `${model} · ${availability} · ${auth}`;
}
```

- [ ] **Step 8: Wire `AgentPicker` into `RunConsole`**

Modify `web/src/components/RunConsole.tsx` imports:

```tsx
import { AgentPicker } from "./AgentPicker.js";
```

Replace the `Agent` label/select block with:

```tsx
<AgentPicker
  agents={props.agents}
  selectedAgentId={props.selectedAgentId}
  selectedModel={props.selectedModel}
  onSelect={props.onAgentChange}
/>
```

Keep the existing Model select unchanged.

- [ ] **Step 9: Add picker styles**

Add to `web/src/styles.css`:

```css
.agent-picker {
  position: relative;
  display: grid;
  gap: 6px;
  min-width: 230px;
}

.control-label {
  color: #3f4650;
  font-size: 12px;
  font-weight: 700;
}

.agent-picker-button,
.agent-picker-option {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 7px;
  text-align: left;
  color: var(--text);
  background: var(--surface);
}

.agent-picker-button[aria-expanded="true"],
.agent-picker-option.selected {
  border-color: var(--blue);
  background: var(--surface-tint);
}

.agent-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 7px;
  color: #fff;
  background: var(--blue);
  font-size: 12px;
  font-weight: 900;
}

.agent-picker-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.agent-picker-copy span {
  color: var(--muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-picker-menu {
  position: absolute;
  z-index: 10;
  top: calc(100% + 6px);
  right: 0;
  display: grid;
  gap: 6px;
  width: min(320px, 80vw);
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.agent-picker-option[aria-disabled="true"] {
  opacity: 0.55;
  cursor: not-allowed;
}
```

- [ ] **Step 10: Run frontend tests and commit Task 3**

Run:

```bash
pnpm --filter @agent-nexus/web test -- src/__tests__/App.test.tsx
pnpm --filter @agent-nexus/web typecheck
```

Expected: PASS.

Commit:

```bash
git add shared/src/types.ts server/src/runtimes/types.ts server/src/runtimes/registry.ts server/tests/runtimes/registry.test.ts web/src/components/AgentPicker.tsx web/src/components/RunConsole.tsx web/src/styles.css web/src/__tests__/App.test.tsx
git commit -m "feat: add rich agent picker"
```

## Task 4: #4 Introduce Persistent History Workbench Shell

**Files:**
- Modify: `web/src/api.ts`
- Create: `web/src/components/HistoryRail.tsx`
- Create: `web/src/components/TranscriptPane.tsx`
- Modify: `web/src/components/MessageStream.tsx`
- Modify: `web/src/components/RunConsole.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/RunInspector.tsx`
- Test: `web/src/__tests__/App.test.tsx`

- [ ] **Step 1: Add failing history API/UI tests**

In `web/src/__tests__/App.test.tsx`, update the `/api/agents` mock agents with `baseAgentId` fields where known.

Add a new test:

```tsx
test("loads persisted history and selects a historical transcript", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/agents") {
      return jsonResponse({
        diagnostics: [],
        config: { agentsConfigPath: "D:/agent-nexus/agents.local.json", agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG" },
        agents: [{
          id: "codex",
          baseAgentId: "codex",
          name: "Codex",
          available: true,
          models: [{ id: "gpt-5", label: "GPT-5" }],
          modelsSource: "live",
          authStatus: "ok",
          diagnostics: []
        }]
      });
    }
    if (url === "/api/runs") {
      return jsonResponse({
        runs: [{
          id: "run-old",
          agentId: "codex",
          status: "succeeded",
          createdAt: 100,
          updatedAt: 200,
          cancelRequested: false,
          childPid: null,
          processGroupId: null,
          exitCode: 0,
          signal: null,
          error: null,
          errorCode: null,
          eventsLogPath: "D:/runs/run-old.jsonl",
          prompt: "Summarize the repo",
          model: "gpt-5",
          reasoning: null,
          cwd: null,
          extraAllowedDirs: []
        }]
      });
    }
    if (url === "/api/runs/run-old/events") {
      return sseResponse([
        { id: 1, event: "text_delta", data: { type: "text_delta", delta: "Repo summary" } },
        { id: 2, event: "end", data: { type: "end", status: "succeeded" } }
      ]);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);

  expect(await screen.findByRole("button", { name: /Summarize the repo/i })).toBeInTheDocument();
  expect(await screen.findByText("Repo summary")).toBeInTheDocument();
  expect(screen.getByRole("complementary", { name: "Run history" })).toBeInTheDocument();
});
```

Add this helper at the bottom:

```ts
function sseResponse(events: Array<{ id: number; event: string; data: unknown }>): Response {
  return new Response(events.map((event) => [
    `id: ${event.id}`,
    `event: ${event.event}`,
    `data: ${JSON.stringify(event.data)}`,
    "",
    ""
  ].join("\n")).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}
```

- [ ] **Step 2: Run failing history test**

Run:

```bash
pnpm --filter @agent-nexus/web test -- src/__tests__/App.test.tsx
```

Expected: FAIL because `/api/runs` is not fetched and history components do not exist.

- [ ] **Step 3: Add history API helpers**

Modify `web/src/api.ts` imports:

```ts
import type { AgentDiagnostic, CreateRunRequest, DetectedAgent, RunEvent, RunListResponse, RunStatusBody, RunSummary, StoredRunEvent } from "@agent-nexus/shared";
```

Add:

```ts
export async function fetchRuns(): Promise<RunListResponse> {
  return requestJson<RunListResponse>("/api/runs");
}

export async function fetchRunEvents(runId: string, after?: number): Promise<StoredRunEvent[]> {
  const query = after && after > 0 ? `?after=${after}` : "";
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events${query}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body.error === "string" ? body.error : `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return parseSseEvents(await response.text());
}

function parseSseEvents(input: string): StoredRunEvent[] {
  return input
    .split(/\n\n/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split(/\n/u);
      const id = Number.parseInt(lines.find((line) => line.startsWith("id: "))?.slice(4) ?? "0", 10);
      const event = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "message";
      const dataLine = lines.find((line) => line.startsWith("data: "));
      return {
        id,
        event,
        data: parseRunEvent(dataLine?.slice(6) ?? "{}"),
        timestamp: Date.now()
      };
    });
}
```

Keep `RunSummary` imported for downstream component props.

- [ ] **Step 4: Create `HistoryRail`**

Create `web/src/components/HistoryRail.tsx`:

```tsx
import type { RunSummary } from "@agent-nexus/shared";

type HistoryRailProps = {
  runs: RunSummary[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
};

export function HistoryRail({ runs, selectedRunId, onSelect }: HistoryRailProps) {
  return (
    <aside className="history-rail" aria-label="Run history">
      <div className="panel-head">
        <div>
          <p className="eyebrow">History</p>
          <h2>Runs</h2>
        </div>
      </div>
      <div className="history-list">
        {runs.length === 0 ? (
          <p className="muted">No runs yet.</p>
        ) : runs.map((run) => (
          <button
            key={run.id}
            type="button"
            className={`history-item ${run.id === selectedRunId ? "selected" : ""}`}
            aria-pressed={run.id === selectedRunId}
            onClick={() => onSelect(run.id)}
          >
            <span className={`status-dot ${run.status}`} aria-hidden="true" />
            <span className="history-copy">
              <strong>{run.prompt}</strong>
              <span>{run.agentId} · {run.model ?? "default model"} · {run.status}</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 5: Create `TranscriptPane`**

Create `web/src/components/TranscriptPane.tsx`:

```tsx
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
      {error && <div className="inline-error"><strong>history</strong><span>{error}</span></div>}
      <MessageStream currentRun={currentRun} events={events} prompt={prompt} />
    </section>
  );
}
```

- [ ] **Step 6: Export transcript helper if needed**

If components need `buildTranscript` outside `MessageStream`, keep the existing export already present:

```ts
export function buildTranscript(events: RunEvent[]): Transcript {
  // existing implementation
}
```

No code change is needed if `TranscriptPane` keeps using `MessageStream`.

- [ ] **Step 7: Wire run history state in `App.tsx`**

Modify `web/src/App.tsx` imports:

```ts
import { cancelRun, createRun, fetchAgents, fetchRun, fetchRunEvents, fetchRuns, subscribeRunEvents, type AgentsConfig, type RunEventSubscription } from "./api.js";
import type { RunSummary } from "@agent-nexus/shared";
```

Add state:

```ts
const [runSummaries, setRunSummaries] = useState<RunSummary[]>([]);
const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
const [eventsByRunId, setEventsByRunId] = useState<Record<string, RunEvent[]>>({});
const [rawEventsByRunId, setRawEventsByRunId] = useState<Record<string, StoredRunEvent[]>>({});
const [loadingRunEvents, setLoadingRunEvents] = useState(false);
const [runEventsError, setRunEventsError] = useState<string | null>(null);
```

Add initial load inside the mount effect:

```ts
void refreshRuns();
```

Add:

```ts
async function refreshRuns(): Promise<void> {
  const response = await fetchRuns();
  setRunSummaries(response.runs);
  setSelectedRunId((previous) => previous ?? response.runs[0]?.id ?? null);
}

async function selectRun(runId: string): Promise<void> {
  setSelectedRunId(runId);
  if (rawEventsByRunId[runId]) return;

  setLoadingRunEvents(true);
  setRunEventsError(null);
  try {
    const storedEvents = await fetchRunEvents(runId);
    setRawEventsByRunId((previous) => ({ ...previous, [runId]: storedEvents }));
    setEventsByRunId((previous) => ({ ...previous, [runId]: storedEvents.map((event) => event.data) }));
  } catch (caught) {
    setRunEventsError(caught instanceof Error ? caught.message : String(caught));
  } finally {
    setLoadingRunEvents(false);
  }
}
```

When `refreshRuns` selects an initial run, follow it with `void selectRun(response.runs[0].id)` after setting summaries.

Update `startRun` after `createRun` returns:

```ts
const summary: RunSummary = {
  ...run,
  prompt,
  model: selectedModel || null,
  reasoning: reasoning.trim() || null,
  cwd: consoleState.cwd.trim() || null,
  extraAllowedDirs: consoleState.extraAllowedDirs
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
};
setRunSummaries((previous) => [summary, ...previous.filter((item) => item.id !== run.id)]);
setSelectedRunId(run.id);
```

When events arrive, update per-run caches:

```ts
setRawEventsByRunId((previous) => ({ ...previous, [run.id]: [...(previous[run.id] ?? []), storedEvent] }));
setEventsByRunId((previous) => ({ ...previous, [run.id]: [...(previous[run.id] ?? []), storedEvent.data] }));
```

- [ ] **Step 8: Pass history props through `RunConsole`**

Extend `RunConsoleProps` in `web/src/components/RunConsole.tsx`:

```ts
runSummaries: RunSummary[];
selectedRunId: string | null;
selectedRunPrompt: string;
selectedRunEvents: RunEvent[];
selectedRunRawEvents: StoredRunEvent[];
loadingRunEvents: boolean;
runEventsError: string | null;
onRunSelect: (runId: string) => void;
```

Import `RunSummary`, `HistoryRail`, and `TranscriptPane`.

Render:

```tsx
<div className="workbench-grid">
  <HistoryRail runs={props.runSummaries} selectedRunId={props.selectedRunId} onSelect={props.onRunSelect} />
  <TranscriptPane
    currentRun={props.currentRun}
    events={props.selectedRunEvents}
    prompt={props.selectedRunPrompt}
    loading={props.loadingRunEvents}
    error={props.runEventsError}
  />
  <RunInspector ... rawEvents={props.selectedRunRawEvents} ... />
</div>
```

Keep the existing details drawer behavior if the inspector is still drawer-based during this task; final placement can be polished in Task 5.

- [ ] **Step 9: Add shell styles**

Add to `web/src/styles.css`:

```css
.workbench-grid {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
  flex: 1 1 0;
}

.history-rail {
  min-height: 0;
  overflow: auto;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
}

.history-list {
  display: grid;
  gap: 8px;
}

.history-item {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  gap: 10px;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface-soft);
  text-align: left;
}

.history-item.selected {
  border-color: var(--blue);
  background: var(--surface-tint);
}

.history-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.history-copy strong,
.history-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-copy span {
  color: var(--muted);
  font-size: 12px;
}

.transcript-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 10: Run frontend tests and commit Task 4**

Run:

```bash
pnpm --filter @agent-nexus/web test -- src/__tests__/App.test.tsx
pnpm --filter @agent-nexus/web typecheck
```

Expected: PASS.

Commit:

```bash
git add web/src/api.ts web/src/components/HistoryRail.tsx web/src/components/TranscriptPane.tsx web/src/components/MessageStream.tsx web/src/components/RunConsole.tsx web/src/components/RunInspector.tsx web/src/App.tsx web/src/styles.css web/src/__tests__/App.test.tsx
git commit -m "feat: add persistent history workbench shell"
```

## Task 5: #5 Polish Instrument Atelier UI and Historical Reuse

**Files:**
- Modify: `web/src/components/HistoryRail.tsx`
- Modify: `web/src/components/TranscriptPane.tsx`
- Modify: `web/src/components/RunConsole.tsx`
- Modify: `web/src/components/RunInspector.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`
- Test: `web/src/__tests__/App.test.tsx`

- [ ] **Step 1: Add failing reuse/read-only test**

Add to `web/src/__tests__/App.test.tsx`:

```tsx
test("copies a historical prompt into the composer without mutating history", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/agents") {
      return jsonResponse({
        diagnostics: [],
        config: { agentsConfigPath: "D:/agent-nexus/agents.local.json", agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG" },
        agents: [{
          id: "codex",
          baseAgentId: "codex",
          name: "Codex",
          available: true,
          models: [{ id: "gpt-5", label: "GPT-5" }],
          modelsSource: "live",
          authStatus: "ok",
          diagnostics: []
        }]
      });
    }
    if (url === "/api/runs") {
      return jsonResponse({
        runs: [{
          id: "run-copy",
          agentId: "codex",
          status: "succeeded",
          createdAt: 100,
          updatedAt: 200,
          cancelRequested: false,
          childPid: null,
          processGroupId: null,
          exitCode: 0,
          signal: null,
          error: null,
          errorCode: null,
          eventsLogPath: "D:/runs/run-copy.jsonl",
          prompt: "Reuse this prompt",
          model: "gpt-5",
          reasoning: null,
          cwd: null,
          extraAllowedDirs: []
        }]
      });
    }
    if (url === "/api/runs/run-copy/events") {
      return sseResponse([{ id: 1, event: "end", data: { type: "end", status: "succeeded" } }]);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);

  expect(await screen.findByText("Read-only history")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Use prompt again" }));
  expect(screen.getByLabelText("Prompt")).toHaveValue("Reuse this prompt");
  expect(screen.getByRole("button", { name: /Reuse this prompt/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run failing reuse test**

Run:

```bash
pnpm --filter @agent-nexus/web test -- src/__tests__/App.test.tsx
```

Expected: FAIL because read-only copy/reuse UI is absent.

- [ ] **Step 3: Add selected run summary and reuse callback**

In `web/src/App.tsx`, derive:

```ts
const selectedRunSummary = useMemo(
  () => runSummaries.find((run) => run.id === selectedRunId) ?? null,
  [runSummaries, selectedRunId]
);

const selectedRunPrompt = selectedRunSummary?.prompt ?? submittedPrompt;
const selectedRunEvents = selectedRunId ? eventsByRunId[selectedRunId] ?? events : events;
const selectedRunRawEvents = selectedRunId ? rawEventsByRunId[selectedRunId] ?? rawEvents : rawEvents;
const viewingHistoricalTerminalRun = Boolean(
  selectedRunSummary && selectedRunSummary.id !== currentRun?.id && !["queued", "running"].includes(selectedRunSummary.status)
);
```

Add:

```ts
function reusePrompt(prompt: string): void {
  setConsoleState((previous) => ({ ...previous, prompt }));
}
```

Pass `selectedRunSummary`, `viewingHistoricalTerminalRun`, and `onReusePrompt={reusePrompt}` to `RunConsole`.

- [ ] **Step 4: Add read-only/reuse UI**

Extend `TranscriptPaneProps`:

```ts
selectedRunSummary: RunSummary | null;
readOnlyHistory: boolean;
onReusePrompt: (prompt: string) => void;
```

Render above `MessageStream`:

```tsx
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
```

- [ ] **Step 5: Move inspector into the three-region layout**

Modify `RunConsole` so the default desktop layout is:

```tsx
<div className="workbench-grid three-region">
  <HistoryRail ... />
  <TranscriptPane ... />
  <aside className="inspector-panel" aria-label="Run inspector">
    <RunInspector ... variant="embedded" />
  </aside>
</div>
```

If keeping drawer support, add an optional prop to `RunInspector`:

```ts
variant?: "drawer" | "embedded";
```

Use `variant` to select wrapper class:

```tsx
<aside className={variant === "embedded" ? "run-inspector embedded" : "details-drawer"} aria-label="Run details">
```

- [ ] **Step 6: Apply Instrument Atelier CSS tokens**

Revise `:root` in `web/src/styles.css`:

```css
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f5f2ea;
  color: #17202a;
  --bg: #f5f2ea;
  --surface: #ffffff;
  --surface-soft: #fbfaf6;
  --surface-tint: #e8eefc;
  --line: #d8d3c7;
  --line-strong: #b8b09f;
  --muted: #66707a;
  --text: #17202a;
  --blue: #2354ad;
  --blue-soft: #e8eefc;
  --green: #15803d;
  --amber: #a16207;
  --red: #b42318;
  --shadow: 0 18px 45px rgba(39, 45, 52, 0.13);
}
```

Add:

```css
body {
  margin: 0;
  min-width: 0;
  background:
    linear-gradient(90deg, rgba(35, 84, 173, 0.045) 1px, transparent 1px),
    linear-gradient(180deg, rgba(35, 84, 173, 0.04) 1px, transparent 1px),
    var(--bg);
  background-size: 28px 28px;
}

.three-region {
  grid-template-columns: 250px minmax(0, 1fr) 320px;
}

.inspector-panel,
.run-inspector.embedded {
  min-height: 0;
  overflow: auto;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
}

.history-readonly-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-soft);
}

.history-readonly-banner div {
  display: grid;
  gap: 3px;
}

.history-readonly-banner span {
  color: var(--muted);
  font-size: 12px;
}

.status-dot.succeeded,
.status-dot.running,
.status-dot.queued {
  background: var(--green);
}

.status-dot.failed,
.status-dot.canceled {
  background: var(--red);
}

@media (max-width: 1100px) {
  .three-region {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  .inspector-panel {
    display: none;
  }
}

@media (max-width: 760px) {
  .workbench-grid,
  .three-region {
    grid-template-columns: 1fr;
  }

  .history-rail {
    max-height: 220px;
  }

  .history-readonly-banner {
    align-items: stretch;
    flex-direction: column;
  }
}
```

- [ ] **Step 7: Verify responsive behavior manually**

Run the app:

```bash
pnpm dev
```

Open `http://127.0.0.1:5173` and verify:

- Desktop: history, transcript, inspector fit without overlap.
- Narrow desktop: inspector collapses/hides cleanly.
- Mobile width: history stacks above transcript, composer buttons do not overflow.
- Agent picker menu stays within viewport.

- [ ] **Step 8: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: all PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add web/src/components/HistoryRail.tsx web/src/components/TranscriptPane.tsx web/src/components/RunConsole.tsx web/src/components/RunInspector.tsx web/src/App.tsx web/src/styles.css web/src/__tests__/App.test.tsx
git commit -m "feat: polish persistent history workbench"
```

## Self-Review

- Spec coverage: Task 1 covers persistent summaries and restored `GET /api/runs`; Task 2 covers historical event replay; Task 3 covers rich agent icons and local profile inheritance; Task 4 covers history rail, transcript selection, and inspector context; Task 5 covers Instrument Atelier polish, read-only historical runs, and `Use prompt again`.
- Issue alignment: Tasks map directly to #1-#5. #3 is clarified by adding `baseAgentId`; no issue body change is required because the issue already says inheritance applies when base information is available.
- Placeholder scan: no task contains red-flag placeholder language. Steps include commands, expected outcomes, and concrete code shapes.
- Type consistency: `RunSummary`, `RunListResponse`, `baseAgentId`, `eventsAfterAsync`, `hasInMemoryRun`, `fetchRuns`, and `fetchRunEvents` are introduced before downstream usage.
