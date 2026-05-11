const CAMERA_DESCRIPTORS: Record<string, string> = {
  "Wide": "extreme wide shot, high camera angle, overwhelming scale, deep atmospheric perspective",
  "Extreme Wide": "extreme wide shot, tiny human presence, monumental environment scale",
  "Medium": "medium shot, human eye level camera, natural perspective",
  "Close-up": "close-up shot, shallow depth of field, cinematic bokeh background, subject fills frame",
  "Extreme Close-up": "extreme close-up, single detail fills frame, abstract bokeh surrounds",
  "Aerial": "overhead top-down shot, bird's eye view, abstract ground patterns",
  "Overhead": "overhead top-down composition, abstract human patterns, cinematic drone perspective",
  "POV": "first-person POV shot, immersive camera angle, subjective framing",
  "Low Angle": "dramatic low angle shot, three-point perspective, strong vertical convergence, horizon below frame",
  "Telephoto": "telephoto compressed shot, long lens compression, shallow depth, cinematic isolation",
  "Voyeur": "voyeur shot through crowd, foreground silhouettes heavily blurred, surveillance feeling",
};

const LIGHTING_DESCRIPTORS: Record<string, string> = {
  "Golden hour": "volumetric golden light, warm sunset bloom, atmospheric haze",
  "Natural": "soft natural light, diffused daylight, gentle shadows",
  "Dramatic": "high-contrast dramatic lighting, deep shadows, strong key light",
  "Night": "night atmosphere, urban ambient glow, neon rim lighting, deep shadows",
  "Soft": "soft wrap-around light, minimal shadows, gentle diffusion",
  "Backlit": "strong backlight, silhouette edges glowing, contre-jour atmosphere",
  "Silhouette": "pure silhouette backlight, character readable outline, glowing haze",
  "Volumetric": "volumetric light shafts, atmospheric particles, cinematic god rays",
};

const EMOTION_DESCRIPTORS: Record<string, string> = {
  "Joy": "warm joyful atmosphere, bright emotional energy",
  "Nostalgia": "subtle melancholy, poetic atmosphere, emotional warmth",
  "Love": "intimate warmth, soft emotional glow, tender atmosphere",
  "Pride": "dignified cinematic framing, emotional strength, composed grandeur",
  "Wonder": "emotional awe, sense of discovery, wide-eyed atmospheric depth",
  "Calm": "peaceful stillness, minimal movement, tranquil atmosphere",
  "Excitement": "dynamic energy, movement tension, vibrant visual rhythm",
  "Gratitude": "warm emotional resonance, gentle light, connected atmosphere",
};

const TONE_COLOR_MODIFIERS: Record<string, string> = {
  "warm": "warm color palette, dominant amber and gold tones",
  "cinematic": "desaturated cinematic palette, teal and orange color grade",
  "playful": "vibrant saturated colors, energetic palette",
  "quiet": "muted desaturated tones, cool grey-blue palette",
};

function depthSuffix(cameraDirection: string): string {
  if (cameraDirection === "Wide" || cameraDirection === "Extreme Wide") {
    return "foreground silhouettes blurred, midground subject, background bokeh depth layering, two-point perspective";
  }
  if (cameraDirection === "Telephoto" || cameraDirection === "Voyeur") {
    return "heavy foreground blur, compressed depth, cinematic layering";
  }
  if (cameraDirection === "Close-up" || cameraDirection === "Extreme Close-up") {
    return "subject sharp, background abstract bokeh";
  }
  if (cameraDirection === "Aerial" || cameraDirection === "Overhead") {
    return "flat top-down perspective, no depth layering";
  }
  return "layered cinematic depth, foreground-midground-background separation";
}

export function composeImagePrompt(input: {
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  tone: string;
  stylePresetPrompt: string | null;
}): string {
  const { imagePrompt, emotion, cameraDirection, lightingDirection, tone, stylePresetPrompt } = input;

  const segments: string[] = [];

  if (stylePresetPrompt) segments.push(stylePresetPrompt);
  segments.push(CAMERA_DESCRIPTORS[cameraDirection] ?? "cinematic framing");
  if (imagePrompt) segments.push(imagePrompt);
  segments.push(EMOTION_DESCRIPTORS[emotion] ?? "emotional cinematic atmosphere");
  segments.push(LIGHTING_DESCRIPTORS[lightingDirection] ?? "cinematic lighting");
  segments.push(depthSuffix(cameraDirection));
  if (TONE_COLOR_MODIFIERS[tone]) segments.push(TONE_COLOR_MODIFIERS[tone]);

  return segments.join(", ");
}
