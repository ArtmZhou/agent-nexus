import { claudeDef } from "./claude.js";
import { codexDef } from "./codex.js";
import { opencodeDef } from "./opencode.js";
import type { RuntimeAgentDef } from "../types.js";

export const builtinAgentDefs: RuntimeAgentDef[] = [
  codexDef,
  claudeDef,
  opencodeDef,
];
