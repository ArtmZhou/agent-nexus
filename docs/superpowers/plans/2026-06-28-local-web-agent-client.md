# Local Web Agent Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable local Web client and daemon that detects, launches, streams, cancels, and inspects local agent CLIs using the approved Open Design-inspired runtime model.

**Architecture:** A TypeScript monorepo with `shared` contracts, a Node daemon in `server`, and a Vite/React Web UI in `web`. Runtime adapters are declarative; the daemon owns local process access, run lifecycle, SSE, event logs, cancellation, and diagnostics; the UI is a dense local control console.

**Tech Stack:** TypeScript, pnpm workspaces, Node.js ESM, Express, Vitest, Vite, React, Testing Library, EventSource/SSE.

---

## Scope Check

The approved spec spans several subsystems. This plan keeps one end-state but decomposes implementation into testable milestones:

1. workspace and shared contracts
2. executable resolution and diagnostics
3. runtime registry, local profiles, and built-in adapters
4. detection service
5. run service, lifecycle, cancellation, and logs
6. stream parsers including ACP JSON-RPC
7. HTTP API
8. Web client
9. end-to-end fake-agent verification

The project is not complete until all acceptance criteria in the design spec are verified.

## File Structure

Create these top-level files:

- `package.json` - workspace scripts.
- `pnpm-workspace.yaml` - workspace package list.
- `tsconfig.base.json` - shared TypeScript settings.
- `.gitignore` - generated data, dependencies, and brainstorm scratch output.

Create `shared`:

- `shared/package.json`
- `shared/tsconfig.json`
- `shared/src/index.ts` - public exports.
- `shared/src/types.ts` - agent, run, model, diagnostic, and API contracts.
- `shared/src/sse.ts` - SSE event encoding helpers shared by server tests and API code.

Create `server`:

- `server/package.json`
- `server/tsconfig.json`
- `server/vitest.config.ts`
- `server/src/index.ts` - process entrypoint.
- `server/src/app.ts` - Express app factory.
- `server/src/config/paths.ts` - data/config path helpers.
- `server/src/runtimes/types.ts` - runtime-only adapter types.
- `server/src/runtimes/models.ts` - default model option and model sanitization.
- `server/src/runtimes/executables.ts` - PATH and `*_BIN` resolution.
- `server/src/runtimes/diagnostics.ts` - diagnostic builders.
- `server/src/runtimes/invocation.ts` - safe `execFile` wrapper for probes.
- `server/src/runtimes/launch.ts` - launch path and child PATH resolution.
- `server/src/runtimes/defs/*.ts` - built-in agent adapters.
- `server/src/runtimes/registry.ts` - built-in and local adapter registry.
- `server/src/runtimes/local-profiles.ts` - profile file parsing and inheritance.
- `server/src/runtimes/detection.ts` - concurrent agent probing.
- `server/src/runtimes/parsers/json-event-stream.ts` - Codex/OpenCode/Gemini/Cursor parser.
- `server/src/runtimes/parsers/claude-stream.ts` - Claude stream-json parser.
- `server/src/runtimes/acp.ts` - ACP JSON-RPC session adapter.
- `server/src/runs/service.ts` - run store, events, SSE, waiters, logs.
- `server/src/runs/lifecycle.ts` - close classification and watchdog values.
- `server/src/runs/launcher.ts` - spawn, stream wiring, stdin, cancellation integration.
- `server/src/api/agents.ts` - `/api/agents`.
- `server/src/api/runs.ts` - `/api/runs` endpoints.
- `server/tests/**` - unit and integration tests.
- `server/tests/fixtures/fake-agent.js` - configurable fake agent CLI.

Create `web`:

- `web/package.json`
- `web/tsconfig.json`
- `web/vite.config.ts`
- `web/index.html`
- `web/src/main.tsx`
- `web/src/App.tsx`
- `web/src/api.ts`
- `web/src/components/AgentList.tsx`
- `web/src/components/RunConsole.tsx`
- `web/src/components/RunInspector.tsx`
- `web/src/components/SettingsPanel.tsx`
- `web/src/styles.css`
- `web/src/__tests__/*.test.tsx`

## Task 1: Scaffold Workspace And Tooling

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/index.ts`
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`

- [ ] **Step 1: Create workspace package manifests**

Create root `package.json`:

```json
{
  "name": "agent-nexus",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.14.0",
  "scripts": {
    "dev": "pnpm --parallel --filter @agent-nexus/server --filter @agent-nexus/web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.8.0"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "shared"
  - "server"
  - "web"
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
data/
.superpowers/
.scratch/
*.log
```

- [ ] **Step 2: Create shared TypeScript config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Create package configs**

Create `shared/package.json`:

```json
{
  "name": "@agent-nexus/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "vitest": "^3.2.0"
  }
}
```

Create `server/package.json`:

```json
{
  "name": "@agent-nexus/server",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@agent-nexus/shared": "workspace:*",
    "cors": "^2.8.5",
    "express": "^5.1.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "tsx": "^4.20.0",
    "vitest": "^3.2.0"
  }
}
```

Create `web/package.json`:

```json
{
  "name": "@agent-nexus/web",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -p tsconfig.json && vite build",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@agent-nexus/shared": "workspace:*",
    "@vitejs/plugin-react": "^4.6.0",
    "vite": "^7.0.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.3.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "jsdom": "^26.1.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 4: Install dependencies**

Run: `pnpm install`

Expected: lockfile created and all workspace packages linked.

- [ ] **Step 5: Verify empty workspace builds**

Run: `pnpm typecheck`

Expected: TypeScript succeeds after the package configs are present.

- [ ] **Step 6: Commit scaffold**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore shared server web pnpm-lock.yaml
git commit -m "chore: scaffold local web client workspace"
```

## Task 2: Shared Contracts And SSE Helpers

**Files:**
- Create: `shared/src/types.ts`
- Create: `shared/src/sse.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/sse.test.ts`

- [ ] **Step 1: Write failing SSE helper tests**

Create `shared/src/sse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { encodeSseEvent } from "./sse.js";

describe("encodeSseEvent", () => {
  it("encodes id, event, and JSON data", () => {
    expect(encodeSseEvent(7, "agent", { type: "text_delta", delta: "hi" }))
      .toBe('id: 7\nevent: agent\ndata: {"type":"text_delta","delta":"hi"}\n\n');
  });

  it("splits multi-line payloads into multiple data lines", () => {
    expect(encodeSseEvent(2, "stderr", "a\nb"))
      .toBe("id: 2\nevent: stderr\ndata: a\ndata: b\n\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-nexus/shared test -- src/sse.test.ts`

Expected: FAIL because `shared/src/sse.ts` does not exist.

- [ ] **Step 3: Implement shared types and SSE helper**

Create `shared/src/types.ts`:

```ts
export type RuntimeModelOption = {
  id: string;
  label: string;
};

export type AgentDiagnostic = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  details?: Record<string, unknown>;
};

export type DetectedAgent = {
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

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
  thought_tokens?: number;
  cached_read_tokens?: number;
  cached_write_tokens?: number;
  total_tokens?: number;
};

export type RunEvent =
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

export type StoredRunEvent = {
  id: number;
  event: string;
  data: RunEvent;
  timestamp: number;
};

export type RunStatusBody = {
  id: string;
  agentId: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  cancelRequested: boolean;
  childPid: number | null;
  processGroupId: number | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  errorCode: string | null;
  eventsLogPath: string | null;
};

export type CreateRunRequest = {
  agentId: string;
  model?: string | null;
  reasoning?: string | null;
  cwd?: string | null;
  prompt: string;
  extraAllowedDirs?: string[];
};
```

Create `shared/src/sse.ts`:

```ts
export function encodeSseEvent(id: number, event: string, data: unknown): string {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  const lines = body.split(/\r?\n/u).map((line) => `data: ${line}`).join("\n");
  return `id: ${id}\nevent: ${event}\n${lines}\n\n`;
}
```

Create `shared/src/index.ts`:

```ts
export * from "./types.js";
export * from "./sse.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-nexus/shared test -- src/sse.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit shared contracts**

```bash
git add shared/src
git commit -m "feat: add shared agent and run contracts"
```

## Task 3: Executable Resolution And Diagnostics

**Files:**
- Create: `server/src/runtimes/executables.ts`
- Create: `server/src/runtimes/diagnostics.ts`
- Create: `server/src/runtimes/types.ts`
- Test: `server/tests/runtimes/executables.test.ts`

- [ ] **Step 1: Write failing executable resolution tests**

Create `server/tests/runtimes/executables.test.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentBinEnvKey, inspectAgentExecutableResolution, resolveOnPath } from "../../src/runtimes/executables.js";
import type { RuntimeAgentDef } from "../../src/runtimes/types.js";

function def(id: string, bin = id): RuntimeAgentDef {
  return {
    id,
    name: id,
    bin,
    versionArgs: ["--version"],
    fallbackModels: [{ id: "default", label: "Default" }],
    buildArgs: () => [],
    streamFormat: "plain",
  };
}

describe("agentBinEnvKey", () => {
  it("maps known agent ids to explicit binary env vars", () => {
    expect(agentBinEnvKey("codex")).toBe("CODEX_BIN");
    expect(agentBinEnvKey("cursor-agent")).toBe("CURSOR_AGENT_BIN");
  });
});

describe("resolveOnPath", () => {
  it("finds executables in supplied directories", () => {
    const root = join(process.cwd(), "tmp-exec-test");
    mkdirSync(root, { recursive: true });
    const bin = process.platform === "win32" ? "demo.cmd" : "demo";
    writeFileSync(join(root, bin), process.platform === "win32" ? "@echo off\n" : "#!/bin/sh\n");
    expect(resolveOnPath("demo", { pathDirs: [root], platform: process.platform })).toBe(join(root, bin));
  });
});

describe("inspectAgentExecutableResolution", () => {
  it("prefers configured absolute overrides over PATH", () => {
    const root = join(process.cwd(), "tmp-exec-override");
    mkdirSync(root, { recursive: true });
    const override = join(root, process.platform === "win32" ? "codex.cmd" : "codex");
    writeFileSync(override, process.platform === "win32" ? "@echo off\n" : "#!/bin/sh\n");
    const result = inspectAgentExecutableResolution(def("codex"), { CODEX_BIN: override }, { pathDirs: [] });
    expect(result.configuredOverridePath).toBe(override);
    expect(result.selectedPath).toBe(override);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-nexus/server test -- tests/runtimes/executables.test.ts`

Expected: FAIL because runtime files do not exist.

- [ ] **Step 3: Implement runtime types and executable resolution**

Create `server/src/runtimes/types.ts` with runtime-only types that import shared contracts:

```ts
import type { RuntimeModelOption } from "@agent-nexus/shared";

export type RuntimeBuildOptions = {
  model?: string | null;
  reasoning?: string | null;
};

export type RuntimeBuildContext = {
  prompt: string;
  imagePaths?: string[];
  extraAllowedDirs?: string[];
  options?: RuntimeBuildOptions;
  cwd?: string;
  hasPriorAssistantTurn?: boolean;
  resumeSessionId?: string | null;
  newSessionId?: string;
};

export type RuntimeListModels = {
  args: string[];
  timeoutMs?: number;
  parse(stdout: string): RuntimeModelOption[] | null;
};

export type RuntimeAuthProbe = {
  args: string[];
  timeoutMs?: number;
};

export type RuntimeAgentDef = {
  id: string;
  name: string;
  bin: string;
  fallbackBins?: string[];
  versionArgs: string[];
  fallbackModels: RuntimeModelOption[];
  listModels?: RuntimeListModels;
  authProbe?: RuntimeAuthProbe;
  reasoningOptions?: RuntimeModelOption[];
  buildArgs(context: RuntimeBuildContext): string[];
  promptViaStdin?: boolean;
  promptInputFormat?: "text" | "stream-json";
  streamFormat: "plain" | "json-lines" | "claude-stream-json" | "json-event-stream" | "acp-json-rpc";
  eventParser?: string;
  supportsImagePaths?: boolean;
  resumesSessionViaCli?: boolean;
  capturesSessionIdFromStream?: boolean;
  resumesSessionViaAcpLoad?: boolean;
  inactivityTimeoutMs?: number;
};
```

Create `server/src/runtimes/executables.ts`:

```ts
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";
import type { RuntimeAgentDef } from "./types.js";

const AGENT_BIN_ENV_KEYS = new Map<string, string>([
  ["codex", "CODEX_BIN"],
  ["claude", "CLAUDE_BIN"],
  ["opencode", "OPENCODE_BIN"],
  ["gemini", "GEMINI_BIN"],
  ["cursor-agent", "CURSOR_AGENT_BIN"],
]);

export type ResolveOptions = {
  env?: Record<string, string | undefined>;
  pathDirs?: string[];
  platform?: NodeJS.Platform;
};

export function agentBinEnvKey(agentId: string | undefined): string | null {
  return agentId ? AGENT_BIN_ENV_KEYS.get(agentId) ?? null : null;
}

export function defaultPathDirs(env: Record<string, string | undefined> = process.env): string[] {
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
  return pathValue.split(delimiter).filter(Boolean);
}

function executableExts(platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [""];
  return (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean);
}

function isExecutableFile(filePath: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(filePath).isFile()) return false;
    if (platform === "win32") return executableExts(platform).includes(extname(filePath).toUpperCase());
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function configuredOverride(def: RuntimeAgentDef, env: Record<string, string | undefined>, platform: NodeJS.Platform): string | null {
  const key = agentBinEnvKey(def.id);
  const raw = key ? env[key] : undefined;
  if (!raw || !isAbsolute(raw)) return null;
  return isExecutableFile(raw, platform) ? raw : null;
}

export function resolveOnPath(bin: string, options: ResolveOptions = {}): string | null {
  const platform = options.platform ?? process.platform;
  const dirs = options.pathDirs ?? defaultPathDirs(options.env);
  for (const dir of dirs) {
    for (const ext of executableExts(platform)) {
      const candidate = join(dir, bin + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function inspectAgentExecutableResolution(def: RuntimeAgentDef, configuredEnv: Record<string, string> = {}, options: ResolveOptions = {}) {
  const env = { ...process.env, ...configuredEnv };
  const platform = options.platform ?? process.platform;
  const configuredOverridePath = configuredOverride(def, env, platform);
  const bins = [def.bin, ...(def.fallbackBins ?? [])];
  const pathResolvedPath = bins.map((bin) => resolveOnPath(bin, { ...options, env })).find(Boolean) ?? null;
  return {
    configuredOverridePath,
    pathResolvedPath,
    selectedPath: configuredOverridePath || pathResolvedPath,
    searchedBins: bins,
    searchedDirs: options.pathDirs ?? defaultPathDirs(env),
    overrideEnvKey: agentBinEnvKey(def.id),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-nexus/server test -- tests/runtimes/executables.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit executable resolution**

```bash
git add server/src/runtimes server/tests/runtimes/executables.test.ts
git commit -m "feat: resolve local agent executables"
```

## Task 4: Built-In Adapter Registry And Local Profiles

**Files:**
- Create: `server/src/runtimes/models.ts`
- Create: `server/src/runtimes/defs/codex.ts`
- Create: `server/src/runtimes/defs/claude.ts`
- Create: `server/src/runtimes/defs/opencode.ts`
- Create: `server/src/runtimes/defs/gemini.ts`
- Create: `server/src/runtimes/defs/cursor-agent.ts`
- Create: `server/src/runtimes/registry.ts`
- Create: `server/src/runtimes/local-profiles.ts`
- Test: `server/tests/runtimes/registry.test.ts`
- Test: `server/tests/runtimes/agent-args.test.ts`

- [ ] **Step 1: Write failing registry and adapter tests**

Create `server/tests/runtimes/registry.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createAgentRegistry } from "../../src/runtimes/registry.js";

describe("createAgentRegistry", () => {
  it("contains required built-in agents", () => {
    const registry = createAgentRegistry();
    expect(registry.get("codex")?.name).toBe("Codex CLI");
    expect(registry.get("claude")?.name).toBe("Claude Code");
    expect(registry.get("opencode")?.name).toBe("OpenCode");
    expect(registry.get("gemini")?.name).toBe("Gemini CLI");
    expect(registry.get("cursor-agent")?.name).toBe("Cursor Agent");
  });

  it("loads local profiles by extending base agents", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-nexus-profiles-"));
    const file = join(dir, "agents.local.json");
    writeFileSync(file, JSON.stringify({ agents: [{ id: "work-codex", baseAgent: "codex", bin: "codex-work", args: ["--profile", "work"] }] }));
    const registry = createAgentRegistry({ localProfilesPath: file });
    const agent = registry.get("work-codex");
    expect(agent?.bin).toBe("codex-work");
    expect(agent?.buildArgs({ prompt: "hi" }).slice(0, 2)).toEqual(["--profile", "work"]);
  });
});
```

Create `server/tests/runtimes/agent-args.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codexAgentDef } from "../../src/runtimes/defs/codex.js";
import { claudeAgentDef } from "../../src/runtimes/defs/claude.js";
import { opencodeAgentDef } from "../../src/runtimes/defs/opencode.js";

describe("agent buildArgs", () => {
  it("builds Codex exec JSON args with model", () => {
    expect(codexAgentDef.buildArgs({ prompt: "hi", options: { model: "gpt-5" }, cwd: "D:/repo" }))
      .toContain("--json");
    expect(codexAgentDef.buildArgs({ prompt: "hi", options: { model: "gpt-5" }, cwd: "D:/repo" }))
      .toContain("--model");
  });

  it("builds Claude stream-json args", () => {
    const args = claudeAgentDef.buildArgs({ prompt: "hi" });
    expect(args).toEqual(expect.arrayContaining(["-p", "--input-format", "stream-json", "--output-format", "stream-json"]));
  });

  it("builds OpenCode JSON run args", () => {
    expect(opencodeAgentDef.buildArgs({ prompt: "hi", options: { model: "anthropic/claude-sonnet-4-5" } }))
      .toEqual(["run", "--format", "json", "-m", "anthropic/claude-sonnet-4-5"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agent-nexus/server test -- tests/runtimes/registry.test.ts tests/runtimes/agent-args.test.ts`

Expected: FAIL because registry and definitions do not exist.

- [ ] **Step 3: Implement model helpers and built-in adapters**

Create `server/src/runtimes/models.ts`:

```ts
import type { RuntimeModelOption } from "@agent-nexus/shared";

export const DEFAULT_MODEL_OPTION: RuntimeModelOption = { id: "default", label: "Default" };

export function parseLineSeparatedModels(stdout: string): RuntimeModelOption[] | null {
  const seen = new Set<string>([DEFAULT_MODEL_OPTION.id]);
  const models = [DEFAULT_MODEL_OPTION];
  for (const line of stdout.split(/\r?\n/u)) {
    const id = line.trim();
    if (!id || id.startsWith("#") || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: id });
  }
  return models.length > 1 ? models : null;
}
```

Create adapter files with explicit args:

```ts
// server/src/runtimes/defs/opencode.ts
import { DEFAULT_MODEL_OPTION, parseLineSeparatedModels } from "../models.js";
import type { RuntimeAgentDef } from "../types.js";

export const opencodeAgentDef: RuntimeAgentDef = {
  id: "opencode",
  name: "OpenCode",
  bin: "opencode-cli",
  fallbackBins: ["opencode"],
  versionArgs: ["--version"],
  listModels: { args: ["models"], parse: parseLineSeparatedModels, timeoutMs: 15000 },
  fallbackModels: [DEFAULT_MODEL_OPTION, { id: "anthropic/claude-sonnet-4-5", label: "anthropic/claude-sonnet-4-5" }, { id: "openai/gpt-5", label: "openai/gpt-5" }],
  buildArgs: ({ options = {}, resumeSessionId }) => {
    const args = ["run", "--format", "json"];
    if (resumeSessionId) args.push("-s", resumeSessionId);
    if (options.model && options.model !== "default") args.push("-m", options.model);
    return args;
  },
  promptViaStdin: true,
  streamFormat: "json-event-stream",
  eventParser: "opencode",
  resumesSessionViaCli: true,
  capturesSessionIdFromStream: true,
};
```

Implement `codex.ts`, `claude.ts`, `gemini.ts`, and `cursor-agent.ts` with the same field names from the spec. Codex must use `["exec", "--json", "--skip-git-repo-check"]`, Claude must use `["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]`, Gemini and Cursor must declare `streamFormat: "json-event-stream"` with parser ids.

- [ ] **Step 4: Implement registry and local profiles**

Create `server/src/runtimes/registry.ts`:

```ts
import { claudeAgentDef } from "./defs/claude.js";
import { codexAgentDef } from "./defs/codex.js";
import { cursorAgentDef } from "./defs/cursor-agent.js";
import { geminiAgentDef } from "./defs/gemini.js";
import { opencodeAgentDef } from "./defs/opencode.js";
import { readLocalAgentProfileDefs } from "./local-profiles.js";
import type { RuntimeAgentDef } from "./types.js";

const BASE_AGENT_DEFS = [codexAgentDef, claudeAgentDef, opencodeAgentDef, geminiAgentDef, cursorAgentDef];

export function createAgentRegistry(options: { localProfilesPath?: string | null } = {}) {
  const defs = [...BASE_AGENT_DEFS, ...readLocalAgentProfileDefs(BASE_AGENT_DEFS, options.localProfilesPath)];
  const byId = new Map<string, RuntimeAgentDef>();
  for (const def of defs) {
    if (byId.has(def.id)) throw new Error(`Duplicate agent definition id: ${def.id}`);
    byId.set(def.id, def);
  }
  return {
    list: () => [...byId.values()],
    get: (id: string) => byId.get(id) ?? null,
  };
}
```

Create `server/src/runtimes/local-profiles.ts` to parse `{ agents: [...] }`, validate `id`, find `baseAgent`, override `name` and `bin`, prepend `args`, and inject `defaultModel` only when no model is selected.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @agent-nexus/server test -- tests/runtimes/registry.test.ts tests/runtimes/agent-args.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit registry and adapters**

```bash
git add server/src/runtimes server/tests/runtimes/registry.test.ts server/tests/runtimes/agent-args.test.ts
git commit -m "feat: add local agent runtime registry"
```

## Task 5: Detection Service

**Files:**
- Create: `server/src/runtimes/invocation.ts`
- Create: `server/src/runtimes/detection.ts`
- Modify: `server/src/runtimes/diagnostics.ts`
- Test: `server/tests/runtimes/detection.test.ts`

- [ ] **Step 1: Write failing detection tests with fake exec**

Create `server/tests/runtimes/detection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectAgents } from "../../src/runtimes/detection.js";
import type { RuntimeAgentDef } from "../../src/runtimes/types.js";

function agent(id: string): RuntimeAgentDef {
  return {
    id,
    name: id,
    bin: id,
    versionArgs: ["--version"],
    fallbackModels: [{ id: "default", label: "Default" }],
    buildArgs: () => [],
    streamFormat: "plain",
  };
}

describe("detectAgents", () => {
  it("marks missing agents unavailable with diagnostics", async () => {
    const result = await detectAgents([agent("missing")], {}, { pathDirs: [] });
    expect(result[0]?.available).toBe(false);
    expect(result[0]?.diagnostics?.[0]?.code).toBe("agent.not_on_path");
  });

  it("isolates adapter failures", async () => {
    const bad = { ...agent("bad"), listModels: { args: ["models"], parse: () => { throw new Error("bad parse"); } } };
    const result = await detectAgents([bad], {}, { pathDirs: ["."], execAgentFile: async () => ({ stdout: "1.0.0", stderr: "" }) });
    expect(result[0]?.available).toBe(true);
    expect(result[0]?.modelsSource).toBe("fallback");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-nexus/server test -- tests/runtimes/detection.test.ts`

Expected: FAIL because `detection.ts` does not exist.

- [ ] **Step 3: Implement detection**

Implement `detectAgents(defs, configuredEnvByAgent, options)` so it:

- resolves executable with `inspectAgentExecutableResolution`
- returns unavailable diagnostics when no selected path exists
- probes version with `execAgentFile(resolved, versionArgs)`
- probes models with `listModels` when present
- falls back to `fallbackModels` on model errors
- probes auth when `authProbe` is present
- catches every adapter failure and returns an unavailable agent for that adapter only

Use this public function signature:

```ts
export async function detectAgents(
  defs: RuntimeAgentDef[],
  configuredEnvByAgent: Record<string, Record<string, string>> = {},
  options: DetectionOptions = {},
): Promise<DetectedAgent[]>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-nexus/server test -- tests/runtimes/detection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit detection**

```bash
git add server/src/runtimes server/tests/runtimes/detection.test.ts
git commit -m "feat: detect installed local agents"
```

## Task 6: Run Service With History, SSE, Logs, And Cancellation Core

**Files:**
- Create: `server/src/runs/service.ts`
- Test: `server/tests/runs/service.test.ts`

- [ ] **Step 1: Write failing run service tests**

Create `server/tests/runs/service.test.ts`:

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createRunService } from "../../src/runs/service.js";

describe("createRunService", () => {
  it("stores events and writes JSONL logs", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-nexus-runs-"));
    const runs = createRunService({ runsLogDir: dir });
    const run = runs.create({ agentId: "codex" });
    runs.emit(run, "agent", { type: "text_delta", delta: "hi" });
    const body = runs.statusBody(run);
    expect(body.eventsLogPath).toContain(run.id);
    expect(readFileSync(body.eventsLogPath!, "utf8")).toContain('"text_delta"');
  });

  it("replays events after a cursor", () => {
    const runs = createRunService();
    const run = runs.create({ agentId: "codex" });
    runs.emit(run, "agent", { type: "status", label: "running" });
    runs.emit(run, "agent", { type: "text_delta", delta: "hi" });
    expect(runs.eventsAfter(run, 1).map((event) => event.id)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-nexus/server test -- tests/runs/service.test.ts`

Expected: FAIL because `service.ts` does not exist.

- [ ] **Step 3: Implement run service**

Create `createRunService` with:

- `create(meta)`
- `get(id)`
- `list({ status })`
- `emit(run, event, data)`
- `eventsAfter(run, after)`
- `finish(run, status, code, signal)`
- `fail(run, code, message)`
- `cancel(run)`
- `shutdownActive()`
- `statusBody(run)`

Persist each event as one JSON object per line when `runsLogDir` is set.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-nexus/server test -- tests/runs/service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit run service**

```bash
git add server/src/runs/service.ts server/tests/runs/service.test.ts
git commit -m "feat: add run event service"
```

## Task 7: Lifecycle Classification And Watchdogs

**Files:**
- Create: `server/src/runs/lifecycle.ts`
- Test: `server/tests/runs/lifecycle.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Create `server/tests/runs/lifecycle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyRunCloseStatus, resolveActiveInactivityTimeoutMs } from "../../src/runs/lifecycle.js";

describe("classifyRunCloseStatus", () => {
  it("treats cancellation as canceled", () => {
    expect(classifyRunCloseStatus({ cancelRequested: true, code: 0, signal: null, acpCleanCompletion: false, artifactQuietShutdownRequested: false, turnCompletedCleanly: false, artifactProducedThisRun: false })).toBe("canceled");
  });

  it("treats ACP clean SIGTERM as success", () => {
    expect(classifyRunCloseStatus({ cancelRequested: false, code: null, signal: "SIGTERM", acpCleanCompletion: true, artifactQuietShutdownRequested: false, turnCompletedCleanly: false, artifactProducedThisRun: false })).toBe("succeeded");
  });
});

describe("resolveActiveInactivityTimeoutMs", () => {
  it("uses artifact quiet period after artifact registration", () => {
    expect(resolveActiveInactivityTimeoutMs({ inactivityTimeoutMs: 600000, artifactQuietPeriodMs: 60000, artifactRegistered: true })).toBe(60000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-nexus/server test -- tests/runs/lifecycle.test.ts`

Expected: FAIL because `lifecycle.ts` does not exist.

- [ ] **Step 3: Implement lifecycle helpers**

Create `server/src/runs/lifecycle.ts` with functions:

- `resolveChatRunInactivityTimeoutMs`
- `resolveChatRunArtifactQuietPeriodMs`
- `resolveChatRunShutdownGraceMs`
- `resolveAcpStageTimeoutMs`
- `resolveActiveInactivityTimeoutMs`
- `classifyRunCloseStatus`

Use `AGENT_NEXUS_*` environment variable names from the spec and defaults from the design.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agent-nexus/server test -- tests/runs/lifecycle.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit lifecycle helpers**

```bash
git add server/src/runs/lifecycle.ts server/tests/runs/lifecycle.test.ts
git commit -m "feat: classify agent run lifecycles"
```

## Task 8: Stream Parsers

**Files:**
- Create: `server/src/runtimes/parsers/json-event-stream.ts`
- Create: `server/src/runtimes/parsers/claude-stream.ts`
- Test: `server/tests/runtimes/json-event-stream.test.ts`
- Test: `server/tests/runtimes/claude-stream.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `server/tests/runtimes/json-event-stream.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createJsonEventStreamHandler } from "../../src/runtimes/parsers/json-event-stream.js";

describe("createJsonEventStreamHandler", () => {
  it("parses Codex agent messages and usage", () => {
    const events: unknown[] = [];
    const parser = createJsonEventStreamHandler("codex", (event) => events.push(event));
    parser.feed(JSON.stringify({ type: "thread.started", thread_id: "abc" }) + "\n");
    parser.feed(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } }) + "\n");
    parser.feed(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2 } }) + "\n");
    expect(events).toEqual([
      { type: "status", label: "initializing", sessionId: "abc" },
      { type: "text_delta", delta: "hello" },
      { type: "usage", usage: { input_tokens: 1, output_tokens: 2 } },
    ]);
  });

  it("parses OpenCode text and session id", () => {
    const events: unknown[] = [];
    const parser = createJsonEventStreamHandler("opencode", (event) => events.push(event));
    parser.feed(JSON.stringify({ type: "step_start", sessionID: "ses_1" }) + "\n");
    parser.feed(JSON.stringify({ type: "text", part: { text: "hi" } }) + "\n");
    expect(events).toEqual([
      { type: "status", label: "running", sessionId: "ses_1" },
      { type: "text_delta", delta: "hi" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agent-nexus/server test -- tests/runtimes/json-event-stream.test.ts`

Expected: FAIL because parser files do not exist.

- [ ] **Step 3: Implement JSON event stream parser**

Implement `createJsonEventStreamHandler(kind, onEvent)` with:

- line buffering
- safe JSON parse
- `raw` diagnostic event for malformed lines
- Codex handlers for `thread.started`, `turn.started`, `item.completed`, `turn.completed`, `turn.failed`, and `error`
- OpenCode handlers for `step_start`, `text`, `tool_use`, `step_finish`, and `error`
- Gemini handlers for `init`, assistant `message`, `tool_use`, `tool_result`, `error`, and `result`
- Cursor handlers for assistant text and usage

- [ ] **Step 4: Add Claude stream-json tests and parser**

Create `server/tests/runtimes/claude-stream.test.ts` with one test for assistant text, one for usage, and one for clean terminal turn. Implement `createClaudeStreamHandler(onEvent)` and `applyClaudeStreamJsonRunBookkeeping(run, event)`.

- [ ] **Step 5: Run parser tests to verify they pass**

Run: `pnpm --filter @agent-nexus/server test -- tests/runtimes/json-event-stream.test.ts tests/runtimes/claude-stream.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit stream parsers**

```bash
git add server/src/runtimes/parsers server/tests/runtimes/json-event-stream.test.ts server/tests/runtimes/claude-stream.test.ts
git commit -m "feat: parse local agent streams"
```

## Task 9: ACP JSON-RPC Session Adapter

**Files:**
- Create: `server/src/runtimes/acp.ts`
- Test: `server/tests/runtimes/acp.test.ts`

- [ ] **Step 1: Write failing ACP tests**

Create `server/tests/runtimes/acp.test.ts`:

```ts
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildAcpSessionNewParams, createJsonLineStream } from "../../src/runtimes/acp.js";

describe("buildAcpSessionNewParams", () => {
  it("normalizes cwd and MCP server env arrays", () => {
    const params = buildAcpSessionNewParams(".", { mcpServers: [{ type: "stdio", name: "demo", command: "node", args: ["x.js"], env: [{ name: "A", value: "B" }] }] });
    expect(params.cwd).toContain(process.cwd());
    expect(params.mcpServers[0]?.env).toEqual([{ name: "A", value: "B" }]);
  });
});

describe("createJsonLineStream", () => {
  it("parses JSON lines split across chunks", () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((message) => messages.push(message));
    stream.feed('{"a":');
    stream.feed('1}\n');
    expect(messages).toEqual([{ a: 1 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agent-nexus/server test -- tests/runtimes/acp.test.ts`

Expected: FAIL because `acp.ts` does not exist.

- [ ] **Step 3: Implement ACP helpers and session attach**

Create `server/src/runtimes/acp.ts` with:

- `buildAcpSessionNewParams`
- `createJsonLineStream`
- `attachAcpSession`
- initialize handshake
- `session/new` and `session/load`
- optional model set request
- `session/prompt`
- `session/update` parsing for text, thinking, tool calls, and usage
- `session/request_permission` safe auto-selection
- `abort()`
- `completedSuccessfully()`
- `getDurableSessionId()`

- [ ] **Step 4: Run ACP tests**

Run: `pnpm --filter @agent-nexus/server test -- tests/runtimes/acp.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit ACP adapter**

```bash
git add server/src/runtimes/acp.ts server/tests/runtimes/acp.test.ts
git commit -m "feat: support ACP agent sessions"
```

## Task 10: Run Launcher Integration

**Files:**
- Create: `server/src/runtimes/invocation.ts`
- Create: `server/src/runtimes/launch.ts`
- Create: `server/src/runs/launcher.ts`
- Create: `server/tests/fixtures/fake-agent.js`
- Test: `server/tests/runs/launcher.test.ts`

- [ ] **Step 1: Write failing launcher tests**

Create `server/tests/fixtures/fake-agent.js`:

```js
#!/usr/bin/env node
const mode = process.argv[2];
if (mode === "--version") {
  console.log("fake-agent 1.0.0");
  process.exit(0);
}
if (mode === "json") {
  process.stdin.resume();
  process.stdin.on("data", () => {});
  process.stdin.on("end", () => {
    console.log(JSON.stringify({ type: "thread.started", thread_id: "fake-thread" }));
    console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "fake hello" } }));
    console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2 } }));
  });
}
```

Create `server/tests/runs/launcher.test.ts`:

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRunService } from "../../src/runs/service.js";
import { startAgentRun } from "../../src/runs/launcher.js";
import type { RuntimeAgentDef } from "../../src/runtimes/types.js";

describe("startAgentRun", () => {
  it("spawns an agent and streams normalized events", async () => {
    const runs = createRunService();
    const run = runs.create({ agentId: "fake" });
    const def: RuntimeAgentDef = {
      id: "fake",
      name: "Fake",
      bin: process.execPath,
      versionArgs: ["--version"],
      fallbackModels: [{ id: "default", label: "Default" }],
      buildArgs: () => [join(process.cwd(), "tests/fixtures/fake-agent.js"), "json"],
      promptViaStdin: true,
      streamFormat: "json-event-stream",
      eventParser: "codex",
    };
    await startAgentRun({ run, def, prompt: "hello", cwd: process.cwd(), runs });
    await runs.wait(run);
    expect(run.status).toBe("succeeded");
    expect(run.events.some((event) => JSON.stringify(event.data).includes("fake hello"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-nexus/server test -- tests/runs/launcher.test.ts`

Expected: FAIL because `launcher.ts` does not exist.

- [ ] **Step 3: Implement invocation, launch, and launcher**

Implement:

- `execAgentFile` with temp cwd default
- `resolveAgentLaunch`
- `applyAgentLaunchEnv`
- `startAgentRun`

`startAgentRun` must:

- set run status to `running`
- spawn with patched env
- wire stdout to correct parser
- wire stderr to `stderr` events
- write prompt to stdin when configured
- attach ACP session for `acp-json-rpc`
- classify close status with lifecycle helpers
- finish the run exactly once

- [ ] **Step 4: Run launcher test**

Run: `pnpm --filter @agent-nexus/server test -- tests/runs/launcher.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit launcher**

```bash
git add server/src/runtimes/invocation.ts server/src/runtimes/launch.ts server/src/runs/launcher.ts server/tests/fixtures/fake-agent.js server/tests/runs/launcher.test.ts
git commit -m "feat: launch and stream local agent runs"
```

## Task 11: HTTP API

**Files:**
- Create: `server/src/app.ts`
- Create: `server/src/index.ts`
- Create: `server/src/api/agents.ts`
- Create: `server/src/api/runs.ts`
- Create: `server/src/config/paths.ts`
- Test: `server/tests/api.test.ts`

- [ ] **Step 1: Write failing API tests**

Create `server/tests/api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("HTTP API", () => {
  it("returns detected agents", async () => {
    const app = createApp();
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/api/agents`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.agents)).toBe(true);
    } finally {
      server.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-nexus/server test -- tests/api.test.ts`

Expected: FAIL because `app.ts` does not exist.

- [ ] **Step 3: Implement API routes**

Implement:

- `GET /api/agents`
- `GET /api/runs`
- `GET /api/runs/:id`
- `GET /api/runs/:id/events`
- `POST /api/runs`
- `POST /api/runs/:id/cancel`
- `POST /api/runs/shutdown-active`

SSE route must set:

```ts
res.setHeader("Content-Type", "text/event-stream");
res.setHeader("Cache-Control", "no-cache");
res.setHeader("Connection", "keep-alive");
```

- [ ] **Step 4: Run API tests**

Run: `pnpm --filter @agent-nexus/server test -- tests/api.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit API**

```bash
git add server/src/app.ts server/src/index.ts server/src/api server/src/config server/tests/api.test.ts
git commit -m "feat: expose local agent HTTP API"
```

## Task 12: Web Client

**Files:**
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/api.ts`
- Create: `web/src/components/AgentList.tsx`
- Create: `web/src/components/RunConsole.tsx`
- Create: `web/src/components/RunInspector.tsx`
- Create: `web/src/components/SettingsPanel.tsx`
- Create: `web/src/styles.css`
- Test: `web/src/__tests__/App.test.tsx`

- [ ] **Step 1: Write failing UI test**

Create `web/src/__tests__/App.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../App.js";

describe("App", () => {
  it("renders the local agent console shell", () => {
    render(<App />);
    expect(screen.getByText("Agent Nexus")).toBeInTheDocument();
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText("Run Inspector")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agent-nexus/web test -- src/__tests__/App.test.tsx`

Expected: FAIL because `App.tsx` does not exist.

- [ ] **Step 3: Implement UI shell and API client**

Create components that render:

- left agent list with refresh button
- center prompt form with agent/model/reasoning/cwd controls
- streaming event output
- cancel button
- right run inspector with raw event JSON
- settings panel with config path examples

`web/src/api.ts` must expose:

```ts
export async function fetchAgents(): Promise<DetectedAgent[]>;
export async function createRun(input: CreateRunRequest): Promise<RunStatusBody>;
export async function cancelRun(runId: string): Promise<RunStatusBody>;
export function subscribeRunEvents(runId: string, onEvent: (event: RunEvent) => void): EventSource;
```

- [ ] **Step 4: Run UI tests**

Run: `pnpm --filter @agent-nexus/web test -- src/__tests__/App.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit UI**

```bash
git add web
git commit -m "feat: add local web agent console"
```

## Task 13: End-To-End Verification

**Files:**
- Modify: `server/tests/fixtures/fake-agent.js`
- Create: `server/tests/e2e-local-agent.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write e2e test for fake agent run**

Create `server/tests/e2e-local-agent.test.ts` that:

- starts the app on a random port
- creates a run using a fake agent registry
- subscribes to SSE
- verifies `text_delta`
- cancels a long-running fake run
- verifies terminal `canceled`

- [ ] **Step 2: Run e2e test to verify it fails**

Run: `pnpm --filter @agent-nexus/server test -- tests/e2e-local-agent.test.ts`

Expected: FAIL until API injection for test registry is wired.

- [ ] **Step 3: Wire test dependency injection**

Modify `createApp` to accept:

```ts
type AppServices = {
  registry?: ReturnType<typeof createAgentRegistry>;
  runs?: ReturnType<typeof createRunService>;
};
```

Use defaults in production and injected fake services in tests.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected: all commands PASS.

- [ ] **Step 5: Start dev servers**

Run: `pnpm dev`

Expected:

- server prints local API URL
- web prints Vite local URL
- browser UI can refresh agents and create a fake-agent run in test mode

- [ ] **Step 6: Commit verification and docs**

```bash
git add server/tests/e2e-local-agent.test.ts server/tests/fixtures/fake-agent.js README.md
git commit -m "test: verify local agent run flow"
```

## Self-Review Notes

Spec coverage:

- Workspace and local Web app: Tasks 1, 11, 12, 13.
- Runtime adapter model: Tasks 2, 4.
- Detection and diagnostics: Tasks 3, 5.
- Built-in agents: Task 4.
- Run service, SSE, JSONL logs: Task 6.
- Lifecycle, watchdogs, cancellation: Tasks 6, 7, 10.
- Stream parsers and ACP: Tasks 8, 9.
- API: Task 11.
- UI: Task 12.
- E2E verification: Task 13.

Implementation must not mark the goal complete until every acceptance criterion in the design spec is proven by current files, passing commands, and runtime behavior.
