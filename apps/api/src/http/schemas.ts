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
  tone: z.string().min(1),
  status: z.enum(["draft", "editing", "ready", "completed"]).optional(),
  stylePresetId: z.string().nullable().optional(),
});

export const SceneInputSchema = z.object({
  sceneId: z.string().optional(),
  orderIndex: z.number().int().min(0),
  status: z.enum(["draft", "ready", "completed"]).optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  imagePrompt: z.string().min(1),
  emotion: z.string().min(1),
  cameraDirection: z.string().min(1),
  lightingDirection: z.string().min(1),
  motionDirection: z.string().min(1),
  notes: z.string().optional(),
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

export const AnalyzeProjectPhotosSchema = z.object({}).strict();

export const CreateTemplateScenesSchema = z.object({
  photoAssetIds: z.array(z.string().min(1)).min(1).max(20),
});

export const CreateGenerationRequestSchema = z.object({
  generationRequestId: z.string().optional(),
  inputJson: z.record(z.unknown()).default({}),
});
