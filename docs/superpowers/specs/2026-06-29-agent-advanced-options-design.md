# Agent Advanced Options

## Context

The current Chat Workbench has an `Advanced` panel with a free-text `Reasoning` field. That field only affects Codex CLI because the Codex runtime maps it to `--reasoning`; Claude Code and OpenCode ignore it. This makes the UI misleading for non-Codex agents.

The server already supports local agent profiles from `agents.local.json` or `AGENT_NEXUS_AGENTS_CONFIG`, but the web UI does not expose that path or explain the manual configuration shape.

## Goals

- Show `Reasoning` only when the selected agent supports reasoning options.
- Render supported reasoning choices as a select control rather than free text.
- Do not send a stale reasoning value when switching to an agent that does not support reasoning.
- Add a discoverable manual configuration entry in `Details`.
- Keep this pass read-only for profile configuration; do not add a profile editor or file-writing API.

## API Shape

Extend the agents response with:

```ts
type AgentsResponse = {
  agents: DetectedAgent[];
  diagnostics: AgentDiagnostic[];
  config: {
    agentsConfigPath: string;
    agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG";
  };
};
```

Extend detected agents with `reasoningOptions?: RuntimeModelOption[]`; omit the field when the runtime does not support reasoning levels.

## UI Behavior

In `Advanced`:

- If the selected agent has `reasoningOptions`, show a `Reasoning` select with `Default` plus the supported options.
- If the selected agent has no `reasoningOptions`, hide `Reasoning`.
- When selecting an agent with no reasoning support, clear the stored reasoning value.

In `Details`:

- Add an `Agent config` section.
- Show the active config path.
- Show the override env var name: `AGENT_NEXUS_AGENTS_CONFIG`.
- Show a compact JSON example for adding a local profile.
- Keep `Refresh` as the way to reload after editing the file externally.

## Acceptance Criteria

- Codex shows `Reasoning` choices: Default, Low, Medium, High.
- Claude/OpenCode hide `Reasoning`.
- `/api/runs` receives `reasoning: null` for agents without reasoning support.
- Details exposes the active manual config path and example.
- Existing run, streaming, cancel behavior remains intact.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.
