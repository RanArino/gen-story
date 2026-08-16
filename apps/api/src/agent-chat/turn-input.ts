import type { AgentTurnRequest } from "@gen-story/application";

import { GEN_STORY_MCP_TOOL_NAMES } from "../mcp/tool-registry";

/**
 * Sent once, when a conversation's provider session is created — never again.
 * Everything the agent needs to work in this project is either in here or
 * readable through the MCP tools; the Gen Story transcript is deliberately
 * not replayed, because the provider keeps (and compacts) its own context.
 */
export function composeSessionPreamble(input: {
  projectId: string;
  language: "en" | "ja";
}): string {
  const language = input.language === "ja" ? "Japanese" : "English";
  return [
    "You are helping the operator of Gen Story refine one project's creative direction:",
    "AI photo analysis, emotion/tone, and style preset. Nothing else is in scope.",
    "",
    `Project ID: ${input.projectId}. Every Gen Story tool is already scoped to it.`,
    "",
    "Rules:",
    "1. Read current values with get_creative_direction before suggesting anything.",
    "2. You cannot write project data. To change a field, call",
    "   propose_creative_direction_changes with a field-level before/after diff.",
    "   The operator reviews and approves it in the Gen Story UI.",
    "3. When there is a real trade-off, attach two or three options to the item,",
    "   each with a reason and its impact, instead of silently picking one.",
    "4. Only call apply_approved_change_proposal after the operator has approved",
    "   items; it writes just the approved ones.",
    `5. Reply in ${language} — the operator's chosen app language — in plain`,
    "   prose. Keep tool mechanics out of the reply: the UI renders proposals",
    "   and tool activity itself.",
    "",
    `Available Gen Story tools: ${GEN_STORY_MCP_TOOL_NAMES.join(", ")}.`,
  ].join("\n");
}

/**
 * The per-turn payload. Only the operator's new message and the resolved
 * values of the fields they `@`-mentioned — the references are included
 * because the agent must propose against the same revision Gen Story read,
 * and re-reading them through a tool would be a slower way to get the same
 * answer.
 */
export function composeTurnInput(request: AgentTurnRequest): string {
  if (request.references.length === 0) {
    return request.text;
  }

  const referenceLines = request.references.map((reference) =>
    [
      `- ${reference.label} (${reference.targetKey}, revision ${reference.revision}):`,
      JSON.stringify(reference.value),
    ].join(" "),
  );

  return [
    request.text,
    "",
    "Referenced fields (current values; propose against these revisions):",
    ...referenceLines,
  ].join("\n");
}
