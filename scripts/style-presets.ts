// Single source of truth for the nine built-in (system-scope) style presets.
// Imported by scripts/seed.ts (to seed the style_presets table) and by
// scripts/generate-style-previews.ts (to render preview images).
//
// Each preset uses a fixed, stable id so re-seeding is idempotent. The preview
// image filename is derived from `name` by the API (toStylePresetDto):
//   /style-previews/<name lowercased, spaces -> dashes>.jpg

export type SystemStylePreset = {
  id: string;
  name: string;
  description: string;
  prompt: string;
};

export const SYSTEM_STYLE_PRESETS: SystemStylePreset[] = [
  {
    id: "system-cinematic-photoreal",
    name: "Cinematic Photoreal",
    description:
      "Realistic live-action film look with natural lighting and grounded detail.",
    prompt:
      "A cinematic photoreal image with natural skin texture, realistic materials, and grounded production design. Use a film-still composition with motivated lighting, controlled depth of field, subtle color grading, and believable shadows. Preserve consistent character identity, wardrobe, and environment details across scenes.",
  },
  {
    id: "system-anime-movie",
    name: "Anime Movie",
    description:
      "Original animated film look with expressive linework and painted backgrounds.",
    prompt:
      "An original animated feature-film still with clean expressive linework, hand-painted background detail, and soft cel shading. Use dynamic but readable composition, luminous skies or practical light sources, and a vibrant harmonious palette. Keep faces, costumes, and key props consistent across scenes.",
  },
  {
    id: "system-warm-hand-drawn",
    name: "Warm Hand-Drawn",
    description:
      "Gentle hand-drawn storybook look with pencil texture and warm color.",
    prompt:
      "A warm hand-drawn storybook illustration with visible pencil texture, gentle ink outlines, and softly layered color. Use cozy directional light, rounded shapes, human imperfections, and an intimate mid-shot composition. Keep character proportions and recurring design details stable.",
  },
  {
    id: "system-luminous-light",
    name: "Luminous Light",
    description:
      "Airy digital illustration style focused on transparent light and soft glow.",
    prompt:
      "A luminous digital illustration centered on transparent light, airy atmosphere, and delicate highlights. Use soft bloom, clean silhouettes, pale reflected color, and a calm composition with generous negative space. Keep the scene readable and avoid washing out faces or important objects.",
  },
  {
    id: "system-film-photo",
    name: "Film Photo",
    description:
      "Analog film photograph look with realistic grain, exposure, and lens feel.",
    prompt:
      "A natural film photograph with realistic lens rendering, fine grain, and slightly imperfect exposure. Use documentary-style framing, available light, gentle contrast, and authentic color response from analog film. Preserve believable anatomy, materials, and location continuity.",
  },
  {
    id: "system-watercolor-illustration",
    name: "Watercolor Illustration",
    description:
      "Transparent watercolor illustration with paper texture and soft pigment edges.",
    prompt:
      "A watercolor illustration on textured paper with transparent pigment washes, soft edge bleeding, and restrained pencil underdrawing. Use light tonal contrast, layered color, and uncluttered composition so the subject remains clear. Keep recurring characters recognizable despite the loose medium.",
  },
  {
    id: "system-monochrome-film",
    name: "Monochrome Film",
    description:
      "Black-and-white film still look with rich grayscale and expressive shadows.",
    prompt:
      "A black-and-white cinematic film still with rich grayscale tonality, controlled contrast, and expressive shadow design. Use classic lens framing, practical light sources, visible film grain, and strong silhouettes. Preserve facial readability and avoid losing important objects in the shadows.",
  },
  {
    id: "system-3d-animation",
    name: "3D Animation",
    description:
      "Stylized 3D animated film look with soft lighting and tactile materials.",
    prompt:
      "A stylized 3D animated film still with appealing shapes, soft global illumination, tactile materials, and clear depth. Use cinematic camera placement, readable posing, gentle subsurface skin lighting, and polished but not plastic surfaces. Keep character models, costumes, and props consistent across scenes.",
  },
  {
    id: "system-ai-auto",
    name: "AI Auto",
    description:
      "Automatically chooses a cohesive original look that fits the scene.",
    prompt:
      "Choose the most fitting cohesive visual style for the scene's emotion, setting, and composition while keeping it original and copyright-safe. Prioritize clear storytelling, consistent character identity, stable color logic, readable faces, and continuity with earlier scenes. Do not imitate any named artist, studio, brand, franchise, or copyrighted character.",
  },
];

// Derives the preview image filename the API expects for a preset name.
// Must stay in sync with toStylePresetDto in apps/api/src/http/dto-mappers.ts.
export function stylePreviewFileName(name: string): string {
  return `${name.toLowerCase().replace(/\s+/g, "-")}.jpg`;
}
