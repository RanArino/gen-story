// Deterministic cinematic math, adapted from the supplied Film Studio prototype.
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeIO = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

export const round6 = (x) => Math.round(x * 1e6) / 1e6;

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngFor = (seed, salt) =>
  mulberry32((seed >>> 0) ^ Math.imul(salt + 1, 0x9e3779b1));

export function curve(pts, t, dflt = 0) {
  if (!pts || !pts.length) return dflt;
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const a = pts[i - 1],
        b = pts[i];
      return lerp(a[1], b[1], smooth((t - a[0]) / (b[0] - a[0] || 1e-9)));
    }
  }
  return pts[pts.length - 1][1];
}

export function camAt(sc, t) {
  const p = clamp01((t - sc.t0) / (sc.t1 - sc.t0));
  const e = lerp(p, easeIO(p), 0.45);
  const k = sc.camera;
  let i = 0;
  while (i < k.length - 2 && e > k[i + 1].p) i++;
  const a = k[i],
    b = k[i + 1];
  const u = clamp01((e - a.p) / (b.p - a.p || 1e-9)),
    s = lerp(u, smooth(u), 0.5);
  return {
    fx: lerp(a.fx, b.fx, s),
    fy: lerp(a.fy, b.fy, s),
    z: a.z * Math.pow(b.z / a.z, s),
  };
}

export function frameFor(vw, vh, cam, m = 6) {
  const B = Math.max(vw, vh),
    S = B * cam.z;
  let left = vw / 2 - cam.fx * S,
    top = vh / 2 - cam.fy * S;
  const loX = vw - S + m,
    loY = vh - S + m;
  left = loX > -m ? (vw - S) / 2 : Math.min(-m, Math.max(loX, left));
  top = loY > -m ? (vh - S) / 2 : Math.min(-m, Math.max(loY, top));
  return { left, top, B, S };
}

export function visibleRect(vw, vh, cam) {
  const f = frameFor(vw, vh, cam);
  return {
    x0: -f.left / f.S,
    y0: -f.top / f.S,
    x1: (vw - f.left) / f.S,
    y1: (vh - f.top) / f.S,
  };
}
export function sceneOpacity(sc, t) {
  if (t < sc.t0 || t > sc.t1) return 0;
  return (
    smooth((t - sc.t0) / sc.fadeIn) *
    (1 - smooth((t - (sc.t1 - sc.fadeOut)) / sc.fadeOut))
  );
}

export function showAlpha(show, t) {
  const a = smooth((t - show.in) / show.fadeIn);
  return show.out == null
    ? a
    : a * (1 - smooth((t - show.out) / (show.fadeOut ?? 1)));
}

export function bobAt(steps, t, amp, reduced = false) {
  if (!amp || reduced) return 0;
  let last = null;
  for (const s of steps) {
    if (s.t <= t) last = s;
    else break;
  }
  if (!last) return 0;
  const dt = t - last.t;
  return dt > 0.7 ? 0 : Math.sin(clamp01(dt / 0.7) * Math.PI) * amp;
}

export function buildTau(
  speedPts,
  duration,
  { step = 0.05, gust = null } = {},
) {
  const n = Math.ceil(duration / step) + 4;
  const base = new Float32Array(n),
    gusty = new Float32Array(n);
  let a = 0,
    b = 0;
  for (let i = 1; i < n; i++) {
    const t = i * step,
      s = curve(speedPts, t, 1);
    a += s * step;
    b += s * step * (gust ? gust(t) : 1);
    base[i] = a;
    gusty[i] = b;
  }
  return { step, base, gusty };
}
export function tauAt(tab, arr, t) {
  const x = Math.max(0, t) / tab.step,
    i = Math.min(arr.length - 2, Math.floor(x));
  return lerp(arr[i], arr[i + 1], x - i);
}

/** Preserve arbitrary source aspect ratios while covering the output viewport. */
export function frameForImage(vw, vh, cam, width, height, framing) {
  if (framing === "follow") {
    // z = 1 shows the whole photo; beyond that the camera keeps the focus point centered
    // until an image edge reaches the frame, so moves can travel without cropping at rest.
    const scale = Math.min(vw / width, vh / height) * 0.94 * Math.max(1, cam.z);
    const W = width * scale,
      H = height * scale;
    const place = (viewport, size, focus) =>
      size <= viewport
        ? (viewport - size) / 2
        : Math.min(0, Math.max(viewport - size, viewport / 2 - focus * size));
    return {
      left: place(vw, W, cam.fx),
      top: place(vh, H, cam.fy),
      width: W,
      height: H,
    };
  }
  if (framing === "contain") {
    const scale =
      Math.min(vw / width, vh / height) * Math.min(0.98, 0.88 * cam.z);
    const W = width * scale,
      H = height * scale;
    return {
      left: (vw - W) * clamp01(cam.fx),
      top: (vh - H) * clamp01(cam.fy),
      width: W,
      height: H,
    };
  }
  if (width === height) {
    const f = frameFor(vw, vh, cam);
    return { left: f.left, top: f.top, width: f.S, height: f.S };
  }
  const scale = Math.max(vw / width, vh / height) * cam.z,
    W = width * scale,
    H = height * scale;
  const place = (viewport, size, focus) =>
    size - viewport < 12
      ? (viewport - size) / 2
      : Math.min(
          -6,
          Math.max(viewport - size + 6, viewport / 2 - focus * size),
        );
  return {
    left: place(vw, W, cam.fx),
    top: place(vh, H, cam.fy),
    width: W,
    height: H,
  };
}

const PHI = (1 + Math.sqrt(5)) / 2;
// Characters that must not begin a line, and short hiragana (particles) that stay with the word before.
const NO_LINE_START =
  /^[、。，．,.!?！？)）」』】〉》ー〜ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ]/;
const PARTICLE = /^[\u3041-\u309f]{1,2}$/;
const BREAK_AFTER = /[、。，．,.!?！？:;：；]$/;

function wrapTokens(text) {
  if (/\s/.test(text)) return { tokens: text.split(/\s+/), sep: " " };
  const parts =
    typeof Intl !== "undefined" && Intl.Segmenter
      ? Array.from(
          new Intl.Segmenter("ja", { granularity: "word" }).segment(text),
          (s) => s.segment,
        )
      : Array.from(text);
  const tokens = [];
  for (const part of parts)
    if (tokens.length && (NO_LINE_START.test(part) || PARTICLE.test(part)))
      tokens[tokens.length - 1] += part;
    else tokens.push(part);
  return { tokens, sep: "" };
}

/**
 * Wraps `text` into the fewest lines no wider than `maxWidth`, then evens their widths so a
 * caption never ends in a stray word. Japanese breaks between words and prefers breaking
 * after punctuation; `measure` returns a string's width in the caller's units.
 */
export function wrapBalanced(text, maxWidth, measure, maxLines = 3) {
  text = (text ?? "").trim().replace(/\s+/g, " ");
  if (!text) return [];
  if (measure(text) <= maxWidth) return [text];
  const { tokens, sep } = wrapTokens(text);
  const line = (i, j) => tokens.slice(i, j).join(sep);
  const n = tokens.length;
  for (let lines = 2; lines <= Math.min(maxLines, n); lines++) {
    const mean = measure(text) / lines;
    // best[k][j]: cheapest way to set tokens 0..j as k lines.
    const best = Array.from({ length: lines + 1 }, () =>
      new Array(n + 1).fill(null),
    );
    best[0][0] = { cost: 0, from: -1 };
    for (let k = 1; k <= lines; k++)
      for (let j = 1; j <= n; j++)
        for (let i = k - 1; i < j; i++) {
          const prev = best[k - 1][i];
          if (!prev) continue;
          const width = measure(line(i, j));
          if (width > maxWidth) continue;
          const plain =
            j < n && !sep && !BREAK_AFTER.test(tokens[j - 1]) ? 0.15 : 0;
          const cost = prev.cost + ((width - mean) / mean) ** 2 + plain;
          if (!best[k][j] || cost < best[k][j].cost)
            best[k][j] = { cost, from: i };
        }
    if (!best[lines][n]) continue;
    const out = [];
    for (let k = lines, j = n; k > 0; k--) {
      const i = best[k][j].from;
      out.unshift(line(i, j));
      j = i;
    }
    return out;
  }
  // Too long for maxLines: fill lines greedily, splitting any token wider than the line.
  const out = [""];
  for (const token of tokens)
    for (const piece of measure(token) > maxWidth
      ? Array.from(token)
      : [token]) {
      const next = out[out.length - 1]
        ? out[out.length - 1] + sep + piece
        : piece;
      if (out[out.length - 1] && measure(next) > maxWidth) out.push(piece);
      else out[out.length - 1] = next;
    }
  return out;
}

/**
 * Memory Board placement of photo card `index` and its caption note, in the caller's units.
 * Portrait and square frames set the note below the card, clear of the tilted print; landscape
 * frames let the note's top 38.2% (1/φ²) overlap the card's lower edge. The card's lower edge
 * sits on the golden section line (H/φ) when the group fits, and the note is never narrower
 * than card/φ. The camera zoom is reserved in advance, so the group stays inside the safe margin
 * as the card grows. `note.measure(text, size)` measures text.
 */
export function paperCardFrame(
  W,
  H,
  camera,
  imageWidth,
  imageHeight,
  index,
  note = null,
) {
  const unit = Math.min(W, H);
  const margin = unit * 0.08;
  const border = unit * 0.017;
  const stacked = W / H < 1.2;
  const maxZoom = 1.075;
  const zoom = 1 + Math.min(maxZoom - 1, Math.max(0, camera.z - 1) * 0.09);
  const rotation =
    (((rngFor(index, 49)() - 0.5) * 2.6 + (index % 2 ? 1.4 : -1.4)) * Math.PI) /
    180;
  const noteRotation = -0.025;
  const size = unit * 0.037,
    subSize = size * 0.75,
    lineHeight = 1.4,
    padX = size * 0.9,
    padY = size * 0.55,
    gapLines = size * 0.3;
  const maxCardWidth = W - margin * 2;
  const hasNote = Boolean(note && (note.text || note.sub));
  const overlap = 1 / PHI ** 2;
  let card = null,
    copy = null;
  // Two passes: the note wraps to the card width, and the card makes room for the note.
  for (let pass = 0, noteWidthLimit = maxCardWidth; pass < 2; pass++) {
    if (hasNote) {
      const textWidth = noteWidthLimit - padX * 2;
      const main = wrapBalanced(note.text, textWidth, (t) =>
        note.measure(t, size),
      );
      const sub = wrapBalanced(note.sub, textWidth, (t) =>
        note.measure(t, subSize),
      );
      const widest = Math.max(
        0,
        ...main.map((t) => note.measure(t, size)),
        ...sub.map((t) => note.measure(t, subSize)),
      );
      copy = {
        main,
        sub,
        width: widest + padX * 2,
        height:
          padY * 2 +
          main.length * size * lineHeight +
          (main.length && sub.length ? gapLines : 0) +
          sub.length * subSize * lineHeight,
      };
    }
    const noteHeight = copy ? copy.height : 0;
    const clearance = copy
      ? border * 2.2 +
        (maxCardWidth / 2) * Math.abs(Math.sin(rotation)) +
        (copy.width / 2) * Math.abs(Math.sin(noteRotation))
      : 0;
    const below = copy
      ? stacked
        ? clearance + noteHeight
        : noteHeight * (1 - overlap)
      : 0;
    const maxCardHeight = (H - margin * 2 - below) / maxZoom;
    const scale = Math.min(
      (maxCardWidth - border * 2) / imageWidth,
      (maxCardHeight - border * 2) / imageHeight,
    );
    card = {
      width: imageWidth * scale,
      height: imageHeight * scale,
      outerWidth: imageWidth * scale + border * 2,
      outerHeight: imageHeight * scale + border * 2,
      below,
      clearance,
    };
    noteWidthLimit = Math.max(card.outerWidth, maxCardWidth / PHI);
  }
  // The seam between photo and note sits on the golden section line (H/φ) when the group fits;
  // otherwise the group is pulled back inside the margin, leaving room for the camera zoom.
  const grow = ((maxZoom - 1) * card.outerHeight) / 2;
  const lowest = margin + grow;
  const highest = H - margin - card.below - card.outerHeight - grow * 2;
  const top = Math.max(lowest, Math.min(highest, H / PHI - card.outerHeight));
  const x = W / 2 + (0.5 - camera.fx) * unit * 0.065;
  const y = top + card.outerHeight / 2 + (0.5 - camera.fy) * unit * 0.05;
  const width = card.width * zoom,
    height = card.height * zoom;
  const frame = { x, y, width, height, border, rotation };
  if (!copy) return frame;
  const noteWidth = Math.min(
    Math.max(copy.width, card.outerWidth / PHI),
    Math.max(card.outerWidth, maxCardWidth / PHI),
  );
  const cardBottom = y + height / 2 + border;
  return {
    ...frame,
    note: {
      x,
      y: stacked
        ? cardBottom + card.clearance + copy.height / 2
        : cardBottom - copy.height * overlap + copy.height / 2,
      width: noteWidth,
      height: copy.height,
      rotation: noteRotation,
      main: copy.main,
      sub: copy.sub,
      size,
      subSize,
      lineHeight,
      gapLines,
      padY,
    },
  };
}

/** A frame-fraction photo box in the caller's units (center, size and top-left corner). */
export function photoBox(W, H, box) {
  let width = box.width * W,
    height = box.height * H;
  // A chosen crop keeps its shape at every video size: the width sets the size.
  const ratio = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 }[box.crop];
  if (ratio) {
    height = width / ratio;
    if (height > H) {
      height = H;
      width = H * ratio;
    }
  }
  return {
    x: box.x * W,
    y: box.y * H,
    width,
    height,
    left: box.x * W - width / 2,
    top: box.y * H - height / 2,
  };
}

/**
 * Memory Board card for a user-placed photo box: the box is the card's outer edge, the photo
 * fills the inside (`width` × `height`), and the tilt is seeded by the photo's position.
 */
export function paperCardBox(W, H, box, index) {
  const b = photoBox(W, H, box);
  const border = Math.min(W, H) * 0.017;
  return {
    x: b.x,
    y: b.y,
    width: Math.max(1, b.width - border * 2),
    height: Math.max(1, b.height - border * 2),
    outerWidth: b.width,
    outerHeight: b.height,
    border,
    rotation:
      (((rngFor(index, 49)() - 0.5) * 2.6 + (index % 2 ? 1.4 : -1.4)) *
        Math.PI) /
      180,
  };
}

/**
 * The paper note for a caption placed by the user: `place.x` is the note's center, `place.y` its
 * top edge and `place.size` the main font size (fractions of the frame). Text wraps to the card
 * width (at least the frame's golden section) and the note stays inside the frame.
 */
export function paperNoteFrame(W, H, place, note, cardWidth = 0) {
  if (!note || !(note.text || note.sub)) return null;
  const unit = Math.min(W, H);
  const size = place.size * unit,
    subSize = size * 0.75,
    lineHeight = 1.4,
    padX = size * 0.9,
    padY = size * 0.55,
    gapLines = size * 0.3,
    margin = unit * 0.03;
  const maxWidth = W - margin * 2;
  const textWidth =
    Math.min(maxWidth, Math.max(cardWidth, maxWidth / PHI)) - padX * 2;
  const main = wrapBalanced(note.text, textWidth, (t) => note.measure(t, size));
  const sub = wrapBalanced(note.sub, textWidth, (t) =>
    note.measure(t, subSize),
  );
  const widest = Math.max(
    0,
    ...main.map((t) => note.measure(t, size)),
    ...sub.map((t) => note.measure(t, subSize)),
  );
  const width = Math.min(
    maxWidth,
    Math.max(widest + padX * 2, cardWidth / PHI),
  );
  const height =
    padY * 2 +
    main.length * size * lineHeight +
    (main.length && sub.length ? gapLines : 0) +
    sub.length * subSize * lineHeight;
  const within = (v, lo, hi) =>
    lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
  const x = within(place.x * W, margin + width / 2, W - margin - width / 2);
  const top = within(place.y * H, margin, H - margin - height);
  return {
    x,
    y: top + height / 2,
    width,
    height,
    rotation: -0.025,
    main,
    sub,
    size,
    subSize,
    lineHeight,
    gapLines,
    padY,
  };
}
