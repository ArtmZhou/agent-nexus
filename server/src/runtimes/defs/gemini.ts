import { modelOption, parseLineModels } from "../models.js";
import type { RuntimeAgentDef } from "../types.js";

export const geminiDef: RuntimeAgentDef = {
  id: "gemini",
  name: "Gemini CLI",
  bin: "gemini",
  versionArgs: ["--version"],
  fallbackModels: [
    modelOption("gemini-2.5-pro", "Gemini 2.5 Pro"),
    modelOption("gemini-2.5-flash", "Gemini 2.5 Flash"),
  ],
  listModels: {
    args: ["models", "list"],
    parse: parseLineModels,
  },
  buildArgs: (context) => {
    const args = ["--output-format", "json"];
    if (context.options?.model) args.push("--model", context.options.model);
    return args;
  },
  promptViaStdin: true,
  promptInputFormat: "text",
  streamFormat: "json-event-stream",
  eventParser: "gemini",
};
