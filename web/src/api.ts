import type {
  AgentDiagnostic,
  CreateRunRequest,
  DetectedAgent,
  RunEvent,
  RunListResponse,
  RunStatusBody,
  StoredRunEvent
} from "@agent-nexus/shared";

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

export async function fetchRuns(): Promise<RunListResponse> {
  return requestJson<RunListResponse>("/api/runs");
}

export async function fetchRunEvents(runId: string, after?: number): Promise<StoredRunEvent[]> {
  const query = after && after > 0 ? `?after=${after}` : "";
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events${query}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body.error === "string" ? body.error : `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return parseSseEvents(await response.text());
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

      const parsed = parseStoredRunEventPayload((message as MessageEvent).data);
      const data = parsed.data;
      onEvent({
        id: Number.isFinite(id) && id > 0 ? id : latestId,
        event: eventType,
        data,
        timestamp: parsed.timestamp ?? Date.now()
      });

      if (data.type === "end") {
        source.close();
      }
    });
  }

  source.onerror = (event) => {
    if (source.readyState === EventSource.CLOSED) {
      onError?.(event);
    }
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

function parseStoredRunEventPayload(data: string): { data: RunEvent; timestamp?: number } {
  try {
    const parsed = JSON.parse(data) as RunEvent & { timestamp?: unknown };
    return {
      data: stripSseTimestamp(parsed),
      timestamp: typeof parsed.timestamp === "number" && Number.isFinite(parsed.timestamp) ? parsed.timestamp : undefined
    };
  } catch {
    return {
      data: {
        type: "error",
        message: "Unable to parse run event",
        details: data
      }
    };
  }
}

function stripSseTimestamp(data: RunEvent & { timestamp?: unknown }): RunEvent {
  const { timestamp: _timestamp, ...event } = data;
  return event as RunEvent;
}

function parseSseEvents(input: string): StoredRunEvent[] {
  return input
    .split(/\r?\n\r?\n/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split(/\r?\n/u);
      const id = Number.parseInt(lines.find((line) => line.startsWith("id: "))?.slice(4) ?? "0", 10);
      const event = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "message";
      const timestamp = Number.parseInt(lines.find((line) => line.startsWith("timestamp: "))?.slice(11) ?? "", 10);
      const dataLine = lines.find((line) => line.startsWith("data: "));
      const parsed = parseStoredRunEventPayload(dataLine?.slice(6) ?? "{}");
      return {
        id: Number.isFinite(id) ? id : 0,
        event,
        data: parsed.data,
        timestamp: Number.isFinite(timestamp) ? timestamp : parsed.timestamp ?? Date.now()
      };
    });
}
