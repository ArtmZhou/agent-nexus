# Agent Nexus

Local web client for running installed agent CLIs through one Open Design-style flow: detect agents, start a run, stream events, inspect status, and cancel active work.

## Install

```sh
pnpm install
```

## Run Locally

Start the backend API and web client together:

```sh
pnpm dev
```

Defaults:

- API: `http://127.0.0.1:4173`
- Web: `http://127.0.0.1:5173`

Useful backend environment variables:

- `AGENT_NEXUS_HOST`: API host, default `127.0.0.1`
- `AGENT_NEXUS_PORT`: API port, default `4173`
- `AGENT_NEXUS_HOME`: data directory, default `~/.agent-nexus`
- `AGENT_NEXUS_AGENTS_CONFIG`: local profile config path
- `AGENT_NEXUS_RUNS_LOG_DIR`: JSONL run event log directory

## Local Profiles

Built-in agent definitions cover Codex, Claude, OpenCode, Gemini, and Cursor Agent. Add local profiles when you want a custom executable, default model, environment, or argument prefix.

By default profiles load from `~/.agent-nexus/agents.local.json`:

```json
{
  "agents": [
    {
      "id": "codex-work",
      "name": "Codex Work",
      "baseAgent": "codex",
      "bin": "codex",
      "args": ["--sandbox", "workspace-write"],
      "defaultModel": "gpt-5",
      "env": {
        "OPENAI_API_KEY": "..."
      }
    }
  ]
}
```

Profiles inherit the base agent runtime behavior. `args` are prepended to the base launch args, `bin` overrides the executable, `defaultModel` marks the preferred fallback model, and `env` is merged into the launched process environment.

## Run, Streaming, Cancel

The web client uses the same backend endpoints directly:

- `GET /api/agents`: list detected agents and diagnostics.
- `POST /api/runs`: create and launch a run.
- `GET /api/runs/:id/events`: Server-Sent Events stream with normalized run events.
- `POST /api/runs/:id/cancel`: cancel the active process and emit a terminal `canceled` event.
- `GET /api/runs/:id`: inspect current run status.

Minimal run request:

```json
{
  "agentId": "codex",
  "prompt": "Summarize this workspace"
}
```

The event stream normalizes text, thinking, tool, usage, stderr, diagnostics, errors, and terminal status so the UI can render different agent CLIs through one console.

## Verify

```sh
pnpm --filter @agent-nexus/server test -- tests/e2e-local-agent.test.ts
pnpm --filter @agent-nexus/server typecheck
```

The e2e test uses a local fake agent fixture through `process.execPath`, so it does not depend on real agent CLIs being installed.
