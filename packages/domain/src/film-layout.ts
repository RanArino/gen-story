/**
 * Where the photo and its caption sit in a Film frame. Every value is a fraction of the
 * output frame, so one layout works for 16:9, 9:16 and 1:1; equal width and height
 * fractions give a photo box with the video's own shape.
 */
export interface FilmPhotoBox {
  /** Center, as fractions of the frame width and height. */
  x: number;
  y: number;
  /** Size, as fractions of the frame width and height. */
  width: number;
  height: number;
  /**
   * The photo's crop shape. When set, `width` decides the size and the height follows the
   * shape at every video size; when absent, the box follows the video's own shape.
   */
  crop?: FilmPhotoCrop;
}
export const FILM_PHOTO_CROPS = ["16:9", "9:16", "1:1"] as const;
export type FilmPhotoCrop = (typeof FILM_PHOTO_CROPS)[number];
const CROP_RATIO: Record<FilmPhotoCrop, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
};
export interface FilmCaptionPlace {
  /** Horizontal center of the caption block, as a fraction of the frame width. */
  x: number;
  /** Top edge of the caption block, as a fraction of the frame height. */
  y: number;
  /** Main line font size, as a fraction of the frame's shorter side. */
  size: number;
}
export interface FilmFrameLayout {
  photo: FilmPhotoBox;
  caption: FilmCaptionPlace;
}
/** A user edit: each part replaces the layout below it on its own. */
export interface FilmLayoutOverride {
  photo?: FilmPhotoBox;
  caption?: FilmCaptionPlace;
}

/** Used when a template gives no layout: the photo fills the frame, the caption sits low. */
export const FULL_FRAME_LAYOUT: FilmFrameLayout = {
  photo: { x: 0.5, y: 0.5, width: 1, height: 1 },
  caption: { x: 0.5, y: 0.76, size: 0.045 },
};

export const FILM_LAYOUT_LIMITS = {
  photoSize: [0.1, 1],
  captionSize: [0.015, 0.12],
} as const;

/** Scene override, then Film override, then the template's default, part by part. */
export function resolveFrameLayout(
  base: FilmFrameLayout,
  film?: FilmLayoutOverride,
  scene?: FilmLayoutOverride,
): FilmFrameLayout {
  return {
    photo: scene?.photo ?? film?.photo ?? base.photo,
    caption: scene?.caption ?? film?.caption ?? base.caption,
  };
}

const fraction = (v: unknown, lo = 0, hi = 1) =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

/** Why `value` is not a valid layout override, or null when it is. */
export function layoutOverrideError(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return "A Film layout must be an object.";
  const { photo, caption, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length) return "A Film layout has unknown parts.";
  const [pMin, pMax] = FILM_LAYOUT_LIMITS.photoSize;
  const [cMin, cMax] = FILM_LAYOUT_LIMITS.captionSize;
  if (photo !== undefined) {
    const p = photo as Partial<FilmPhotoBox> | null;
    if (
      !p ||
      !fraction(p.x) ||
      !fraction(p.y) ||
      !fraction(p.width, pMin, pMax) ||
      !fraction(p.height, pMin, pMax)
    )
      return "The photo position or size is outside the frame.";
    if (p.crop !== undefined && !FILM_PHOTO_CROPS.includes(p.crop))
      return "Choose a supported photo crop.";
  }
  if (caption !== undefined) {
    const c = caption as Partial<FilmCaptionPlace> | null;
    if (!c || !fraction(c.x) || !fraction(c.y) || !fraction(c.size, cMin, cMax))
      return "The caption position or size is outside the frame.";
  }
  return null;
}

/** A frame layout map keyed by output size; missing sizes fall back to the full frame. */
export function frameLayoutFor(
  defaults: Partial<Record<string, FilmFrameLayout>> | undefined,
  aspect: string,
): FilmFrameLayout {
  return defaults?.[aspect] ?? FULL_FRAME_LAYOUT;
}

/**
 * The photo box re-cut to `crop` in a `frameWidth` × `frameHeight` video: its shorter side
 * stays as long as it was (a portrait card becomes a square of the same width), then the box
 * shrinks to fit the frame. The center is kept.
 */
export function cropPhotoBox(
  photo: FilmPhotoBox,
  crop: FilmPhotoCrop,
  frameWidth: number,
  frameHeight: number,
): FilmPhotoBox {
  const ratio = CROP_RATIO[crop];
  const short = Math.min(photo.width * frameWidth, photo.height * frameHeight);
  let width = ratio >= 1 ? short * ratio : short;
  let height = width / ratio;
  const fit = Math.min(1, frameWidth / width, frameHeight / height);
  width *= fit;
  height *= fit;
  const [min] = FILM_LAYOUT_LIMITS.photoSize;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    x: photo.x,
    y: photo.y,
    width: round(Math.max(min, width / frameWidth)),
    height: round(Math.max(min, height / frameHeight)),
    crop,
  };
}
