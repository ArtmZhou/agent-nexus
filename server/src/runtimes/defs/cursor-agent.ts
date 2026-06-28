import { modelOption } from "../models.js";
import type { RuntimeAgentDef } from "../types.js";

export const cursorAgentDef: RuntimeAgentDef = {
  id: "cursor-agent",
  name: "Cursor Agent",
  bin: "cursor-agent",
  fallbackBins: ["cursor"],
  versionArgs: ["--version"],
  fallbackModels: [
    modelOption("auto", "Auto"),
    modelOption("sonnet", "Sonnet"),
  ],
  buildArgs: (context) => {
    const args = ["--acp"];
    if (context.options?.model) args.push("--model", context.options.model);
    return args;
  },
  promptViaStdin: true,
  promptInputFormat: "stream-json",
  streamFormat: "acp-json-rpc",
  eventParser: "cursor-agent",
  resumesSessionViaAcpLoad: true,
};
