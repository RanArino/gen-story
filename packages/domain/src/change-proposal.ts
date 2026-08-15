import type { ProjectId, Timestamp, UserId } from "./model";
import type { SemanticTarget, SemanticTargetRevision } from "./semantic-target";
import { semanticTargetKey } from "./semantic-target";

// Duplicated rather than imported: packages/domain must not depend on
// apps/api, which is where the CLI-backed runtime adapters (and their own
// AgentProvider) live. Both unions are expected to stay "codex" | "claude".
export type AgentProvider = "codex" | "claude";

export type ChangeProposalId = string;
export type ChangeProposalItemId = string;

export type ChangeProposalStatus =
  | "pending"
  | "partially_approved"
  | "approved"
  | "rejected"
  | "applied"
  | "conflicted";

export const CHANGE_PROPOSAL_STATUSES: ChangeProposalStatus[] = [
  "pending",
  "partially_approved",
  "approved",
  "rejected",
  "applied",
  "conflicted",
];

export function isChangeProposalStatus(
  value: unknown,
): value is ChangeProposalStatus {
  return (
    typeof value === "string" &&
    (CHANGE_PROPOSAL_STATUSES as string[]).includes(value)
  );
}

export type ChangeProposalItemApproval = "pending" | "approved" | "rejected";

export type ChangeProposalProvenance = {
  provider: AgentProvider;
  conversationId: string;
  turnId: string;
};

export type ChangeProposalItem = {
  id: ChangeProposalItemId;
  target: SemanticTarget;
  before: unknown;
  after: unknown;
  rationale: string;
  baseRevision: SemanticTargetRevision;
  approval: ChangeProposalItemApproval;
};

export type ChangeProposalChoiceOption = {
  id: string;
  label: string;
  value: unknown;
  reason: string;
  impact: string;
};

// Presents 2-3 reasoned alternatives for a single item. Selecting an option
// sets that item's `after` value; the item is still approved/rejected like
// any other item.
export type ChangeProposalChoice = {
  targetItemId: ChangeProposalItemId;
  options: ChangeProposalChoiceOption[];
  selectedOptionId: string | null;
};

export type ChangeProposalApplyOutcome = {
  appliedItemIds: ChangeProposalItemId[];
  appliedAt: Timestamp;
  appliedBy: UserId;
};

export type ChangeProposal = {
  id: ChangeProposalId;
  projectId: ProjectId;
  provenance: ChangeProposalProvenance;
  items: ChangeProposalItem[];
  rationale: string;
  choices: ChangeProposalChoice[];
  status: ChangeProposalStatus;
  // Lets proposal creation be retried safely without duplicating the
  // proposal; enforced by the application layer, not this factory.
  clientRequestId: string;
  approvedBy: UserId | null;
  resolvedAt: Timestamp | null;
  applyOutcome: ChangeProposalApplyOutcome | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CreateChangeProposalItemInput = {
  id: ChangeProposalItemId;
  target: SemanticTarget;
  before: unknown;
  after: unknown;
  rationale: string;
  baseRevision: SemanticTargetRevision;
  // Omitted for a newly authored item ("pending"); passed through when
  // reconstructing an already-decided item read back from storage.
  approval?: ChangeProposalItemApproval;
};

export type CreateChangeProposalChoiceOptionInput = {
  id: string;
  label: string;
  value: unknown;
  reason: string;
  impact: string;
};

export type CreateChangeProposalChoiceInput = {
  targetItemId: ChangeProposalItemId;
  options: CreateChangeProposalChoiceOptionInput[];
  selectedOptionId?: string | null;
};

export type CreateChangeProposalInput = {
  id: ChangeProposalId;
  projectId: ProjectId;
  provenance: ChangeProposalProvenance;
  items: CreateChangeProposalItemInput[];
  rationale: string;
  choices?: CreateChangeProposalChoiceInput[];
  clientRequestId: string;
  // The next five are omitted for a newly authored proposal (defaulting to
  // "pending"/null) and passed through when reconstructing a proposal read
  // back from storage, mirroring createStoryboard/createScene's `status`.
  status?: ChangeProposalStatus;
  approvedBy?: UserId | null;
  resolvedAt?: Timestamp | null;
  applyOutcome?: ChangeProposalApplyOutcome | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

function trimRequired(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required.`);
  }
  return trimmed;
}

export function createChangeProposal(
  input: CreateChangeProposalInput,
): ChangeProposal {
  if (input.items.length === 0) {
    throw new Error("A change proposal requires at least one item.");
  }

  const seenItemIds = new Set<string>();
  const seenTargetKeys = new Set<string>();

  const items: ChangeProposalItem[] = input.items.map((item) => {
    if (seenItemIds.has(item.id)) {
      throw new Error(`Duplicate change proposal item ID: ${item.id}`);
    }
    seenItemIds.add(item.id);

    const targetKey = semanticTargetKey(item.target);
    if (seenTargetKeys.has(targetKey)) {
      throw new Error(
        `A change proposal cannot target the same field twice: ${targetKey}`,
      );
    }
    seenTargetKeys.add(targetKey);

    return {
      id: item.id,
      target: item.target,
      before: item.before,
      after: item.after,
      rationale: trimRequired(item.rationale, "Change proposal item rationale"),
      baseRevision: trimRequired(
        item.baseRevision,
        "Change proposal item base revision",
      ),
      approval: item.approval ?? "pending",
    };
  });

  const seenChoiceTargetItemIds = new Set<string>();

  const choices: ChangeProposalChoice[] = (input.choices ?? []).map(
    (choice) => {
      if (!seenItemIds.has(choice.targetItemId)) {
        throw new Error(
          `Change proposal choice targets an unknown item: ${choice.targetItemId}`,
        );
      }

      if (seenChoiceTargetItemIds.has(choice.targetItemId)) {
        throw new Error(
          `A change proposal item can have at most one choice card: ${choice.targetItemId}`,
        );
      }
      seenChoiceTargetItemIds.add(choice.targetItemId);

      if (choice.options.length < 2 || choice.options.length > 3) {
        throw new Error(
          "A change proposal choice requires two or three options.",
        );
      }

      const seenOptionIds = new Set<string>();
      const options = choice.options.map((option) => {
        if (seenOptionIds.has(option.id)) {
          throw new Error(`Duplicate choice option ID: ${option.id}`);
        }
        seenOptionIds.add(option.id);

        return {
          id: option.id,
          label: trimRequired(option.label, "Choice option label"),
          value: option.value,
          reason: trimRequired(option.reason, "Choice option reason"),
          impact: trimRequired(option.impact, "Choice option impact"),
        };
      });

      const selectedOptionId = choice.selectedOptionId ?? null;
      if (selectedOptionId !== null && !seenOptionIds.has(selectedOptionId)) {
        throw new Error(
          `Choice selectedOptionId does not match any option: ${selectedOptionId}`,
        );
      }

      return { targetItemId: choice.targetItemId, options, selectedOptionId };
    },
  );

  return {
    id: input.id,
    projectId: input.projectId,
    provenance: {
      provider: input.provenance.provider,
      conversationId: trimRequired(
        input.provenance.conversationId,
        "Change proposal conversation ID",
      ),
      turnId: trimRequired(input.provenance.turnId, "Change proposal turn ID"),
    },
    items,
    rationale: trimRequired(input.rationale, "Change proposal rationale"),
    choices,
    status: input.status ?? "pending",
    clientRequestId: trimRequired(
      input.clientRequestId,
      "Change proposal client request ID",
    ),
    approvedBy: input.approvedBy ?? null,
    resolvedAt: input.resolvedAt ?? null,
    applyOutcome: input.applyOutcome ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

// A proposal starts "pending" (no decisions yet) and becomes "approved" or
// "rejected" only once every item agrees; any other mix of decided items is
// "partially_approved" so a partial apply can proceed on just the approved
// subset. "applied" and "conflicted" are set by the application layer (they
// depend on live entity state this pure function does not have), never
// derived here.
function deriveChangeProposalStatus(
  items: ChangeProposalItem[],
): "pending" | "partially_approved" | "approved" | "rejected" {
  if (items.every((item) => item.approval === "pending")) {
    return "pending";
  }
  if (items.every((item) => item.approval === "approved")) {
    return "approved";
  }
  if (items.every((item) => item.approval === "rejected")) {
    return "rejected";
  }
  return "partially_approved";
}

export function applyChangeProposalItemApproval(
  proposal: ChangeProposal,
  itemId: ChangeProposalItemId,
  approval: ChangeProposalItemApproval,
  decision: { approvedBy: UserId; resolvedAt: Timestamp; updatedAt: Timestamp },
): ChangeProposal {
  if (proposal.status === "applied" || proposal.status === "conflicted") {
    throw new Error(
      `Cannot change item approval on a proposal with status "${proposal.status}".`,
    );
  }

  if (!proposal.items.some((item) => item.id === itemId)) {
    throw new Error(`Change proposal item not found: ${itemId}`);
  }

  const items = proposal.items.map((item) =>
    item.id === itemId ? { ...item, approval } : item,
  );

  return {
    ...proposal,
    items,
    status: deriveChangeProposalStatus(items),
    approvedBy: decision.approvedBy,
    resolvedAt: decision.resolvedAt,
    updatedAt: decision.updatedAt,
  };
}

export function selectChangeProposalChoiceOption(
  proposal: ChangeProposal,
  targetItemId: ChangeProposalItemId,
  optionId: string,
  updatedAt: Timestamp,
): ChangeProposal {
  const choice = proposal.choices.find(
    (candidate) => candidate.targetItemId === targetItemId,
  );
  if (!choice) {
    throw new Error(`No change proposal choice for item: ${targetItemId}`);
  }

  const option = choice.options.find((candidate) => candidate.id === optionId);
  if (!option) {
    throw new Error(`Unknown choice option: ${optionId}`);
  }

  const choices = proposal.choices.map((candidate) =>
    candidate.targetItemId === targetItemId
      ? { ...candidate, selectedOptionId: optionId }
      : candidate,
  );
  const items = proposal.items.map((item) =>
    item.id === targetItemId ? { ...item, after: option.value } : item,
  );

  return { ...proposal, choices, items, updatedAt };
}

export function approvedChangeProposalItems(
  proposal: ChangeProposal,
): ChangeProposalItem[] {
  return proposal.items.filter((item) => item.approval === "approved");
}

// Rebases one item onto the target's current value/revision after a stale
// (conflicting) apply attempt, and puts that item back to "pending" so it
// goes through approval again. Does not touch other items' decisions.
export function reviseChangeProposalItem(
  proposal: ChangeProposal,
  itemId: ChangeProposalItemId,
  revision: {
    after: unknown;
    rationale?: string;
    baseRevision: SemanticTargetRevision;
  },
  updatedAt: Timestamp,
): ChangeProposal {
  if (proposal.status === "applied") {
    throw new Error("Cannot revise an item on an already-applied proposal.");
  }

  if (!proposal.items.some((item) => item.id === itemId)) {
    throw new Error(`Change proposal item not found: ${itemId}`);
  }

  const items = proposal.items.map((item) =>
    item.id === itemId
      ? {
          ...item,
          after: revision.after,
          rationale: trimRequired(
            revision.rationale ?? item.rationale,
            "Change proposal item rationale",
          ),
          baseRevision: trimRequired(
            revision.baseRevision,
            "Change proposal item base revision",
          ),
          approval: "pending" as const,
        }
      : item,
  );

  return {
    ...proposal,
    items,
    status: deriveChangeProposalStatus(items),
    updatedAt,
  };
}

// Set once an apply attempt finds a stale base revision on an approved item.
// The proposal is preserved (not discarded) so the operator can revise/rebase
// and try again, per M2's revision-conflict rule.
export function markChangeProposalConflicted(
  proposal: ChangeProposal,
  updatedAt: Timestamp,
): ChangeProposal {
  if (proposal.status === "applied") {
    throw new Error("Cannot conflict an already-applied proposal.");
  }

  return { ...proposal, status: "conflicted", updatedAt };
}

// Set once apply has written every approved item through application use
// cases. Terminal: no further item decisions or revisions are allowed
// afterward (enforced by applyChangeProposalItemApproval/reviseChangeProposalItem).
export function markChangeProposalApplied(
  proposal: ChangeProposal,
  outcome: ChangeProposalApplyOutcome,
  updatedAt: Timestamp,
): ChangeProposal {
  if (proposal.status === "applied") {
    return proposal;
  }

  return { ...proposal, status: "applied", applyOutcome: outcome, updatedAt };
}
