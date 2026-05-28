import type { Language } from "./index";

export const CAMERA_OPTIONS = [
  "Wide",
  "Extreme Wide",
  "Medium",
  "Close-up",
  "Extreme Close-up",
  "Aerial",
  "Overhead",
  "POV",
  "Low Angle",
  "Telephoto",
  "Voyeur",
] as const;

export const LIGHTING_OPTIONS = [
  "Golden hour",
  "Natural",
  "Dramatic",
  "Night",
  "Soft",
  "Backlit",
  "Silhouette",
  "Volumetric",
] as const;

export const MOTION_OPTIONS = [
  "Slow pan",
  "Static",
  "Zoom in",
  "Zoom out",
  "Tracking",
] as const;

export const EMOTION_OPTIONS = [
  "Joy",
  "Nostalgia",
  "Love",
  "Pride",
  "Wonder",
  "Calm",
  "Excitement",
  "Gratitude",
] as const;

export const TONE_OPTIONS = ["warm", "cinematic", "playful", "quiet"] as const;

export type LocalizedLabels = {
  camera: Record<string, string>;
  lighting: Record<string, string>;
  motion: Record<string, string>;
  emotion: Record<string, string>;
  tone: Record<string, string>;
};

const LABELS: Record<Language, LocalizedLabels> = {
  en: {
    camera: {
      Wide: "Wide",
      "Extreme Wide": "Extreme Wide",
      Medium: "Medium",
      "Close-up": "Close-up",
      "Extreme Close-up": "Extreme Close-up",
      Aerial: "Aerial",
      Overhead: "Overhead",
      POV: "POV",
      "Low Angle": "Low Angle",
      Telephoto: "Telephoto",
      Voyeur: "Voyeur",
    },
    lighting: {
      "Golden hour": "Golden hour",
      Natural: "Natural",
      Dramatic: "Dramatic",
      Night: "Night",
      Soft: "Soft",
      Backlit: "Backlit",
      Silhouette: "Silhouette",
      Volumetric: "Volumetric",
    },
    motion: {
      "Slow pan": "Slow pan",
      Static: "Static",
      "Zoom in": "Zoom in",
      "Zoom out": "Zoom out",
      Tracking: "Tracking",
    },
    emotion: {
      Joy: "Joy",
      Nostalgia: "Nostalgia",
      Love: "Love",
      Pride: "Pride",
      Wonder: "Wonder",
      Calm: "Calm",
      Excitement: "Excitement",
      Gratitude: "Gratitude",
    },
    tone: {
      warm: "Warm",
      cinematic: "Cinematic",
      playful: "Playful",
      quiet: "Quiet",
    },
  },
  ja: {
    camera: {
      Wide: "ワイド",
      "Extreme Wide": "超ワイド",
      Medium: "ミディアム",
      "Close-up": "アップ",
      "Extreme Close-up": "超クローズアップ",
      Aerial: "空撮",
      Overhead: "真上",
      POV: "POV(主観)",
      "Low Angle": "ローアングル",
      Telephoto: "望遠",
      Voyeur: "群衆越し",
    },
    lighting: {
      "Golden hour": "ゴールデンアワー",
      Natural: "自然光",
      Dramatic: "ドラマチック",
      Night: "夜景",
      Soft: "ソフト",
      Backlit: "逆光",
      Silhouette: "シルエット",
      Volumetric: "ボリューム光",
    },
    motion: {
      "Slow pan": "ゆっくりパン",
      Static: "静止",
      "Zoom in": "ズームイン",
      "Zoom out": "ズームアウト",
      Tracking: "追従",
    },
    emotion: {
      Joy: "喜び",
      Nostalgia: "懐かしさ",
      Love: "愛情",
      Pride: "誇り",
      Wonder: "驚き",
      Calm: "穏やか",
      Excitement: "高揚",
      Gratitude: "感謝",
    },
    tone: {
      warm: "温かい",
      cinematic: "映画的",
      playful: "陽気",
      quiet: "静か",
    },
  },
};

export function getLocalizedLabels(language: Language): LocalizedLabels {
  return LABELS[language] ?? LABELS.en;
}
