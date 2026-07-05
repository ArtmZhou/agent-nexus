# Persistent History Workbench

## Context

Agent Nexus currently presents a focused single-run chat workbench. It can create a run, stream normalized events, cancel active work, and inspect raw events and diagnostics. The interface is functional, but it still behaves like a transient console: once the server restarts, past runs are not recoverable from the API even though event JSONL files may exist on disk.

This redesign turns the product into a persistent local agent workbench. The frontend should feel more polished and agent-aware, and the backend should retain enough run metadata to restore history across service restarts without introducing a database.

## Decisions

- Use the **Instrument Atelier** visual direction: warm paper background, white work surfaces, precise blue for focus and selected states, green/amber/red for runtime status, and compact 6-8px radius controls.
- Use a **rich agent picker** rather than a permanent icon rail. The selected agent appears with an icon, availability, auth status, and model context; opening the picker shows all agents with status and brief diagnostics.
- Add **persistent run history** across service restarts.
- Keep the run protocol and event model intact. This pass should extend persistence and UI structure rather than redesign agent execution.

## Goals

- Show past runs in a left-side history surface.
- Restore historical runs after the server restarts.
- Reconstruct historical transcripts from stored event logs.
- Make agent selection visually identifiable with stable icons.
- Move metadata and diagnostics into a right-side inspector that follows the selected run.
- Keep active run streaming and cancellation reliable while history is visible.
- Preserve the existing backend API shape where possible and add only narrow endpoints/fields needed for history.

## Non-Goals

- No multi-turn conversation tree.
- No database.
- No cloud sync or account system.
- No editable historical runs.
- No profile editor.
- No changes to agent runtime launch semantics.

## Information Architecture

Use a three-region workbench:

1. **History rail**
   - Shows persisted runs in reverse chronological order.
   - Each item displays agent icon, status, prompt summary, model when known, and relative or formatted time.
   - Selecting a run changes the transcript and inspector to that run.
   - Active runs remain visually distinct and continue updating.

2. **Main transcript**
   - Shows the selected run's prompt and reconstructed assistant output.
   - Shows the composer for starting a new run.
   - Historical terminal runs are read-only.
   - Historical prompts can be copied back into the composer through a `Use prompt again` action.

3. **Inspector**
   - Shows run metadata, diagnostics, raw events, and agent configuration.
   - Defaults to collapsed or narrow enough not to dominate the main work.
   - Follows the selected run.

## Agent Picker

The top control area includes a rich agent picker:

- The closed state shows the selected agent icon, name, availability, auth status, and model/source summary.
- The open state lists all agents with the same icon system and short status metadata.
- Unavailable agents are disabled or visually muted.
- Local profiles inherit the icon of their `baseAgent` when available.
- Unknown/custom agents use a neutral `AG` icon.

Use these default icons:

- Codex: `CX`
- Claude: `CL`
- OpenCode: `OC`
- Gemini: `GM`
- Cursor Agent: `CA`
- Unknown/custom: `AG`

The picker must remain accessible through labels and roles so tests and keyboard users can operate it.

## Backend Persistence

The existing service keeps run bodies and events in memory and writes event JSONL files when `runsLogDir` is configured. Add a lightweight persistent index in the runs log directory.

Recommended storage:

- Event logs remain at `runs/<runId>.jsonl`.
- Add `runs/index.json` containing run summaries and original request metadata.
- Write index updates on create, start, terminal transition, and relevant metadata changes.
- Load the index during run service creation so `GET /api/runs` returns historical runs after restart.
- When serving `GET /api/runs/:id/events`, return in-memory events for live runs and read the JSONL file for restored historical runs.

Index records should include:

- `id`
- `agentId`
- `status`
- `createdAt`
- `updatedAt`
- `prompt`
- `model`
- `reasoning`
- `cwd`
- `extraAllowedDirs`
- process metadata and terminal error fields from `RunStatusBody`
- `eventsLogPath`

If an index entry references a missing or malformed JSONL file, the run should still appear in history with an inspector warning instead of crashing the API.

## API Behavior

Keep existing endpoints:

- `GET /api/runs`: returns active and historical runs, optionally filtered by status.
- `GET /api/runs/:id`: returns a run status body for active or historical runs.
- `GET /api/runs/:id/events`: streams active runs and replays historical events from disk.
- `POST /api/runs`: creates a new run and persists its index entry.
- `POST /api/runs/:id/cancel`: cancels active runs; terminal historical runs are not cancelable.

Add a narrow shared `RunSummary` type for `GET /api/runs` so history can display prompt/model metadata without stuffing request fields into `RunStatusBody`. Keep `GET /api/runs/:id` focused on status metadata and use the events endpoint for transcript reconstruction.

`RunSummary` should contain the status fields needed for list rendering plus request summary fields: prompt, model, reasoning, cwd, and extra allowed dirs.

## Frontend Behavior

- On load, fetch agents and persisted runs.
- Select the newest active run if one exists; otherwise select the newest run; otherwise show the empty composer state.
- Starting a run appends it to the history rail immediately and selects it.
- While a run streams, append events to the selected run transcript and update its history item status.
- Selecting a historical run loads or reuses its events and reconstructs the transcript with the existing transcript builder.
- Viewing history does not close an active stream.
- `Use prompt again` copies the historical prompt into the composer without mutating the historical run.
- Details/inspector content follows the selected run and selected agent context.

## Visual System

Use a compact utility-tool aesthetic:

- Background: warm paper neutral.
- Surfaces: white and slightly warm off-white.
- Accent: crisp blue for selected/focus/primary action.
- Status: green for queued/running/succeeded, red for failed/canceled, amber for warnings/missing diagnostics.
- Typography: existing sans stack is acceptable; keep monospace for run ids, code, raw events, and status chips.
- Keep text legible and dense. This is a workbench, not a landing page.
- Avoid decorative gradients, large hero sections, and permanent raw JSON panels.

## Component Shape

Expected frontend components:

- `WorkbenchShell`: top-level layout and state wiring.
- `HistoryRail`: persisted run list and selection.
- `AgentPicker`: rich agent selector with icons and status.
- `TranscriptPane`: selected run prompt, assistant output, and historical read-only states.
- `Composer`: prompt input and run/cancel/reuse controls.
- `RunInspector`: metadata, diagnostics, raw events, and agent config.

Exact names may follow local style, but run lifecycle state should stay separate from rendering components.

Expected backend additions:

- Run index load/save helpers inside or beside `runs/service.ts`.
- Tests for index persistence and historical event replay.
- Narrow shared types for run summaries if needed.

## Error Handling

- If history index loading fails, surface a diagnostic and continue with an empty history rather than failing server startup.
- If a single index record is malformed, skip that record and report a diagnostic when possible.
- If event replay fails for a historical run, keep the run visible and show a readable transcript error.
- If an active run is selected and the SSE stream disconnects, keep existing error behavior and leave the run visible in history.

## Testing

Backend tests:

- Creating a run writes or updates the persistent index.
- Terminal transitions update status and error metadata in the index.
- A new run service instance can restore indexed runs.
- Historical events can be read from JSONL after restart.
- Malformed or missing history files do not crash the service.

Frontend tests:

- History rail renders persisted runs from `GET /api/runs`.
- Creating a run adds it to history and selects it.
- Selecting a historical run replays transcript events.
- `Use prompt again` copies the historical prompt into the composer.
- Rich agent picker shows icons/status and remains accessible.
- Inspector follows the selected run.
- Existing run, streaming, cancel, reasoning, and details behavior remain covered.

## Acceptance Criteria

- The default page reads as a polished three-region local agent workbench.
- Agent selection displays agent icons and runtime status.
- Run history persists across service restart.
- Historical transcripts can be reopened from the UI.
- Active streaming still works while history is visible.
- Terminal historical runs are read-only and can seed a new prompt.
- Diagnostics and raw events are accessible without dominating the main screen.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.
