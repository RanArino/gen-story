import type { AgentTurnRequest } from "@gen-story/application";
import { describe, expect, it } from "vitest";

import { GEN_STORY_MCP_TOOL_NAMES } from "../mcp/tool-registry";
import { composeSessionPreamble, composeTurnInput } from "./turn-input";

function request(overrides: Partial<AgentTurnRequest> = {}): AgentTurnRequest {
  return {
    projectId: "project_1",
    conversationId: "conversation_1",
    turnId: "turn_1",
    provider: "codex",
    model: null,
    nativeSessionId: null,
    text: "Should the tone be warmer?",
    mentions: [],
    references: [],
    language: "en",
    ...overrides,
  };
}

describe("composeSessionPreamble", () => {
  it("scopes the agent to one project and to proposing rather than writing", () => {
    const preamble = composeSessionPreamble({
      projectId: "project_1",
      language: "en",
    });

    expect(preamble).toContain("Project ID: project_1");
    expect(preamble).toContain("You cannot write project data");
    expect(preamble).toContain("read_storyboard_photos");
    expect(preamble).toMatch(/never claim\s+photos are unavailable/);
    expect(preamble).toContain("Follow nextOffset until it is null");
    expect(preamble).toContain("global visual anchors");
    expect(preamble).toContain("Reply in English");
    for (const tool of GEN_STORY_MCP_TOOL_NAMES) {
      expect(preamble).toContain(tool);
    }
  });
});

describe("composeSessionPreamble language", () => {
  it("names the operator's app language rather than leaving it to the locale", () => {
    expect(
      composeSessionPreamble({ projectId: "project_1", language: "ja" }),
    ).toContain("Reply in Japanese");
  });
});

describe("composeTurnInput", () => {
  it("adds the photo-reference instruction when nothing was referenced", () => {
    const composed = composeTurnInput(request());
    expect(composed).toContain("Should the tone be warmer?");
    expect(composed).toContain("call read_storyboard_photos with offset 0");
    expect(composed).toContain("follow nextOffset until it is null");
  });

  it("appends each referenced field's live value and revision", () => {
    const composed = composeTurnInput(
      request({
        text: "Warm up @tone",
        references: [
          {
            label: "@tone",
            targetKey: "storyboard:storyboard_1#tone",
            value: "Reflective",
            revision: "2026-08-16T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(composed).toContain("Warm up @tone");
    expect(composed).toContain(
      '- @tone (storyboard:storyboard_1#tone, revision 2026-08-16T00:00:00.000Z): "Reflective"',
    );
  });
});
