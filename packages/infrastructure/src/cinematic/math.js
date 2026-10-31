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
export function frameForImage(vw, vh, cam, width, height) {
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
