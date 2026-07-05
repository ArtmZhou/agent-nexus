import { Router } from "express";
import { encodeSseEvent, type CreateRunRequest, type RunStatus, type RunStatusBody, type StoredRunEvent } from "@agent-nexus/shared";
import type { AgentRunHandle, startAgentRun } from "../runs/launcher.js";
import type { RunService } from "../runs/service.js";
import type { AgentRegistry } from "../runtimes/registry.js";

export type StartRun = typeof startAgentRun;

export type RunsRouterServices = {
  registry: AgentRegistry;
  runs: RunService;
  startRun: StartRun;
  activeHandles: Map<string, AgentRunHandle>;
};

const runStatuses = new Set<RunStatus>(["queued", "running", "succeeded", "failed", "canceled"]);

export function createRunsRouter(services: RunsRouterServices): Router {
  const router = Router();

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

  router.post("/shutdown-active", async (_request, response, next) => {
    try {
      const activeRuns = services.runs.list({ active: true });
      const canceled = await Promise.all(activeRuns.map((run) => cancelRun(services, run.id, "Run canceled during shutdown")));
      response.json({ runs: canceled });
    } catch (error) {
      next(error);
    }
  });

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
      try {
        response.write(encodeStoredSseEvent(event));
      } catch {
        close();
        return;
      }

      if (isTerminalEvent(event)) {
        close();
      }
    }

    function close(): void {
      if (closed) return;
      closed = true;
      unsubscribe();
      response.end();
    }
  });

  router.get("/:id", (request, response) => {
    const run = services.runs.statusBody(request.params.id);
    if (!run) {
      response.status(404).json({ error: "Run not found" });
      return;
    }

    response.json(run);
  });

  router.post("/", async (request, response, next) => {
    try {
      const parsed = parseCreateRunRequest(request.body);
      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error });
        return;
      }

      const def = services.registry.get(parsed.request.agentId);
      if (!def) {
        response.status(404).json({ error: "Agent not found" });
        return;
      }

      const resumeSessionId = parsed.request.resumeSessionId ?? reusableSessionId(services, def, parsed.request);
      const requestWithSession: CreateRunRequest = {
        ...parsed.request,
        resumeSessionId
      };
      const created = services.runs.create(requestWithSession);
      const handle = services.startRun({
        runs: services.runs,
        runId: created.id,
        request: requestWithSession,
        def,
        resumeSessionId
      });
      services.activeHandles.set(created.id, handle);
      void handle.done.finally(() => {
        if (services.activeHandles.get(created.id) === handle) {
          services.activeHandles.delete(created.id);
        }
      });

      response.status(201).json(services.runs.statusBody(created.id) ?? created);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/cancel", async (request, response, next) => {
    try {
      const run = services.runs.statusBody(request.params.id);
      if (!run) {
        response.status(404).json({ error: "Run not found" });
        return;
      }

      if (!services.runs.hasInMemoryRun(run.id)) {
        response.status(409).json({ error: "Restored runs cannot be canceled" });
        return;
      }

      response.json(await cancelRun(services, run.id));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function cancelRun(services: RunsRouterServices, runId: string, message = "Run canceled"): Promise<RunStatusBody> {
  const handle = services.activeHandles.get(runId);
  if (handle) {
    const body = await handle.cancel(message);
    services.activeHandles.delete(runId);
    return body;
  }

  return services.runs.cancel(runId, {
    message,
    code: "user.cancel",
    signal: "SIGTERM"
  });
}

function parseCreateRunRequest(input: unknown): { ok: true; request: CreateRunRequest } | { ok: false; error: string } {
  if (!isObject(input)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  if (typeof input.agentId !== "string" || input.agentId.trim() === "") {
    return { ok: false, error: "agentId is required" };
  }

  if (typeof input.prompt !== "string" || input.prompt.trim() === "") {
    return { ok: false, error: "prompt is required" };
  }

  if (input.model !== undefined && input.model !== null && typeof input.model !== "string") {
    return { ok: false, error: "model must be a string or null" };
  }

  if (input.reasoning !== undefined && input.reasoning !== null && typeof input.reasoning !== "string") {
    return { ok: false, error: "reasoning must be a string or null" };
  }

  if (input.cwd !== undefined && input.cwd !== null && typeof input.cwd !== "string") {
    return { ok: false, error: "cwd must be a string or null" };
  }

  if (input.extraAllowedDirs !== undefined && !isStringArray(input.extraAllowedDirs)) {
    return { ok: false, error: "extraAllowedDirs must be an array of strings" };
  }

  if (input.resumeSessionId !== undefined && input.resumeSessionId !== null && typeof input.resumeSessionId !== "string") {
    return { ok: false, error: "resumeSessionId must be a string or null" };
  }

  return {
    ok: true,
    request: {
      agentId: input.agentId,
      resumeSessionId: input.resumeSessionId as string | null | undefined,
      prompt: input.prompt,
      model: input.model as string | null | undefined,
      reasoning: input.reasoning as string | null | undefined,
      cwd: input.cwd as string | null | undefined,
      extraAllowedDirs: input.extraAllowedDirs as string[] | undefined
    }
  };
}

function reusableSessionId(services: RunsRouterServices, def: ReturnType<AgentRegistry["get"]>, request: CreateRunRequest): string | null {
  if (!def || (!def.resumesSessionViaCli && !def.resumesSessionViaAcpLoad && !def.capturesSessionIdFromStream)) {
    return null;
  }

  return services.runs.findLatestSessionId({
    agentId: request.agentId,
    cwd: request.cwd ?? null
  });
}

function parseStatusFilter(input: unknown): RunStatus | "active" | "invalid" | null {
  if (input === undefined) return null;
  if (input === "active") return "active";
  return typeof input === "string" && runStatuses.has(input as RunStatus) ? input as RunStatus : "invalid";
}

function parseEventCursor(after: unknown, lastEventId: string | undefined): number | null {
  const raw = lastEventId ?? after ?? "0";
  if (Array.isArray(raw) || typeof raw !== "string") return null;
  if (!/^\d+$/u.test(raw)) return null;
  return Number(raw);
}

function isTerminalEvent(event: StoredRunEvent): boolean {
  return event.event === "end" && event.data.type === "end";
}

function encodeStoredSseEvent(event: StoredRunEvent): string {
  return encodeSseEvent(event.id, event.event, event.data).replace(
    `event: ${event.event}\n`,
    `event: ${event.event}\ntimestamp: ${event.timestamp}\n`
  );
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isStringArray(input: unknown): input is string[] {
  return Array.isArray(input) && input.every((item) => typeof item === "string");
}
