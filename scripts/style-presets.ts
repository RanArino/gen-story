// Single source of truth for the eleven built-in (system-scope) style presets.
// Imported by scripts/seed.ts (to seed the style_presets table) and by
// scripts/generate-style-previews.ts (to render preview images).
//
// Each preset uses a fixed, stable id so re-seeding is idempotent. The preview
// image filename is derived from `name` by the API (toStylePresetDto):
//   /style-previews/<name lowercased, spaces -> dashes>.jpg
//
// When authoring a preset prompt, describe the medium, observable rendering
// techniques, and where their effects apply. Leave subjects, motifs, and framing
// to each scene. Treat source photos as references for scene content.
// Verify the gallery preview and first-pass storyboard images from different
// subjects with the preset's intended provider. Check the provider and effective
// inputs before attributing style drift across runs to the prompt.

import { UKIYO_E_STYLE_PRESET_ID } from "../packages/shared/src/image-generation-models.ts";

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
    id: UKIYO_E_STYLE_PRESET_ID,
    name: "Ukiyo-e Woodblock",
    description:
      "Hand-printed Japanese woodblock with layered pigment, fine carved lines, and textured washi.",
    prompt:
      "Render the entire scene as a finely carved, hand-printed Japanese ukiyo-e color woodblock print. Layer broad, flat blocks of ink and earthy pigment on warm washi. Show fine paper fibers, lightly worn ink, and uneven pigment transfer across the print, including the sky and large color fields. Use thin, restrained sumi outlines and small carved marks for scene-specific details such as rice stalks, grasses, roof tiles, or woven fabric. Use a limited palette of indigo, gold-ochre, muted greens, warm paper cream, and vermilion accents where they fit. Use bokashi only in open sky and build depth elsewhere through overlapping shapes and changes of ink color. Give faces and garments simple flat color and delicate linework. Include maple leaves or bands of mist only when they belong in the scene. Carry the subject, setting, composition, time of day, and emotion from the scene and its references. Use this woodblock technique when other directions describe a different rendering treatment. Represent light with printed color shapes and keep detail legible at every depth. Avoid heavy outlines, crosshatching, hard comic borders, photographic shading, lens blur, and smooth digital gradients outside the sky.",
  },
  {
    id: "system-radiant-cel-cgi",
    name: "Radiant Cel CGI",
    description:
      "Cel-shaded 3D animation in photoreal worlds, with radiant natural light, glowing skies, and sparkling water.",
    prompt:
      "Render the entire scene as a cel-shaded 3D CGI animation still. Give characters a toon shader with crisp two-tone shading, thin clean contour lines, and anime-style faces with large expressive eyes and simplified features, so they read clearly as animated characters rather than real people. Place them inside a richly detailed, photoreal 3D environment with physically accurate materials and depth. Saturate the frame with natural light: radiant low sun, sky light glowing through windows, volumetric god rays, drifting light particles, luminous halation around highlights, and subtle prismatic lens flares. Treat water, glass, and wet surfaces as a showcase wherever they appear: mirror-like reflections, refracted color, beads of droplets, ripples, and glittering points of light. Fill the sky with vivid, deep blues, warm gold-to-pink gradients, and sharply detailed, sunlit clouds. Keep the palette vivid but harmonious, shadows cool and transparent, and the mood nostalgic and bittersweet. Carry the subject, setting, composition, and time of day from the scene and its references. Avoid photographic faces, thick outlines on the environment, chibi proportions, plastic materials, and dull or muddy color.",
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
