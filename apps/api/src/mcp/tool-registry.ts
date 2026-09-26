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
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ApiDependencies } from "../app/create-api-context";
import { toChangeProposalDto } from "../http/dto-mappers";
import {
  createPhotoContactSheet,
  createPreviewImage,
} from "../images/image-metadata";
import { buildPhotoPreviewStorageKey } from "../storage/storage-keys";

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
  | {
      ok: true;
      data: unknown;
      // A read tool may return source-photo image blocks in addition to its
      // JSON manifest, so the native vision agent can inspect the actual
      // uploaded pixels rather than infer them from theme text.
      content?: CallToolResult["content"];
      changeProposalId?: string;
    }
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
  entityType: z.enum(["project", "storyboard", "scene"]),
  entityId: z.string().min(1),
  field: z.enum([
    "photoAnalysis",
    "tone",
    "stylePresetId",
    "commonPrompt",
    "story",
    "negativePrompt",
    "characterPolicy",
    "scene",
  ]),
});

const ChoiceOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.unknown(),
  reason: z.string().min(1),
  impact: z.string().min(1),
});

const ProposeInputBaseSchema = z.object({
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

const ProposeInputSchema = ProposeInputBaseSchema.superRefine(
  (input, context) => {
    const valid = (field: string, value: unknown) => {
      if (field === "tone") {
        const tone = value as { title?: unknown; description?: unknown } | null;
        return (
          typeof tone === "object" &&
          tone !== null &&
          typeof tone.title === "string" &&
          tone.title.trim() !== "" &&
          typeof tone.description === "string" &&
          tone.description.trim() !== ""
        );
      }
      if (field === "characterPolicy") {
        const character = value as { mode?: unknown; prompt?: unknown } | null;
        return (
          typeof character === "object" &&
          character !== null &&
          ["featured", "background_only", "none"].includes(
            String(character.mode),
          ) &&
          typeof character.prompt === "string" &&
          character.prompt.trim() !== ""
        );
      }
      return true;
    };

    input.items.forEach((item, itemIndex) => {
      const values = [
        item.after,
        ...(item.choice?.options.map((option) => option.value) ?? []),
      ];
      values.forEach((value, valueIndex) => {
        if (!valid(item.target.field, value)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["items", itemIndex, valueIndex === 0 ? "after" : "choice"],
            message:
              item.target.field === "tone"
                ? 'Tone values require {"title", "description"}.'
                : 'Character values require {"mode", "prompt"}.',
          });
        }
      });
    });
  },
);

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

const ReadStoryboardPhotosInputSchema = z.object({
  offset: z.number().int().min(0).optional(),
});

const STORYBOARD_PHOTO_PAGE_SIZE = 6;

const getCreativeDirectionTool: McpToolDefinition = {
  name: "get_creative_direction",
  title: "Read creative direction",
  description:
    'Read this project\'s current creative direction with the base revision each field must be proposed against: photo analysis; the storyboard\'s tone, style preset, common prompt, story/worldview, negative prompt and character policy; and every scene (entityType "scene", field "scene"). Also returns the style presets that are valid values for stylePresetId.',
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

const readStoryboardPhotosTool: McpToolDefinition = {
  name: "read_storyboard_photos",
  title: "Read storyboard source photos",
  description:
    "Read ordered primary storyboard photos as bounded 640px preview pages. Start at offset 0: it includes a numbered whole-storyboard contact sheet plus the first detail page. Follow nextOffset until null before making any photo-dependent recommendation or proposal. Read-only.",
  inputShape: ReadStoryboardPhotosInputSchema.shape,
  readOnly: true,
  handler: async (context, rawInput) => {
    const { offset = 0 } = ReadStoryboardPhotosInputSchema.parse(rawInput);
    const storyboards = await context.deps.storyboards.findByProjectId(
      context.projectId,
    );
    const storyboard = storyboards[0];
    if (storyboard == null) {
      return {
        ok: false,
        code: "not_found",
        message: "Storyboard not found.",
      };
    }

    const scenes = await context.deps.scenes.findByStoryboardId(storyboard.id);
    const orderedScenes = [...scenes].sort(
      (left, right) => left.orderIndex - right.orderIndex,
    );
    const entries: {
      sceneId: string;
      orderIndex: number;
      photoAssetId: string;
      name: string;
      notes: string | null;
      storageKey: string;
      globalIndex: number;
    }[] = [];

    for (const scene of orderedScenes) {
      const primary = scene.photoAssets.find(
        (photoAsset) => photoAsset.role === "primary",
      );
      if (primary == null) continue;
      const photo = await context.deps.photoAssets.findById(
        primary.photoAssetId,
      );
      if (photo == null || photo.deletedAt !== null) continue;
      entries.push({
        sceneId: scene.id,
        orderIndex: scene.orderIndex,
        photoAssetId: photo.id,
        name: photo.name,
        notes: photo.notes,
        storageKey: photo.storageKey,
        globalIndex: entries.length + 1,
      });
    }

    if (offset > entries.length) {
      return {
        ok: false,
        code: "validation_error",
        message: `Photo offset ${offset} is beyond the ${entries.length} available storyboard photos.`,
      };
    }

    const pageEntries = entries.slice(
      offset,
      offset + STORYBOARD_PHOTO_PAGE_SIZE,
    );
    const overviewIncluded = offset === 0 && entries.length > 0;
    // Load overview images serially. A legacy project may be missing every
    // derivative; that fallback must never hold all original uploads in memory.
    const overviewImages = overviewIncluded
      ? await loadPhotoPreviews(context, entries)
      : null;
    const pageImages =
      overviewImages == null
        ? await Promise.all(
            pageEntries.map((entry) => loadPhotoPreview(context, entry)),
          )
        : overviewImages
            .slice(offset, offset + STORYBOARD_PHOTO_PAGE_SIZE)
            .map((image) => image.body);
    const overview =
      overviewImages == null
        ? null
        : await createPhotoContactSheet(overviewImages);
    const nextOffset =
      offset + pageEntries.length < entries.length
        ? offset + pageEntries.length
        : null;
    const photos = pageEntries.map(
      ({ storageKey: _storageKey, ...entry }) => entry,
    );
    const manifest = {
      storyboardId: storyboard.id,
      totalPhotoCount: entries.length,
      offset,
      returnedPhotoCount: photos.length,
      nextOffset,
      overviewIncluded,
      photos,
    };

    return {
      ok: true,
      data: manifest,
      content: [
        {
          type: "text",
          text: JSON.stringify(manifest, null, 2),
        },
        ...(overview == null
          ? []
          : [
              {
                type: "image" as const,
                data: Buffer.from(overview.body).toString("base64"),
                mimeType: overview.mimeType,
              },
            ]),
        ...pageImages.map((body) => ({
          type: "image" as const,
          data: Buffer.from(body).toString("base64"),
          mimeType: "image/jpeg",
        })),
      ],
    };
  },
};

async function loadPhotoPreview(
  context: McpToolContext,
  photo: { photoAssetId: string; storageKey: string },
): Promise<Uint8Array> {
  const previewKey = buildPhotoPreviewStorageKey({
    projectId: context.projectId,
    photoAssetId: photo.photoAssetId,
  });
  const preview = await context.deps.objectStorage.getObject(previewKey);
  if (preview != null) return preview;

  const original = await context.deps.objectStorage.getObject(photo.storageKey);
  if (original == null) {
    throw new Error(
      `Photo preview and original object not found for storyboard photo: ${photo.photoAssetId}`,
    );
  }

  return (await createPreviewImage(original)).body;
}

async function loadPhotoPreviews(
  context: McpToolContext,
  photos: readonly {
    photoAssetId: string;
    storageKey: string;
    globalIndex: number;
  }[],
): Promise<{ body: Uint8Array; globalIndex: number }[]> {
  const previews: { body: Uint8Array; globalIndex: number }[] = [];
  for (const photo of photos) {
    previews.push({
      body: await loadPhotoPreview(context, photo),
      globalIndex: photo.globalIndex,
    });
  }
  return previews;
}

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
    'Record a reviewable proposal for one or more creative fields. Tone after/choice values must be {"title": string, "description": string}; characterPolicy values must be {"mode": "featured" | "background_only" | "none", "prompt": string}. This changes no project data: the operator must approve items before apply_approved_change_proposal can write them. Retrying with the same clientRequestId returns the proposal already created.',
  inputShape: ProposeInputBaseSchema.shape,
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
  readStoryboardPhotosTool,
  listChangeProposalsTool,
  getChangeProposalTool,
  proposeCreativeDirectionChangesTool,
  applyApprovedChangeProposalTool,
];

export const GEN_STORY_MCP_TOOL_NAMES: string[] = GEN_STORY_MCP_TOOLS.map(
  (tool) => tool.name,
);
