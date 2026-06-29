import type { AgentDiagnostic, CreateRunRequest, DetectedAgent, RunEvent, RunStatusBody, StoredRunEvent } from "@agent-nexus/shared";

export type AgentsConfig = {
  agentsConfigPath: string;
  agentsConfigEnvKey: "AGENT_NEXUS_AGENTS_CONFIG";
};

export type AgentsResponse = {
  agents: DetectedAgent[];
  diagnostics: AgentDiagnostic[];
  config: AgentsConfig;
};

export type RunEventSubscription = {
  close: () => void;
};

const runEventTypes: RunEvent["type"][] = [
  "status",
  "text_delta",
  "thinking_start",
  "thinking_delta",
  "tool_use",
  "tool_result",
  "usage",
  "diagnostic",
  "stderr",
  "error",
  "end"
];

export async function fetchAgents(): Promise<AgentsResponse> {
  return requestJson<AgentsResponse>("/api/agents");
}

export async function createRun(request: CreateRunRequest): Promise<RunStatusBody> {
  return requestJson<RunStatusBody>("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
}

export async function cancelRun(runId: string): Promise<RunStatusBody> {
  return requestJson<RunStatusBody>(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST"
  });
}

export async function fetchRun(runId: string): Promise<RunStatusBody> {
  return requestJson<RunStatusBody>(`/api/runs/${encodeURIComponent(runId)}`);
}

export function subscribeRunEvents(
  runId: string,
  onEvent: (event: StoredRunEvent) => void,
  onError?: (error: Event) => void,
  after?: number
): RunEventSubscription {
  const query = after && after > 0 ? `?after=${after}` : "";
  const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events${query}`);
  let latestId = after ?? 0;

  for (const eventType of runEventTypes) {
    source.addEventListener(eventType, (message) => {
      const id = Number.parseInt((message as MessageEvent).lastEventId || "0", 10);
      if (Number.isFinite(id) && id > 0) latestId = id;

      const data = parseRunEvent((message as MessageEvent).data);
      onEvent({
        id: Number.isFinite(id) && id > 0 ? id : latestId,
        event: eventType,
        data,
        timestamp: Date.now()
      });

      if (data.type === "end") {
        source.close();
      }
    });
  }

  source.onerror = (event) => {
    onError?.(event);
  };

  return {
    close: () => source.close()
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body.error === "string" ? body.error : `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

function parseRunEvent(data: string): RunEvent {
  try {
    return JSON.parse(data) as RunEvent;
  } catch {
    return {
      type: "error",
      message: "Unable to parse run event",
      details: data
    };
  }
}
