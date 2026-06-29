import { Router } from "express";
import type { DetectedAgent } from "@agent-nexus/shared";
import type { AgentRegistry } from "../runtimes/registry.js";

export type DetectAgents = (registry: AgentRegistry) => Promise<DetectedAgent[]>;

export type AgentsRouterServices = {
  registry: AgentRegistry;
  detectAgents: DetectAgents;
  agentsConfigPath: string;
};

export function createAgentsRouter(services: AgentsRouterServices): Router {
  const router = Router();

  router.get("/", async (_request, response, next) => {
    try {
      const agents = await services.detectAgents(services.registry);
      response.json({
        agents,
        diagnostics: services.registry.diagnostics,
        config: {
          agentsConfigPath: services.agentsConfigPath,
          agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG"
        }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
