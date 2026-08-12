import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import type {
  ComplementSceneProposal,
  ComplementSceneProposalInput,
  ComplementSceneProposalPort,
  ObjectStoragePort,
} from "@gen-story/application";

import { createAiInputImage } from "../images/image-metadata";
import { retryGeminiRateLimit } from "../gemini/gemini-rate-limit";

export const DEFAULT_GEMINI_COMPLEMENT_SCENE_MODEL = "gemini-2.5-flash";

const ProposalSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  imagePrompt: z.string().min(1),
  emotion: z.string().min(1),
  cameraDirection: z.string().min(1),
  lightingDirection: z.string().min(1),
  motionDirection: z.string().min(1),
});

const ProposalsSchema = z.object({
  proposals: z.array(ProposalSchema).min(1).max(3),
});

type GeminiClient = {
  models: {
    generateContent(input: unknown): Promise<{ text?: string }>;
  };
};

const sceneProperties = {
  title: { type: "string" },
  description: { type: "string" },
  imagePrompt: { type: "string" },
  emotion: { type: "string" },
  cameraDirection: { type: "string" },
  lightingDirection: { type: "string" },
  motionDirection: { type: "string" },
} as const;

const responseJsonSchema = {
  type: "object",
  properties: {
    proposals: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        properties: sceneProperties,
        required: Object.keys(sceneProperties),
      },
    },
  },
  required: ["proposals"],
} as const;

function languageDirective(
  language: ComplementSceneProposalInput["language"],
): string {
  if (language === "ja") {
    return 'Respond in Japanese. All title, description, image prompt, and any free-text fields MUST be written in natural Japanese. Selection enum values such as cameraDirection, lightingDirection, motionDirection, and emotion MUST remain in English (e.g., "Wide", "Close-up", "Joy").';
  }
  return "Respond in English. All title, description, image prompt, and any free-text fields MUST be English.";
}

function buildPrompt(input: ComplementSceneProposalInput): string {
  return [
    "Propose 1-3 AI-only 'complement scenes' that bridge two adjacent storyboard scenes.",
    languageDirective(input.language),
    "A complement scene has no source photo; it is fully AI-generated to smooth the narrative.",
    "Use the provided project photos as visual context for consistency.",
    "Return only JSON matching the provided schema.",
    `Project: ${input.project.name}`,
    `Storyboard tone: ${input.storyboard.tone}`,
    `Common prompt applied to every scene: ${input.storyboard.commonPrompt || "(none)"}`,
    input.stylePreset
      ? `Visual style: ${input.stylePreset.name} — ${input.stylePreset.prompt}`
      : "Visual style: AI's choice, consistent with the tone.",
    `Bridge from scene "${input.fromScene.title || "(untitled)"}": ${input.fromScene.description || "(no description)"}`,
    `Bridge to scene "${input.toScene.title || "(untitled)"}": ${input.toScene.description || "(no description)"}`,
    "emotion/cameraDirection/lightingDirection/motionDirection should be short label-style values (always English).",
  ].join("\n");
}

function bytesToBase64(body: Uint8Array): string {
  return Buffer.from(body).toString("base64");
}

export class GeminiComplementSceneProposalAdapter implements ComplementSceneProposalPort {
  private client: GeminiClient | null;

  constructor(
    private readonly objectStorage: ObjectStoragePort,
    private readonly apiKey: string | undefined,
    private readonly model = DEFAULT_GEMINI_COMPLEMENT_SCENE_MODEL,
    client?: GeminiClient,
  ) {
    this.client = client ?? null;
  }

  private getClient(): GeminiClient {
    if (this.client != null) {
      return this.client;
    }
    if (this.apiKey == null || this.apiKey.length === 0) {
      throw new Error(
        "GEMINI_API_KEY is required for AI complement-scene proposals.",
      );
    }
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
    return this.client;
  }

  async proposeComplementScenes(
    input: ComplementSceneProposalInput,
  ): Promise<ComplementSceneProposal[]> {
    const client = this.getClient();
    const parts: unknown[] = [{ text: buildPrompt(input) }];

    for (const photo of input.projectPhotos.filter(
      (candidate) => candidate.deletedAt === null,
    )) {
      const body = await this.objectStorage.getObject(photo.storageKey);
      if (body == null) {
        continue;
      }
      const normalized = await createAiInputImage(body);
      parts.push({
        inlineData: {
          mimeType: normalized.mimeType,
          data: bytesToBase64(normalized.body),
        },
      });
    }

    const response = await retryGeminiRateLimit(() =>
      client.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema,
        },
      }),
    );
    const text = response.text;

    if (text == null || text.trim().length === 0) {
      throw new Error(
        "Gemini complement-scene proposal returned an empty response.",
      );
    }

    return ProposalsSchema.parse(JSON.parse(text)).proposals;
  }
}
