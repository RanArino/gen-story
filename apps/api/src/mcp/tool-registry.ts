import {
  applyChangeProposal,
  createChangeProposalUseCase,
  getChangeProposal,
  getCreativeDirection,
  listChangeProposals,
  type UseCaseError,
  type UseCaseResult,
} from "@gen-story/application";
import type { AgentProvider, ChangeProposal } from "@gen-story/domain";
import { z } from "zod";

import type { ApiDependencies } from "../app/create-api-context";
import { toChangeProposalDto } from "../http/dto-mappers";

// One MCP session is bound to exactly one project. No tool accepts a project
// ID, so a session attached to project A has no way to name project B's data;
// handlers additionally re-check ownership of every ID they are handed.
export type McpToolContext = {
  deps: ApiDependencies;
  projectId: string;
  // Identifies the connected agent for proposal provenance. Taken from the
  // session, never from tool input, so an agent cannot attribute a proposal
  // to the other provider.
  provider: AgentProvider;
};

export type McpToolOutcome =
  | { ok: true; data: unknown; changeProposalId?: string }
  | { ok: false; code: string; message: string };

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputShape: z.ZodRawShape;
  readOnly: boolean;
  handler: (
    context: McpToolContext,
    input: Record<string, unknown>,
  ) => Promise<McpToolOutcome>;
};

function toolFailure(error: UseCaseError): McpToolOutcome {
  return { ok: false, code: error.code, message: error.message };
}

function unwrap<T>(result: UseCaseResult<T>): T | McpToolOutcome {
  return result.ok ? result.value : toolFailure(result.error);
}

function isToolFailure(value: unknown): value is McpToolOutcome {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok: unknown }).ok === false
  );
}

// A proposal is only visible to the session that owns its project. Returning
// "not found" rather than "forbidden" keeps the existence of another project's
// proposals out of the answer.
function requireProjectProposal(
  context: McpToolContext,
  proposal: ChangeProposal,
): McpToolOutcome | undefined {
  if (proposal.projectId === context.projectId) return undefined;
  return {
    ok: false,
    code: "not_found",
    message: "Change proposal not found.",
  };
}

const SemanticTargetSchema = z.object({
  entityType: z.enum(["project", "storyboard"]),
  entityId: z.string().min(1),
  field: z.enum(["photoAnalysis", "tone", "stylePresetId"]),
});

const ChoiceOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.unknown(),
  reason: z.string().min(1),
  impact: z.string().min(1),
});

const ProposeInputSchema = z.object({
  clientRequestId: z.string().min(1),
  conversationId: z.string().min(1),
  turnId: z.string().min(1),
  rationale: z.string().min(1),
  items: z
    .array(
      z.object({
        target: SemanticTargetSchema,
        after: z.unknown(),
        rationale: z.string().min(1),
        choice: z
          .object({ options: z.array(ChoiceOptionSchema).min(2).max(3) })
          .optional(),
      }),
    )
    .min(1),
});

const GetChangeProposalInputSchema = z.object({
  changeProposalId: z.string().min(1),
});

const ListChangeProposalsInputSchema = z.object({
  status: z
    .enum([
      "pending",
      "partially_approved",
      "approved",
      "rejected",
      "applied",
      "conflicted",
    ])
    .optional(),
});

const getCreativeDirectionTool: McpToolDefinition = {
  name: "get_creative_direction",
  title: "Read creative direction",
  description:
    "Read this project's current photo analysis, tone, and style preset with the base revision each one must be proposed against, plus the style presets that are valid values for stylePresetId.",
  inputShape: {},
  readOnly: true,
  handler: async (context) => {
    const result = await getCreativeDirection(context.deps, {
      projectId: context.projectId,
    });
    return result.ok
      ? { ok: true, data: result.value }
      : toolFailure(result.error);
  },
};

const listChangeProposalsTool: McpToolDefinition = {
  name: "list_change_proposals",
  title: "List change proposals",
  description:
    "List this project's change proposals, newest last, optionally filtered by status.",
  inputShape: ListChangeProposalsInputSchema.shape,
  readOnly: true,
  handler: async (context, rawInput) => {
    const input = ListChangeProposalsInputSchema.parse(rawInput);
    const result = await listChangeProposals(context.deps, {
      projectId: context.projectId,
      status: input.status,
    });
    return result.ok
      ? { ok: true, data: { proposals: result.value.map(toChangeProposalDto) } }
      : toolFailure(result.error);
  },
};

const getChangeProposalTool: McpToolDefinition = {
  name: "get_change_proposal",
  title: "Read a change proposal",
  description:
    "Read one change proposal of this project, including per-item before/after values, rationale, choices, and approval state.",
  inputShape: GetChangeProposalInputSchema.shape,
  readOnly: true,
  handler: async (context, rawInput) => {
    const input = GetChangeProposalInputSchema.parse(rawInput);
    const proposal = unwrap(
      await getChangeProposal(context.deps, {
        changeProposalId: input.changeProposalId,
      }),
    );
    if (isToolFailure(proposal)) return proposal;

    const scopeFailure = requireProjectProposal(context, proposal);
    if (scopeFailure != null) return scopeFailure;

    return {
      ok: true,
      data: toChangeProposalDto(proposal),
      changeProposalId: proposal.id,
    };
  },
};

const proposeCreativeDirectionChangesTool: McpToolDefinition = {
  name: "propose_creative_direction_changes",
  title: "Propose creative direction changes",
  description:
    "Record a reviewable proposal for one or more of this project's creative fields. This changes no project data: the operator must approve items before apply_approved_change_proposal can write them. Retrying with the same clientRequestId returns the proposal already created.",
  inputShape: ProposeInputSchema.shape,
  readOnly: false,
  handler: async (context, rawInput) => {
    const input = ProposeInputSchema.parse(rawInput);
    const result = await createChangeProposalUseCase(context.deps, {
      projectId: context.projectId,
      provider: context.provider,
      conversationId: input.conversationId,
      turnId: input.turnId,
      rationale: input.rationale,
      clientRequestId: input.clientRequestId,
      items: input.items.map((item) => ({
        target: item.target,
        after: item.after,
        rationale: item.rationale,
        choice:
          item.choice == null
            ? undefined
            : {
                options: item.choice.options.map((option) => ({
                  id: option.id,
                  label: option.label,
                  value: option.value,
                  reason: option.reason,
                  impact: option.impact,
                })),
              },
      })),
    });

    return result.ok
      ? {
          ok: true,
          data: toChangeProposalDto(result.value),
          changeProposalId: result.value.id,
        }
      : toolFailure(result.error);
  },
};

const applyApprovedChangeProposalTool: McpToolDefinition = {
  name: "apply_approved_change_proposal",
  title: "Apply an approved change proposal",
  description:
    "Write the approved items of a change proposal through the application's own use cases. Only items the operator approved are written, and every base revision is rechecked first: if a target changed after the proposal was made, nothing is written and the proposal is marked conflicted.",
  inputShape: GetChangeProposalInputSchema.shape,
  readOnly: false,
  handler: async (context, rawInput) => {
    const input = GetChangeProposalInputSchema.parse(rawInput);

    // Scope-check before applying: the apply use case takes only an ID, so
    // this is where a cross-project ID is refused.
    const existing = unwrap(
      await getChangeProposal(context.deps, {
        changeProposalId: input.changeProposalId,
      }),
    );
    if (isToolFailure(existing)) return existing;

    const scopeFailure = requireProjectProposal(context, existing);
    if (scopeFailure != null) return scopeFailure;

    const result = await applyChangeProposal(context.deps, {
      changeProposalId: input.changeProposalId,
    });

    return result.ok
      ? {
          ok: true,
          data: toChangeProposalDto(result.value),
          changeProposalId: result.value.id,
        }
      : { ...toolFailure(result.error), changeProposalId: existing.id };
  },
};

// The complete allowlist. There is deliberately no general "update project"
// tool, no SQL or shell access, and no way to approve a proposal: approval is
// a first-party action taken by the operator through the REST API/GUI.
export const GEN_STORY_MCP_TOOLS: McpToolDefinition[] = [
  getCreativeDirectionTool,
  listChangeProposalsTool,
  getChangeProposalTool,
  proposeCreativeDirectionChangesTool,
  applyApprovedChangeProposalTool,
];

export const GEN_STORY_MCP_TOOL_NAMES: string[] = GEN_STORY_MCP_TOOLS.map(
  (tool) => tool.name,
);
