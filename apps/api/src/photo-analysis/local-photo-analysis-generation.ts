import type {
  PhotoAnalysisGenerationInput,
  PhotoAnalysisGenerationPort,
  PhotoAnalysisGenerationResult,
} from "@gen-story/application";
import type { PhotoAsset } from "@gen-story/domain";

const CANDIDATES = [
  {
    value: "warm_nostalgia",
    label: "Warm nostalgia",
    description: "Tender, familiar, and memory-focused.",
  },
  {
    value: "quiet_gratitude",
    label: "Quiet gratitude",
    description: "Reflective, calm, and appreciative.",
  },
  {
    value: "joyful_connection",
    label: "Joyful connection",
    description: "Bright, affectionate, and people-centered.",
  },
  {
    value: "cinematic_celebration",
    label: "Cinematic celebration",
    description: "Dramatic, polished, and milestone-oriented.",
  },
  {
    value: "playful_energy",
    label: "Playful energy",
    description: "Lively, casual, and upbeat.",
  },
] as const;

function describePhoto(photo: PhotoAsset): string {
  const dimensions =
    photo.width != null && photo.height != null
      ? `${photo.width}x${photo.height}`
      : "unknown dimensions";
  const notes = photo.notes ? ` Notes: ${photo.notes}` : "";
  return `${photo.name} (${photo.usage}, ${dimensions}).${notes}`;
}

function candidateReason(input: PhotoAnalysisGenerationInput, index: number) {
  const tone = input.storyboard?.tone ?? "no selected tone";
  const referenceCount = input.photos.filter(
    (p) => p.usage === "reference",
  ).length;
  return `Suggested from ${input.photos.length} project photo${input.photos.length === 1 ? "" : "s"}, ${referenceCount} reference photo${referenceCount === 1 ? "" : "s"}, and current tone "${tone}". Option ${index + 1} keeps the story usable before live vision analysis runs.`;
}

export class LocalPhotoAnalysisGenerationAdapter implements PhotoAnalysisGenerationPort {
  async analyzeProjectPhotos(
    input: PhotoAnalysisGenerationInput,
  ): Promise<PhotoAnalysisGenerationResult> {
    const selectedCandidates = CANDIDATES.slice(
      0,
      Math.min(5, Math.max(3, input.photos.length)),
    );

    return {
      emotionCandidates: selectedCandidates.map((candidate, index) => ({
        ...candidate,
        reason: candidateReason(input, index),
      })),
      photoInsights: input.photos.map((photo) => ({
        photoAssetId: photo.id,
        summary: describePhoto(photo),
        people:
          photo.notes ??
          "People and relationships require live vision analysis.",
        setting:
          "Location, season, and era are inferred from file context in local mode.",
        event: `${input.project.name} photo selected as ${photo.usage}.`,
        atmosphere: input.storyboard?.tone
          ? `Current storyboard tone is ${input.storyboard.tone}.`
          : "Atmosphere will be refined by live vision analysis.",
      })),
      storySummary: `${input.project.name} has ${input.photos.length} curated photo${input.photos.length === 1 ? "" : "s"} ready for storyboard tone analysis.`,
      model: "local-deterministic",
    };
  }
}
