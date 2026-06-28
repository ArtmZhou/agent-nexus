import { modelOption, parseLineModels } from "../models.js";
import type { RuntimeAgentDef } from "../types.js";

export const opencodeDef: RuntimeAgentDef = {
  id: "opencode",
  name: "OpenCode",
  bin: "opencode",
  versionArgs: ["--version"],
  fallbackModels: [
    modelOption("", "Default"),
    modelOption("anthropic/claude-sonnet-4", "Claude Sonnet 4"),
    modelOption("openai/gpt-5", "GPT-5"),
  ],
  listModels: {
    args: ["models"],
    parse: parseLineModels,
  },
  buildArgs: (context) => {
    const args = ["run", "--format", "json"];
    if (context.options?.model) args.push("--model", context.options.model);
    if (context.cwd) args.push("--dir", context.cwd);
    args.push(context.prompt);
    return args;
  },
  promptViaStdin: false,
  promptInputFormat: "text",
  streamFormat: "json-event-stream",
  eventParser: "opencode",
  capturesSessionIdFromStream: true,
};
