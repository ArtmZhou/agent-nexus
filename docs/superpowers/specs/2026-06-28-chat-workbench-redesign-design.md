# Chat Workbench Redesign

## Context

The current local web client proves the Run / Streaming / Cancel flow, but the default screen reads like an operations console. Agent paths, diagnostics, settings, raw events, stderr, usage, and process metadata compete with the actual task: ask a local agent to do work and read its answer.

The redesign keeps the existing backend contract and run lifecycle, but changes the web app's default information architecture. The first screen should feel like a focused agent workbench, not a debugging dashboard.

## Goals

- Make the main screen centered on conversation: prompt input, streamed assistant response, run status, and cancel.
- Render agent output as user-facing messages instead of separate raw panes.
- Move diagnostics, settings, raw events, and process metadata behind secondary controls.
- Keep all existing local agent capabilities reachable without making them permanent first-screen furniture.
- Preserve the existing API shape and run event semantics.

## Non-Goals

- No backend protocol redesign.
- No persisted chat history.
- No multi-run session tree.
- No desktop-client packaging work.
- No new agent integrations.

## Main Screen Design

Use the selected visual direction: **A. Chat Workbench**.

The main screen has three stable regions:

1. Top bar: app name, selected agent, selected model, compact run status, secondary actions.
2. Message stream: user prompt and assistant response rendered as readable messages.
3. Composer: prompt textarea plus Run / Cancel controls.

The first viewport should not show settings, raw events, diagnostics, PID, process group, executable paths, or config examples. Those are secondary surfaces.

## Secondary Surfaces

Secondary controls live in the top bar or a compact details button near the run status:

- Agent picker: select agent and model, with unavailable agents visually de-emphasized.
- Run details: run id, PID, process group, exit, signal, log path, raw events.
- Diagnostics: global and per-agent diagnostics.
- Advanced run options: cwd, reasoning, extra allowed dirs.

These surfaces may be implemented as lightweight drawers, popovers, or collapsible panels. They must not be visible by default on the main screen.

## Message Rendering

The frontend should derive a rendered transcript from the existing event stream:

- `text_delta`: append to the assistant message body.
- `thinking_delta`: show in a collapsible "Thinking" section on the assistant message.
- `tool_use`: render as a compact tool call block with tool name and formatted input.
- `tool_result`: render as a compact tool result block associated with its tool id where possible.
- `stderr`: render as a collapsed warning detail, not a permanent pane.
- `error`: render as an inline failed-run message with the error code/details available in details.
- `usage`: render as a small usage footer on the assistant message.
- `end`: update the run status.

Plain text should be readable. Code fences should render as code blocks. Inline code should render as inline code. Implement this with a small local renderer for this pass rather than adding a markdown dependency.

## Visual Direction

Use a restrained light workbench aesthetic:

- Background: warm off-white / paper neutral.
- Text: dark neutral with strong readable contrast.
- Accent: one crisp blue for selected state, focus, and primary action.
- Status colors: green for running/succeeded, red for failed/canceled, amber for warnings.
- Radius: 6-8px.
- Density: closer to an editor/chat tool than a marketing page.

Avoid decorative gradients, large hero sections, diagnostic-heavy dashboards, and permanently visible raw JSON.

## Component Shape

Refactor the current front-end components around clearer roles:

- `WorkbenchShell`: page structure and top-level state wiring.
- `TopBar`: agent/model/status and secondary entry points.
- `MessageStream`: transcript display and empty/running/error states.
- `Composer`: prompt input plus Run / Cancel.
- `RunDetailsDrawer`: raw events and process metadata.
- `AdvancedOptions`: cwd, reasoning, extra allowed dirs.

Exact names may follow the existing code style, but the boundaries should keep rendering separate from run lifecycle wiring.

## Testing

Update the existing web test to verify:

- Main screen renders the chat workbench, not persistent settings/inspector panes.
- Starting a run sends prompt, agent, model, reasoning, cwd, and extra allowed dirs correctly.
- Streamed `text_delta` appears as assistant message content.
- `thinking_delta`, `tool_use`, `stderr`, `usage`, and `error` are rendered in the new message model.
- Cancel still calls the cancel endpoint and updates visible state.
- Diagnostics/raw events are reachable only through secondary UI.

## Acceptance Criteria

- The default page shows only the user-facing workbench.
- Agent responses are rendered as assistant content with readable structure.
- Debugging details are accessible but hidden by default.
- Run, streaming, and cancel remain fully functional.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.
