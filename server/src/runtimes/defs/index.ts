import { claudeDef } from "./claude.js";
import { codexDef } from "./codex.js";
import { cursorAgentDef } from "./cursor-agent.js";
import { geminiDef } from "./gemini.js";
import { opencodeDef } from "./opencode.js";
import type { RuntimeAgentDef } from "../types.js";

export const builtinAgentDefs: RuntimeAgentDef[] = [
  codexDef,
  claudeDef,
  opencodeDef,
  geminiDef,
  cursorAgentDef,
];
