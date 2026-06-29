import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { createAgentsRouter, type DetectAgents } from "./api/agents.js";
import { createRunsRouter, type StartRun } from "./api/runs.js";
import { resolveAgentNexusPaths, type AgentNexusPaths } from "./config/paths.js";
import { startAgentRun, type AgentRunHandle } from "./runs/launcher.js";
import { createRunService, type RunService } from "./runs/service.js";
import { detectLocalAgents } from "./runtimes/detection.js";
import { loadAgentRegistry, type AgentRegistry } from "./runtimes/registry.js";

export type CreateAppOptions = {
  paths?: AgentNexusPaths;
  runsLogDir?: string;
  registry?: AgentRegistry;
  runs?: RunService;
  detectAgents?: DetectAgents;
  startRun?: StartRun;
  activeHandles?: Map<string, AgentRunHandle>;
};

export function createApp(options: CreateAppOptions = {}): Express {
  const paths = options.paths ?? resolveAgentNexusPaths();
  const registry = options.registry ?? loadAgentRegistry({ configPath: paths.agentsConfigPath });
  const runs = options.runs ?? createRunService({ runsLogDir: options.runsLogDir ?? paths.runsLogDir });
  const detectAgents = options.detectAgents ?? detectLocalAgents;
  const startRun = options.startRun ?? startAgentRun;
  const activeHandles = options.activeHandles ?? new Map<string, AgentRunHandle>();

  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true });
  });

  app.use("/api/agents", createAgentsRouter({ registry, detectAgents, agentsConfigPath: paths.agentsConfigPath }));
  app.use("/api/runs", createRunsRouter({ registry, runs, startRun, activeHandles }));
  app.use(errorHandler);

  return app;
}

function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction): void {
  const message = error instanceof Error ? error.message : String(error);
  response.status(500).json({ error: message });
}
