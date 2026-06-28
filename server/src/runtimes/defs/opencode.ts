import { modelOption, parseLineModels } from "../models.js";
import type { RuntimeAgentDef } from "../types.js";

export const opencodeDef: RuntimeAgentDef = {
  id: "opencode",
  name: "OpenCode",
  bin: "opencode",
  versionArgs: ["--version"],
  fallbackModels: [
    modelOption("opencode/default", "OpenCode Default"),
    modelOption("anthropic/claude-sonnet-4", "Claude Sonnet 4"),
    modelOption("openai/gpt-5", "GPT-5"),
  ],
  listModels: {
    args: ["models"],
    parse: parseLineModels,
  },
  buildArgs: (context) => {
    const args = ["run", "--output-format", "json"];
    if (context.options?.model) args.push("--model", context.options.model);
    return args;
  },
  promptViaStdin: true,
  promptInputFormat: "text",
  streamFormat: "json-event-stream",
  eventParser: "opencode",
  capturesSessionIdFromStream: true,
};
