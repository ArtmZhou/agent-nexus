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
