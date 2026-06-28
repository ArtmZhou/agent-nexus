import { modelOption, parseLineModels } from "../models.js";
import type { RuntimeAgentDef } from "../types.js";

export const codexDef: RuntimeAgentDef = {
  id: "codex",
  name: "Codex CLI",
  bin: "codex",
  versionArgs: ["--version"],
  fallbackModels: [
    modelOption("default", "Default"),
    modelOption("gpt-5", "GPT-5"),
  ],
  listModels: {
    args: ["models", "list"],
    parse: parseLineModels,
  },
  reasoningOptions: [
    modelOption("low", "Low"),
    modelOption("medium", "Medium"),
    modelOption("high", "High"),
  ],
  buildArgs: (context) => {
    const args = ["exec", "--json"];
    if (context.options?.model) args.push("--model", context.options.model);
    if (context.options?.reasoning) args.push("--reasoning", context.options.reasoning);
    if (context.cwd) args.push("--cwd", context.cwd);
    return args;
  },
  promptViaStdin: true,
  promptInputFormat: "text",
  streamFormat: "json-event-stream",
  eventParser: "codex",
  supportsImagePaths: true,
  capturesSessionIdFromStream: true,
};
