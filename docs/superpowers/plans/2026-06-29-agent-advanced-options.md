# Agent Advanced Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Advanced options agent-aware and expose the local manual agent config path in Details.

**Architecture:** Extend shared/API agent metadata with `reasoningOptions` and config information, then render those fields in the existing Chat Workbench. Keep profile configuration read-only in this pass; users still edit the JSON file externally and click Refresh.

**Tech Stack:** TypeScript, Express, React 19, Vitest, Testing Library.

---

## File Structure

- Modify `shared/src/types.ts`: add `reasoningOptions` to `DetectedAgent`.
- Modify `server/src/runtimes/registry.ts`: include `reasoningOptions` in registered agent detection output.
- Modify `server/src/runtimes/detection.ts`: include `reasoningOptions` in live detected agent output.
- Modify `server/src/api/agents.ts`: add config metadata to `/api/agents`.
- Modify `server/tests/api.test.ts`: assert config metadata and reasoning options.
- Modify `web/src/api.ts`: add `config` to `AgentsResponse`.
- Modify `web/src/App.tsx`: store agent config metadata and clear unsupported reasoning on agent switch/run.
- Modify `web/src/components/RunConsole.tsx`: show Reasoning select only when selected agent supports it.
- Modify `web/src/components/RunInspector.tsx`: show Agent config path, env var, JSON profile example.
- Modify `web/src/__tests__/App.test.tsx`: assert Codex reasoning select, non-Codex hiding, null reasoning, and config details.

---

### Task 1: API Metadata

- [ ] Add `reasoningOptions?: RuntimeModelOption[]` to `DetectedAgent`.
- [ ] Copy runtime `reasoningOptions` into registered and live detected agents.
- [ ] Return `{ agentsConfigPath, agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG" }` from `/api/agents`.
- [ ] Update server API tests to expect the new response shape.

Run:

```bash
pnpm --filter @agent-nexus/server test -- tests/api.test.ts tests/runtimes/detection.test.ts tests/runtimes/registry.test.ts
pnpm --filter @agent-nexus/server typecheck
```

### Task 2: Web Behavior

- [ ] Store `/api/agents.config` in `App`.
- [ ] When selected agent has no `reasoningOptions`, clear `consoleState.reasoning`.
- [ ] Send `reasoning: null` when selected agent has no reasoning support.
- [ ] Render `Reasoning` as a select with `Default`, then runtime options.
- [ ] Hide `Reasoning` for agents with no options.
- [ ] Add `Agent config` section in Details with path, env key, and JSON example.

Run:

```bash
pnpm --filter @agent-nexus/web test -- src/__tests__/App.test.tsx
pnpm --filter @agent-nexus/web typecheck
```

### Task 3: Verification

- [ ] Run full checks.
- [ ] Inspect the running page in the browser: Codex shows Reasoning, Claude/OpenCode hide it, Details shows Agent config.
- [ ] Commit implementation.

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

---

## Self-Review

- Spec coverage: reasoning visibility, stale clearing, config metadata, Details section, and full validation are covered.
- Deferred-work scan: no profile editor is included; configuration remains read-only by design.
- Type consistency: `DetectedAgent.reasoningOptions` and `AgentsResponse.config` are the names used across shared, server, and web.
