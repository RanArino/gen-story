import { describe, expect, it } from "vitest";

import {
  applyChangeProposalItemApproval,
  approvedChangeProposalItems,
  createChangeProposal,
  markChangeProposalApplied,
  markChangeProposalConflicted,
  reviseChangeProposalItem,
  selectChangeProposalChoiceOption,
  type CreateChangeProposalInput,
} from "./change-proposal";
import { storyboardSemanticTarget } from "./semantic-target";

function baseInput(
  overrides: Partial<CreateChangeProposalInput> = {},
): CreateChangeProposalInput {
  return {
    id: "proposal_1",
    projectId: "project_1",
    provenance: {
      provider: "codex",
      conversationId: "conversation_1",
      turnId: "turn_1",
    },
    items: [
      {
        id: "item_1",
        target: storyboardSemanticTarget("storyboard_1", "tone"),
        before: "",
        after: "warm nostalgia",
        rationale: "Photos show a warm family reunion.",
        baseRevision: "2026-08-10T00:00:00.000Z",
      },
    ],
    rationale: "Refine the storyboard tone based on the uploaded photos.",
    clientRequestId: "client_req_1",
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("createChangeProposal", () => {
  it("builds a pending proposal with pending items", () => {
    const proposal = createChangeProposal(baseInput());

    expect(proposal.status).toBe("pending");
    expect(proposal.items).toEqual([
      {
        id: "item_1",
        target: storyboardSemanticTarget("storyboard_1", "tone"),
        before: "",
        after: "warm nostalgia",
        rationale: "Photos show a warm family reunion.",
        baseRevision: "2026-08-10T00:00:00.000Z",
        approval: "pending",
      },
    ]);
    expect(proposal.approvedBy).toBeNull();
    expect(proposal.applyOutcome).toBeNull();
    expect(proposal.choices).toEqual([]);
  });

  it("reconstructs an already-decided proposal without resetting it to pending", () => {
    const proposal = createChangeProposal(
      baseInput({
        status: "applied",
        approvedBy: "user_1",
        resolvedAt: "2026-08-15T01:00:00.000Z",
        applyOutcome: {
          appliedItemIds: ["item_1"],
          appliedAt: "2026-08-15T02:00:00.000Z",
          appliedBy: "user_1",
        },
        items: [
          {
            id: "item_1",
            target: storyboardSemanticTarget("storyboard_1", "tone"),
            before: "",
            after: "warm nostalgia",
            rationale: "r",
            baseRevision: "rev1",
            approval: "approved",
          },
        ],
      }),
    );

    expect(proposal.status).toBe("applied");
    expect(proposal.approvedBy).toBe("user_1");
    expect(proposal.items[0]?.approval).toBe("approved");
    expect(proposal.applyOutcome).toEqual({
      appliedItemIds: ["item_1"],
      appliedAt: "2026-08-15T02:00:00.000Z",
      appliedBy: "user_1",
    });
  });

  it("rejects a proposal with no items", () => {
    expect(() => createChangeProposal(baseInput({ items: [] }))).toThrow(
      /at least one item/,
    );
  });

  it("rejects two items targeting the same field", () => {
    const target = storyboardSemanticTarget("storyboard_1", "tone");
    expect(() =>
      createChangeProposal(
        baseInput({
          items: [
            {
              id: "item_1",
              target,
              before: "",
              after: "a",
              rationale: "r",
              baseRevision: "rev1",
            },
            {
              id: "item_2",
              target,
              before: "",
              after: "b",
              rationale: "r",
              baseRevision: "rev1",
            },
          ],
        }),
      ),
    ).toThrow(/same field twice/);
  });

  it("rejects a choice with only one option", () => {
    expect(() =>
      createChangeProposal(
        baseInput({
          choices: [
            {
              targetItemId: "item_1",
              options: [
                {
                  id: "opt_1",
                  label: "A",
                  value: "a",
                  reason: "r",
                  impact: "i",
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/two or three options/);
  });

  it("rejects a choice targeting an unknown item", () => {
    expect(() =>
      createChangeProposal(
        baseInput({
          choices: [
            {
              targetItemId: "item_missing",
              options: [
                {
                  id: "opt_1",
                  label: "A",
                  value: "a",
                  reason: "r",
                  impact: "i",
                },
                {
                  id: "opt_2",
                  label: "B",
                  value: "b",
                  reason: "r",
                  impact: "i",
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/unknown item/);
  });

  it("rejects two choice cards for the same item", () => {
    const twoOptions = [
      { id: "opt_1", label: "A", value: "a", reason: "r", impact: "i" },
      { id: "opt_2", label: "B", value: "b", reason: "r", impact: "i" },
    ];

    expect(() =>
      createChangeProposal(
        baseInput({
          choices: [
            { targetItemId: "item_1", options: twoOptions },
            { targetItemId: "item_1", options: twoOptions },
          ],
        }),
      ),
    ).toThrow(/at most one choice card/);
  });

  it("accepts a two-option choice with a pre-selected option", () => {
    const proposal = createChangeProposal(
      baseInput({
        choices: [
          {
            targetItemId: "item_1",
            options: [
              {
                id: "opt_1",
                label: "Warm",
                value: "warm nostalgia",
                reason: "r",
                impact: "i",
              },
              {
                id: "opt_2",
                label: "Bright",
                value: "bright joy",
                reason: "r",
                impact: "i",
              },
            ],
            selectedOptionId: "opt_1",
          },
        ],
      }),
    );

    expect(proposal.choices).toEqual([
      {
        targetItemId: "item_1",
        options: [
          {
            id: "opt_1",
            label: "Warm",
            value: "warm nostalgia",
            reason: "r",
            impact: "i",
          },
          {
            id: "opt_2",
            label: "Bright",
            value: "bright joy",
            reason: "r",
            impact: "i",
          },
        ],
        selectedOptionId: "opt_1",
      },
    ]);
  });
});

describe("applyChangeProposalItemApproval", () => {
  it("moves to approved once every item is approved", () => {
    const proposal = createChangeProposal(baseInput());
    const decision = {
      approvedBy: "user_1",
      resolvedAt: "2026-08-15T01:00:00.000Z",
      updatedAt: "2026-08-15T01:00:00.000Z",
    };

    const approved = applyChangeProposalItemApproval(
      proposal,
      "item_1",
      "approved",
      decision,
    );

    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe("user_1");
    expect(approvedChangeProposalItems(approved)).toHaveLength(1);
  });

  it("is partially_approved when items disagree", () => {
    const proposal = createChangeProposal(
      baseInput({
        items: [
          {
            id: "item_1",
            target: storyboardSemanticTarget("storyboard_1", "tone"),
            before: "",
            after: "warm nostalgia",
            rationale: "r",
            baseRevision: "rev1",
          },
          {
            id: "item_2",
            target: storyboardSemanticTarget("storyboard_1", "stylePresetId"),
            before: null,
            after: "style_1",
            rationale: "r",
            baseRevision: "rev1",
          },
        ],
      }),
    );
    const decision = {
      approvedBy: "user_1",
      resolvedAt: "t",
      updatedAt: "t",
    };

    const partial = applyChangeProposalItemApproval(
      proposal,
      "item_1",
      "approved",
      decision,
    );

    expect(partial.status).toBe("partially_approved");
    expect(approvedChangeProposalItems(partial)).toHaveLength(1);
  });

  it("rejects further approval changes once applied or conflicted", () => {
    const proposal = createChangeProposal(baseInput());
    const decision = { approvedBy: "user_1", resolvedAt: "t", updatedAt: "t" };
    const applied = { ...proposal, status: "applied" as const };

    expect(() =>
      applyChangeProposalItemApproval(applied, "item_1", "approved", decision),
    ).toThrow(/Cannot change item approval/);
  });

  it("rejects an unknown item ID", () => {
    const proposal = createChangeProposal(baseInput());
    const decision = { approvedBy: "user_1", resolvedAt: "t", updatedAt: "t" };

    expect(() =>
      applyChangeProposalItemApproval(
        proposal,
        "item_missing",
        "approved",
        decision,
      ),
    ).toThrow(/not found/);
  });
});

describe("selectChangeProposalChoiceOption", () => {
  it("updates the choice selection and the item's after value", () => {
    const proposal = createChangeProposal(
      baseInput({
        choices: [
          {
            targetItemId: "item_1",
            options: [
              {
                id: "opt_1",
                label: "Warm",
                value: "warm nostalgia",
                reason: "r",
                impact: "i",
              },
              {
                id: "opt_2",
                label: "Bright",
                value: "bright joy",
                reason: "r",
                impact: "i",
              },
            ],
          },
        ],
      }),
    );

    const updated = selectChangeProposalChoiceOption(
      proposal,
      "item_1",
      "opt_2",
      "2026-08-15T02:00:00.000Z",
    );

    expect(updated.choices[0]?.selectedOptionId).toBe("opt_2");
    expect(updated.items[0]?.after).toBe("bright joy");
    expect(updated.updatedAt).toBe("2026-08-15T02:00:00.000Z");
  });

  it("rejects an unknown option", () => {
    const proposal = createChangeProposal(
      baseInput({
        choices: [
          {
            targetItemId: "item_1",
            options: [
              {
                id: "opt_1",
                label: "Warm",
                value: "warm nostalgia",
                reason: "r",
                impact: "i",
              },
              {
                id: "opt_2",
                label: "Bright",
                value: "bright joy",
                reason: "r",
                impact: "i",
              },
            ],
          },
        ],
      }),
    );

    expect(() =>
      selectChangeProposalChoiceOption(proposal, "item_1", "opt_missing", "t"),
    ).toThrow(/Unknown choice option/);
  });
});

describe("reviseChangeProposalItem", () => {
  it("rebases the item onto a new value/revision and resets it to pending", () => {
    const decision = { approvedBy: "user_1", resolvedAt: "t", updatedAt: "t" };
    const approved = applyChangeProposalItemApproval(
      createChangeProposal(baseInput()),
      "item_1",
      "approved",
      decision,
    );

    const revised = reviseChangeProposalItem(
      approved,
      "item_1",
      {
        after: "bright joy",
        baseRevision: "2026-08-16T00:00:00.000Z",
      },
      "2026-08-16T00:00:01.000Z",
    );

    expect(revised.items[0]).toMatchObject({
      after: "bright joy",
      baseRevision: "2026-08-16T00:00:00.000Z",
      approval: "pending",
    });
    expect(revised.status).toBe("pending");
    expect(revised.updatedAt).toBe("2026-08-16T00:00:01.000Z");
  });

  it("rejects an unknown item ID", () => {
    const proposal = createChangeProposal(baseInput());

    expect(() =>
      reviseChangeProposalItem(
        proposal,
        "item_missing",
        { after: "x", baseRevision: "rev" },
        "t",
      ),
    ).toThrow(/not found/);
  });

  it("rejects revising an already-applied proposal", () => {
    const proposal = {
      ...createChangeProposal(baseInput()),
      status: "applied" as const,
    };

    expect(() =>
      reviseChangeProposalItem(
        proposal,
        "item_1",
        { after: "x", baseRevision: "rev" },
        "t",
      ),
    ).toThrow(/already-applied/);
  });
});

describe("markChangeProposalConflicted", () => {
  it("moves the proposal to conflicted", () => {
    const proposal = createChangeProposal(baseInput());

    const conflicted = markChangeProposalConflicted(proposal, "t");

    expect(conflicted.status).toBe("conflicted");
    expect(conflicted.updatedAt).toBe("t");
  });

  it("rejects conflicting an already-applied proposal", () => {
    const proposal = {
      ...createChangeProposal(baseInput()),
      status: "applied" as const,
    };

    expect(() => markChangeProposalConflicted(proposal, "t")).toThrow(
      /already-applied/,
    );
  });
});

describe("markChangeProposalApplied", () => {
  it("sets status to applied with the given outcome", () => {
    const proposal = createChangeProposal(baseInput());
    const outcome = {
      appliedItemIds: ["item_1"],
      appliedAt: "2026-08-16T00:00:00.000Z",
      appliedBy: "user_1",
    };

    const applied = markChangeProposalApplied(proposal, outcome, "t");

    expect(applied.status).toBe("applied");
    expect(applied.applyOutcome).toEqual(outcome);
    expect(applied.updatedAt).toBe("t");
  });

  it("is idempotent once already applied", () => {
    const proposal = {
      ...createChangeProposal(baseInput()),
      status: "applied" as const,
      applyOutcome: {
        appliedItemIds: ["item_1"],
        appliedAt: "2026-08-15T00:00:00.000Z",
        appliedBy: "user_1",
      },
    };

    const result = markChangeProposalApplied(
      proposal,
      {
        appliedItemIds: ["item_1"],
        appliedAt: "2026-08-16T00:00:00.000Z",
        appliedBy: "user_2",
      },
      "t2",
    );

    expect(result).toBe(proposal);
  });
});
