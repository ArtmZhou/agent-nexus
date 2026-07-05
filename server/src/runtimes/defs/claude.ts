import { modelOption, parseLineModels } from "../models.js";
import type { RuntimeAgentDef } from "../types.js";

export const claudeDef: RuntimeAgentDef = {
  id: "claude",
  name: "Claude Code",
  bin: "claude",
  versionArgs: ["--version"],
  fallbackModels: [
    modelOption("", "Default"),
  ],
  listModels: {
    args: ["models"],
    parse: parseLineModels,
  },
  buildArgs: (context) => {
    const args = ["--print", "--output-format", "stream-json", "--verbose"];
    if (context.options?.model) args.push("--model", context.options.model);
    if (context.resumeSessionId) args.push("--resume", context.resumeSessionId);
    for (const dir of context.extraAllowedDirs ?? []) args.push("--add-dir", dir);
    return args;
  },
  promptViaStdin: true,
  promptInputFormat: "text",
  streamFormat: "claude-stream-json",
  eventParser: "claude",
  supportsImagePaths: true,
  resumesSessionViaCli: true,
};
