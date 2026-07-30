import { z } from "zod";

export const CreateProjectSchema = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1),
});

export const UploadPhotoAssetSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().min(1),
  contentBase64: z.string().min(1),
  notes: z.string().nullish(),
  usage: z.enum(["candidate", "excluded", "reference"]).optional(),
});

export const PatchPhotoAssetSchema = z.object({
  usage: z.enum(["candidate", "excluded", "reference"]),
});

export const UpsertStoryboardSchema = z.object({
  projectId: z.string().min(1),
  // Optional, and the empty string is allowed: blank means "tone not decided
  // yet", which is exactly what the guided setup flow gates step 2 on. Omitting
  // it leaves the stored tone alone.
  tone: z.string().optional(),
  status: z.enum(["draft", "editing", "ready", "completed"]).optional(),
  stylePresetId: z.string().nullable().optional(),
  commonPrompt: z.string().optional(),
  story: z.string().optional(),
  negativePrompt: z.string().optional(),
});

// The AI-fillable fields accept the empty string on purpose: blank means "not
// written yet", which is what makes a scene eligible for AI fill. Requiring a
// non-empty value here forced the web layer to invent placeholder text, which
// then made every scene look already-filled and silently disabled AI fill.
export const SceneInputSchema = z.object({
  sceneId: z.string().optional(),
  orderIndex: z.number().int().min(0),
  status: z.enum(["draft", "ready", "completed"]).optional(),
  title: z.string(),
  description: z.string(),
  imagePrompt: z.string(),
  emotion: z.string(),
  cameraDirection: z.string(),
  lightingDirection: z.string(),
  motionDirection: z.string(),
  notes: z.string().optional(),
  negativePrompt: z.string().optional(),
  photoAssets: z
    .array(
      z.object({
        photoAssetId: z.string(),
        role: z.enum(["primary", "reference"]),
      }),
    )
    .optional(),
});

export const UpsertScenesSchema = z.object({
  scenes: z.array(SceneInputSchema).min(1),
});

export const AssignScenePhotosSchema = z.object({
  photoAssets: z.array(
    z.object({
      photoAssetId: z.string(),
      role: z.enum(["primary", "reference"]),
    }),
  ),
});

export const FillSceneWithAiSchema = z.object({}).strict();

// Setup step 5: one AI call per scene that still has a blank field. The count
// is not a parameter — the server decides it from the scenes — so the body is
// empty and the caller reads the spend back from the returned job list.
export const FillStoryboardScenesWithAiSchema = z.object({}).strict();

// Setup step 4. One AI call; tone and style must already be decided.
export const GenerateStorySetupSchema = z.object({}).strict();

// Preview the composed prompt for a scene. Every field is optional: omitted
// fields fall back to the persisted scene/storyboard values, so the preview can
// reflect the user's current unsaved editor/modal state. Side-effect free.
export const PreviewScenePromptSchema = z.object({
  imagePrompt: z.string().optional(),
  emotion: z.string().optional(),
  cameraDirection: z.string().optional(),
  lightingDirection: z.string().optional(),
  motionDirection: z.string().optional(),
  sceneNegativePrompt: z.string().optional(),
  projectNegativePrompt: z.string().optional(),
  commonPrompt: z.string().optional(),
  story: z.string().optional(),
});

export const AnalyzeProjectPhotosSchema = z.object({}).strict();

export const CreateTemplateScenesSchema = z.object({
  photoAssetIds: z.array(z.string().min(1)).min(1).max(20),
  // Opt-in: enqueues one AI fill job per created scene, so it bills one model
  // call per photo. Defaults to off.
  autoFill: z.boolean().optional(),
});

export const ReorderPhotosSchema = z.object({
  photoAssetIds: z.array(z.string().min(1)).min(1),
});

export const ReorderScenesSchema = z.object({
  sceneIds: z.array(z.string().min(1)).min(1),
});

export const ComplementSceneBridgeSchema = z.object({
  fromSceneId: z.string().min(1),
  toSceneId: z.string().min(1),
});

export const CreateGenerationRequestSchema = z.object({
  generationRequestId: z.string().optional(),
  inputJson: z.record(z.unknown()).default({}),
});

export const CreateCustomStyleSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  prompt: z.string().min(1),
  referenceImageStorageKey: z.string().min(1).optional(),
});

export const SetUserPreferenceSchema = z.object({
  language: z.enum(["en", "ja"]),
});
