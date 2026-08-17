// @vitest-environment jsdom
import type { ChangeProposalDto } from "@gen-story/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import messages from "../../i18n/messages/en.json";
import { ChangeApprovalCard } from "./ChangeApprovalCard";

afterEach(cleanup);

function proposal(): ChangeProposalDto {
  return {
    id: "proposal_1",
    projectId: "project_1",
    provider: "claude",
    conversationId: "conversation_1",
    turnId: "turn_1",
    rationale: "Tighten the opening scene.",
    status: "pending",
    items: [
      {
        id: "item_1",
        target: { entityType: "scene", entityId: "scene_1", field: "scene" },
        before: { title: "Quiet start", description: "A calm morning." },
        after: { title: "Bold start", description: "A calm morning." },
        rationale: "The title undersells the moment.",
        approval: "pending",
        baseRevision: "r1",
      },
    ],
    choices: [],
    clientRequestId: "client_1",
    approvedBy: null,
    resolvedAt: null,
    applyOutcome: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function renderCard() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ChangeApprovalCard
        proposal={proposal()}
        fieldLabel={(field) => field}
        onDecide={async () => {}}
        onSelectChoice={async () => {}}
        onApply={async () => {}}
        onRevise={() => {}}
        onContinue={() => {}}
      />
    </NextIntlClientProvider>,
  );
}

describe("ChangeApprovalCard diff view", () => {
  it("shows only the changed field in Preview, summarizing the rest", () => {
    renderCard();

    expect(screen.getByText("Title")).toBeDefined();
    expect(screen.getByText("Bold start")).toBeDefined();
    // The unchanged field's value is not spelled out redundantly.
    expect(screen.queryByText("A calm morning.")).toBeNull();
    expect(screen.getByText(/1 unchanged: Description/)).toBeDefined();
  });

  it("switches to a unified diff listing in Raw view", () => {
    renderCard();

    fireEvent.click(screen.getByRole("tab", { name: "Raw" }));

    expect(screen.queryByText("Bold start")).toBeNull();
    expect(screen.getByText(/"title": "Quiet start"/)).toBeDefined();
    expect(screen.getByText(/"title": "Bold start"/)).toBeDefined();
  });
});
