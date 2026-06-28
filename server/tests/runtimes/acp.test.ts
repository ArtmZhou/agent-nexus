import type { RunEvent } from "@agent-nexus/shared";
import { PassThrough } from "node:stream";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  attachAcpSession,
  buildAcpSessionNewParams,
  createJsonLineStream
} from "../../src/runtimes/acp.js";

describe("ACP session helpers", () => {
  test("builds absolute session/new params and preserves MCP server env arrays", () => {
    const params = buildAcpSessionNewParams("relative/project", {
      mcpServers: [
        {
          name: "repo",
          command: "node",
          args: ["server.js"],
          env: [
            { name: "TOKEN", value: "secret" },
            { name: "DEBUG", value: "1" }
          ]
        }
      ]
    });

    expect(params.cwd).toBe(path.resolve("relative/project"));
    expect(params.mcpServers).toEqual([
      {
        name: "repo",
        command: "node",
        args: ["server.js"],
        env: [
          { name: "TOKEN", value: "secret" },
          { name: "DEBUG", value: "1" }
        ]
      }
    ]);
  });

  test("parses JSON lines split across chunks and reports malformed lines", () => {
    const messages: unknown[] = [];
    const diagnostics: RunEvent[] = [];
    const parser = createJsonLineStream(
      (message) => messages.push(message),
      (diagnostic) => diagnostics.push(diagnostic)
    );

    parser.write('{"jsonrpc":"2.0","method":"session/up');
    parser.write('date","params":{"delta":"hello"}}\nnot-json\n');
    parser.end();

    expect(messages).toEqual([
      { jsonrpc: "2.0", method: "session/update", params: { delta: "hello" } }
    ]);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        type: "diagnostic",
        name: "malformed_acp_json"
      })
    ]);
  });

  test("runs an in-memory ACP session flow", async () => {
    const clientStdin = new PassThrough();
    const clientStdout = new PassThrough();
    const serverSeen: Array<Record<string, unknown>> = [];
    const events: RunEvent[] = [];

    const fakeServer = createJsonLineStream((message) => {
      const request = message as { id?: number; method?: string; params?: Record<string, unknown> };
      serverSeen.push(request as Record<string, unknown>);

      if (request.method === "initialize") {
        clientStdout.write(jsonLine({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: 1 } }));
      }

      if (request.method === "session/new") {
        clientStdout.write(jsonLine({ jsonrpc: "2.0", id: request.id, result: { sessionId: "durable-1" } }));
      }

      if (request.method === "session/set_model") {
        clientStdout.write(jsonLine({ jsonrpc: "2.0", id: request.id, result: {} }));
      }

      if (request.method === "session/prompt") {
        clientStdout.write(
          jsonLine({
            jsonrpc: "2.0",
            method: "session/request_permission",
            params: { requestId: "permission-1", options: [{ id: "allow_once" }, { id: "deny" }] }
          })
        );
        clientStdout.write(
          jsonLine({
            jsonrpc: "2.0",
            method: "session/update",
            params: { sessionId: "durable-1", delta: "Hello", usage: { input_tokens: 2 } }
          })
        );
        clientStdout.write(
          jsonLine({
            jsonrpc: "2.0",
            method: "session/update",
            params: { stopReason: "end_turn" }
          })
        );
        clientStdout.write(jsonLine({ jsonrpc: "2.0", id: request.id, result: { stopReason: "end_turn" } }));
      }
    });

    clientStdin.on("data", (chunk) => fakeServer.write(chunk));

    const session = attachAcpSession({
      stdin: clientStdin,
      stdout: clientStdout,
      cwd: ".",
      prompt: "Say hello",
      model: "sonnet",
      emit: (event) => events.push(event)
    });

    await session.start();

    expect(serverSeen.map((request) => request.method)).toEqual([
      "initialize",
      "session/new",
      "session/set_model",
      "session/prompt",
      "session/respond_permission"
    ]);
    expect(serverSeen.find((request) => request.method === "session/prompt")?.params).toMatchObject({
      prompt: "Say hello",
      sessionId: "durable-1"
    });
    expect(serverSeen.find((request) => request.method === "session/respond_permission")?.params).toEqual({
      requestId: "permission-1",
      optionId: "allow_once"
    });
    expect(events).toEqual([
      { type: "status", label: "acp.session", sessionId: "durable-1" },
      { type: "text_delta", delta: "Hello" },
      { type: "usage", usage: { input_tokens: 2 } },
      { type: "end", status: "succeeded" }
    ]);
    expect(session.completedSuccessfully()).toBe(true);
    expect(session.getDurableSessionId()).toBe("durable-1");
  });

  test("loads an existing durable ACP session when a session id is provided", async () => {
    const clientStdin = new PassThrough();
    const clientStdout = new PassThrough();
    const methods: string[] = [];
    const fakeServer = createJsonLineStream((message) => {
      const request = message as { id?: number; method?: string };
      methods.push(request.method ?? "");
      clientStdout.write(jsonLine({ jsonrpc: "2.0", id: request.id, result: { sessionId: "existing-1" } }));
    });
    clientStdin.on("data", (chunk) => fakeServer.write(chunk));

    const session = attachAcpSession({
      stdin: clientStdin,
      stdout: clientStdout,
      cwd: ".",
      prompt: "Continue",
      resumeSessionId: "existing-1",
      emit: () => undefined
    });

    await session.start();

    expect(methods).toEqual(["initialize", "session/load", "session/prompt"]);
    expect(session.getDurableSessionId()).toBe("existing-1");
  });
});

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}
