import { z } from "zod";

import type {
  ComplementSceneProposal,
  ComplementSceneProposalInput,
} from "@gen-story/application";

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

const sceneProperties = {
  title: { type: "string" },
  description: { type: "string" },
  imagePrompt: { type: "string" },
  emotion: { type: "string" },
  cameraDirection: { type: "string" },
  lightingDirection: { type: "string" },
  motionDirection: { type: "string" },
} as const;

export const COMPLEMENT_SCENE_RESPONSE_JSON_SCHEMA = {
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

export function buildComplementScenePrompt(
  input: ComplementSceneProposalInput,
): string {
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

export function parseComplementSceneProposals(
  text: string,
): ComplementSceneProposal[] {
  return ProposalsSchema.parse(JSON.parse(text)).proposals;
}
