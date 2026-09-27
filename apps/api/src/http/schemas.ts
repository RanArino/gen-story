import { z } from "zod";

const IdentifierSchema = z.string().min(1).max(128);
const NameSchema = z.string().min(1).max(200);
const ShortTextSchema = z.string().max(2_000);
const LongTextSchema = z.string().max(20_000);

type BoundedJson =
  | null
  | boolean
  | number
  | string
  | BoundedJson[]
  | { [key: string]: BoundedJson };

function boundedJsonSchema(depth: number): z.ZodType<BoundedJson> {
  const scalar = z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string().max(20_000),
  ]);
  if (depth === 0) return scalar;

  const nested = z.lazy(() => boundedJsonSchema(depth - 1));
  const object = z
    .record(nested)
    .refine((value) => Object.keys(value).length <= 50, {
      message: "Objects may contain at most 50 fields.",
    });
  return z.union([scalar, z.array(nested).max(100), object]);
}

const BoundedJsonSchema = boundedJsonSchema(6);

export const CreateProjectSchema = z
  .object({
    projectId: IdentifierSchema.optional(),
    name: NameSchema,
  })
  .strict();

export const UploadPhotoAssetSchema = z
  .object({
    name: NameSchema,
    mimeType: z.string().min(1).max(100),
    contentBase64: z
      .string()
      .min(1)
      .max(15 * 1024 * 1024),
    notes: ShortTextSchema.nullish(),
    usage: z.enum(["candidate", "excluded", "reference"]).optional(),
  })
  .strict();

export const PatchPhotoAssetSchema = z
  .object({
    usage: z.enum(["candidate", "excluded", "reference"]),
  })
  .strict();

export const UpsertStoryboardSchema = z
  .object({
    projectId: IdentifierSchema,
    // Optional, and the empty string is allowed: blank means "tone not decided
    // yet", which is exactly what the guided setup flow gates step 2 on. Omitting
    // it leaves the stored tone alone.
    tone: ShortTextSchema.optional(),
    toneDescription: ShortTextSchema.optional(),
    status: z.enum(["draft", "editing", "ready", "completed"]).optional(),
    stylePresetId: IdentifierSchema.nullable().optional(),
    commonPrompt: LongTextSchema.optional(),
    story: LongTextSchema.optional(),
    negativePrompt: LongTextSchema.optional(),
    characterPolicy: z.enum(["featured", "background_only", "none"]).optional(),
    characterPrompt: LongTextSchema.optional(),
  })
  .strict();

// The AI-fillable fields accept the empty string on purpose: blank means "not
// written yet", which is what makes a scene eligible for AI fill. Requiring a
// non-empty value here forced the web layer to invent placeholder text, which
// then made every scene look already-filled and silently disabled AI fill.
export const SceneInputSchema = z
  .object({
    sceneId: IdentifierSchema.optional(),
    orderIndex: z.number().int().min(0),
    status: z.enum(["draft", "ready", "completed"]).optional(),
    title: ShortTextSchema,
    description: LongTextSchema,
    imagePrompt: LongTextSchema,
    emotion: ShortTextSchema,
    cameraDirection: ShortTextSchema,
    lightingDirection: ShortTextSchema,
    motionDirection: ShortTextSchema,
    notes: LongTextSchema.optional(),
    negativePrompt: LongTextSchema.optional(),
    // How closely image generation should follow this scene's photos: "off"
    // ignores them (prompt-only, the default), "low"/"high" send them to the
    // image model as an edit reference via OpenAI's input_fidelity parameter,
    // which only has these two levels.
    photoFidelity: z.enum(["off", "low", "high"]).optional(),
    photoAssets: z
      .array(
        z.object({
          photoAssetId: IdentifierSchema,
          role: z.enum(["primary", "reference"]),
        }),
      )
      .max(20)
      .optional(),
  })
  .strict();

export const UpsertScenesSchema = z
  .object({
    scenes: z.array(SceneInputSchema).min(1).max(100),
  })
  .strict();

export const AssignScenePhotosSchema = z
  .object({
    photoAssets: z
      .array(
        z.object({
          photoAssetId: IdentifierSchema,
          role: z.enum(["primary", "reference"]),
        }),
      )
      .max(20),
  })
  .strict();

export const FillSceneWithAiSchema = z.object({}).strict();

// Setup step 5: one AI call per scene that still has a blank field. The count
// is not a parameter — the server decides it from the scenes — so the body is
// empty and the caller reads the spend back from the returned job list.
export const FillStoryboardScenesWithAiSchema = z.object({}).strict();

// Setup step 4. One AI call; tone and style must already be decided.
// storyPurpose is optional free text the user typed in the "Create with AI"
// modal (e.g. the purpose of a trip); an empty/omitted value lets the model
// decide the story and common prompt on its own.
export const GenerateStorySetupSchema = z
  .object({ storyPurpose: ShortTextSchema.optional() })
  .strict();

// Preview the composed prompt for a scene. Every field is optional: omitted
// fields fall back to the persisted scene/storyboard values, so the preview can
// reflect the user's current unsaved editor/modal state. Side-effect free.
export const PreviewScenePromptSchema = z
  .object({
    imagePrompt: LongTextSchema.optional(),
    emotion: ShortTextSchema.optional(),
    cameraDirection: ShortTextSchema.optional(),
    lightingDirection: ShortTextSchema.optional(),
    motionDirection: ShortTextSchema.optional(),
    sceneNegativePrompt: LongTextSchema.optional(),
    projectNegativePrompt: LongTextSchema.optional(),
    commonPrompt: LongTextSchema.optional(),
    story: LongTextSchema.optional(),
    photoFidelity: z.enum(["off", "low", "high"]).optional(),
  })
  .strict();

export const AnalyzeProjectPhotosSchema = z.object({}).strict();

export const ExportStoryboardAssetsSchema = z
  .object({
    assetSelection: z.enum(["both", "original_only", "generated_only"]),
  })
  .strict();

export const CreateTemplateScenesSchema = z
  .object({
    photoAssetIds: z.array(IdentifierSchema).min(1).max(30),
    // Opt-in: enqueues one AI fill job per created scene, so it bills one model
    // call per photo. Defaults to off.
    autoFill: z.boolean().optional(),
  })
  .strict();

export const ReorderPhotosSchema = z
  .object({
    photoAssetIds: z.array(IdentifierSchema).min(1).max(100),
  })
  .strict();

export const ReorderScenesSchema = z
  .object({
    sceneIds: z.array(IdentifierSchema).min(1).max(100),
  })
  .strict();

export const ComplementSceneBridgeSchema = z
  .object({
    fromSceneId: IdentifierSchema,
    toSceneId: IdentifierSchema,
  })
  .strict();

export const CreateGenerationRequestSchema = z
  .object({
    generationRequestId: IdentifierSchema.optional(),
    inputJson: z
      .record(BoundedJsonSchema)
      .refine((value) => Object.keys(value).length <= 50)
      .default({}),
  })
  .strict();

export const CreateCustomStyleSchema = z
  .object({
    name: NameSchema,
    description: ShortTextSchema.default(""),
    prompt: LongTextSchema.min(1),
    referenceImageStorageKey: z.string().min(1).max(1_024).optional(),
  })
  .strict();

export const SetUserPreferenceSchema = z
  .object({
    language: z.enum(["en", "ja"]),
    agentRuntime: z.enum(["claude", "codex", "api"]).optional(),
  })
  .strict();

// Item-level approval is a first-party operator action; an agent has no
// session and therefore cannot reach these endpoints. "pending" is not
// offered here — undoing a decision is a revise, not a decision.
export const DecideChangeProposalItemSchema = z
  .object({
    approval: z.enum(["approved", "rejected"]),
  })
  .strict();

export const SelectChangeProposalChoiceSchema = z
  .object({
    optionId: IdentifierSchema,
  })
  .strict();

export const ReviseChangeProposalItemSchema = z
  .object({
    after: BoundedJsonSchema,
    rationale: ShortTextSchema.min(1).optional(),
  })
  .strict();

// ── Embedded agent chat (M3) ───────────────────────────────────────────────

const SemanticMentionSchema = z
  .object({
    label: NameSchema,
    target: z
      .object({
        entityType: z.enum(["project", "storyboard", "scene"]),
        entityId: IdentifierSchema,
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
      })
      .strict(),
  })
  .strict();

export const CreateAgentConversationSchema = z
  .object({
    title: NameSchema.optional(),
  })
  .strict();

// `clientRequestId` is what makes a resubmitted turn idempotent after a
// dropped response, so it is required rather than generated server-side.
export const PostAgentChatTurnSchema = z
  .object({
    clientRequestId: IdentifierSchema,
    text: LongTextSchema.min(1),
    mentions: z.array(SemanticMentionSchema).max(50).optional(),
  })
  .strict();
