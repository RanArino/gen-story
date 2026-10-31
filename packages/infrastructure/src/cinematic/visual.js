// Trusted Canvas effects, adapted from the supplied prototype into the shared production painter.
import {
  clamp01,
  smooth,
  curve,
  camAt,
  frameForImage,
  bobAt,
  sceneOpacity,
  showAlpha,
  rngFor,
  buildTau,
  tauAt,
} from "./math.js";
const cache = new WeakMap();
const renderOverlay = (ctx, canvas, W, H, blend, alpha) => {
  ctx.save();
  ctx.globalCompositeOperation = blend;
  ctx.globalAlpha = alpha;
  if (blend === "overlay") ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, W, H);
  ctx.restore();
};
const sprite = (size, draw) => {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  return c;
};
const wrapR = (v, lo, hi) => {
  const s = hi - lo;
  return ((((v - lo) % s) + s) % s) + lo;
};

function buildParticles(o, r) {
  const motes = Array.from({ length: o.motes }, () => ({
    x: r(),
    y: r(),
    vx: (r() - 0.5) * 0.012 - 0.006,
    vy: -(0.004 + r() * 0.016),
    r: 2 + r() * 7,
    ph: r() * 6.28,
    tw: 0.4 + r() * 1.2,
    a: 0.25 + r() * 0.6,
  }));
  const leaves = Array.from({ length: o.leaves }, () => {
    const d = r(),
      top = r() < 0.6;
    const xs = top ? r() * 1.3 : 1.08,
      ys = top ? -0.08 : r() * 0.8;
    const vx = -(0.018 + r() * 0.04) * (0.6 + d),
      vy = 0.035 + r() * 0.05 + d * 0.04;
    const L = Math.min((1.12 - ys) / vy, (xs + 0.12) / -vx);
    return {
      xs,
      ys,
      vx,
      vy,
      L,
      off: r() * L,
      rot: r() * 6.28,
      spin: (r() - 0.5) * 2.2,
      flip: r() * 6.28,
      fs: 1 + r() * 2,
      sway: r() * 6.28,
      sa: 0.01 + r() * 0.02,
      s: 7 + d * d * 20,
      c: Math.floor(r() * o.leafColors.length),
      near: d > 0.78,
    };
  });
  return { motes, leaves };
}
const moteAt = (m, tau) => ({
  x: wrapR(m.x + m.vx * tau + 0.012 * Math.sin(0.3 * tau + m.ph), -0.05, 1.05),
  y: wrapR(m.y + m.vy * tau, -0.05, 1.05),
});
function leafAt(l, tau) {
  const s = (((tau + l.off) % l.L) + l.L) % l.L;
  return {
    x: l.xs + l.vx * s + (l.sa / 0.9) * Math.sin(l.sway + 0.9 * s),
    y: l.ys + l.vy * s,
    rot: l.rot + l.spin * s,
    flip: l.flip + l.fs * s,
  };
}

function createAtmosphere(ctx) {
  const { timeline: tl, options: o, reduced } = ctx;
  const h = (tag, cls) => {
    const e = document.createElement(tag);
    e.className = cls;
    return e;
  };
  const lc = h("canvas", "sd-layer sd-light"),
    lx = lc.getContext("2d");
  const fc = h("canvas", "sd-layer"),
    fx = fc.getContext("2d");
  const gc = h("canvas", "sd-layer sd-grain");
  gc.width = 200;
  gc.height = 112;
  gc.style.opacity = o.grain;
  const gx = gc.getContext("2d"),
    gimg = gx.createImageData(200, 112);

  const P = buildParticles(o, ctx.rng(3));
  const tau = buildTau(ctx.points("speed"), tl.duration, {
    gust: (t) => 1 + 0.6 * Math.pow(Math.sin(t * 0.31), 2),
  });

  const flashes = [];
  for (let i = 1; i < tl.scenes.length; i++) {
    const a = tl.scenes[i - 1],
      b = tl.scenes[i];
    if (b.t0 < a.t1) flashes.push((b.t0 + a.t1) / 2);
  }

  const moteSprite = sprite(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, "rgba(255,244,214,1)");
    r.addColorStop(0.22, "rgba(255,228,165,.6)");
    r.addColorStop(1, "rgba(255,210,130,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
  const leafPath = (g, ox) => {
    g.beginPath();
    g.moveTo(-18 + ox, 0);
    g.quadraticCurveTo(ox, -11, 18 + ox, 0);
    g.quadraticCurveTo(ox, 11, -18 + ox, 0);
    g.closePath();
  };
  const leafSharp = o.leafColors.map((c) =>
    sprite(64, (g, s) => {
      g.translate(s / 2, s / 2);
      leafPath(g, 0);
      g.fillStyle = c;
      g.fill();
      g.strokeStyle = "rgba(60,70,20,.55)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-17, 0);
      g.lineTo(16, 0);
      g.stroke();
    }),
  );
  const leafSoft = o.leafColors.map((c) =>
    sprite(64, (g, s) => {
      g.translate(s / 2, s / 2);
      g.shadowColor = c;
      g.shadowBlur = 9;
      g.shadowOffsetX = 200;
      leafPath(g, -200);
      g.fillStyle = c;
      g.fill();
    }),
  );

  let vh = 1,
    dpr = 1,
    grainKey = -1;
  const [lr, lg, lb] = o.light,
    rc = reduced ? 0 : 1;

  function drawLight(t) {
    const motionTime = reduced ? 0 : t;
    const w = lc.width,
      hh = lc.height;
    lx.clearRect(0, 0, w, hh);
    const I = ctx.param("rays", t);
    if (I < 0.01) return;
    lx.globalCompositeOperation = "lighter";
    const sx = w * 1.08,
      sy = -hh * 0.12,
      len = Math.hypot(w, hh) * 1.4,
      n = o.rays;
    for (let i = 0; i < n; i++) {
      const u = i - (n - 1) / 2,
        ang = 2.12 + u * 0.105 + rc * Math.sin(t * 0.07 + i) * 0.03,
        wid = 0.03 + (i % 3) * 0.014;
      const al =
        I *
        (0.1 + 0.1 * rc * Math.sin(t * 0.23 + i * 1.9)) *
        (0.6 + 0.4 * rc * Math.sin(t * 0.11 + i * 0.7));
      const g = lx.createLinearGradient(
        sx,
        sy,
        sx + Math.cos(ang) * len,
        sy + Math.sin(ang) * len,
      );
      g.addColorStop(0, `rgba(${lr},${lg},${lb},${al})`);
      g.addColorStop(0.7, `rgba(${lr},${lg},${lb},${al * 0.35})`);
      g.addColorStop(1, `rgba(${lr},${lg},${lb},0)`);
      lx.fillStyle = g;
      lx.beginPath();
      lx.moveTo(sx, sy);
      lx.lineTo(sx + Math.cos(ang - wid) * len, sy + Math.sin(ang - wid) * len);
      lx.lineTo(sx + Math.cos(ang + wid) * len, sy + Math.sin(ang + wid) * len);
      lx.closePath();
      lx.fill();
    }
    for (let i = 0; i < 10; i++) {
      const px =
          ((((i * 0.173 + motionTime * (0.004 + (i % 4) * 0.0015)) % 1.3) +
            1.3) %
            1.3) -
          0.15,
        py = 0.25 + ((i * 0.311) % 0.7),
        r = w * (0.09 + 0.05 * ((i * 7) % 3));
      const a = 0.07 * I * (0.5 + 0.5 * rc * Math.sin(t * 0.5 + i * 2));
      const g = lx.createRadialGradient(px * w, py * hh, 0, px * w, py * hh, r);
      g.addColorStop(0, `rgba(${lr},${lg},${lb},${a})`);
      g.addColorStop(1, `rgba(${lr},${lg},${lb},0)`);
      lx.fillStyle = g;
      lx.fillRect(px * w - r, py * hh - r, r * 2, r * 2);
    }
  }
  function drawFX(t) {
    const motionTime = reduced ? 0 : t;
    const W = fc.width,
      H = fc.height;
    fx.clearRect(0, 0, W, H);
    const mI = ctx.param("motes", t),
      lI = ctx.param("leaves", t),
      u = (vh / 900) * dpr;
    const tb = tauAt(tau, tau.base, motionTime),
      tg = tauAt(tau, tau.gusty, motionTime);
    fx.globalCompositeOperation = "lighter";
    if (mI > 0.01)
      for (const m of P.motes) {
        const p = moteAt(m, tb),
          a = clamp01(
            m.a * (0.55 + 0.45 * Math.sin(motionTime * m.tw + m.ph)) * mI,
          );
        if (a < 0.01) continue;
        fx.globalAlpha = a;
        const s = m.r * u * 1.5;
        fx.drawImage(moteSprite, p.x * W - s, p.y * H - s, s * 2, s * 2);
      }
    fx.globalCompositeOperation = "source-over";
    if (!reduced && lI > 0.01)
      for (const l of P.leaves) {
        const p = leafAt(l, tg),
          a = lI * (l.near ? 0.5 : 0.85);
        if (p.x < -0.1 || p.x > 1.15 || p.y < -0.1 || p.y > 1.15) continue;
        const s = l.s * u * 1.2,
          sp = (l.near ? leafSoft : leafSharp)[l.c];
        fx.save();
        fx.globalAlpha = a;
        fx.translate(p.x * W, p.y * H);
        fx.rotate(p.rot);
        fx.scale(1, 0.12 + 0.88 * Math.abs(Math.cos(p.flip)));
        fx.drawImage(sp, -s, -s, s * 2, s * 2);
        fx.restore();
      }
    fx.globalAlpha = 1;
  }
  function drawGrain(t) {
    if (reduced || o.grain <= 0) return;
    const key = Math.floor(t * 12);
    if (key === grainKey) return;
    grainKey = key;
    const r = ctx.rng(5000 + key),
      d = gimg.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (r() * 255) | 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    gx.putImageData(gimg, 0, 0);
  }

  return {
    resize({ width, height, dpr: d }) {
      vh = height;
      dpr = d;
      fc.width = Math.round(width * dpr);
      fc.height = Math.round(height * dpr);
      lc.width = Math.ceil(width / 4);
      lc.height = Math.ceil(height / 4);
    },
    render(t) {
      drawLight(t);
      drawFX(t);
      drawGrain(t);
    },
    compose(target, W, H, t) {
      renderOverlay(target, lc, W, H, "screen", 1);
      renderOverlay(target, fc, W, H, "source-over", 1);
      const wash = (color, mode, alpha) => {
        target.save();
        target.globalCompositeOperation = mode;
        target.globalAlpha = alpha;
        target.fillStyle = color;
        target.fillRect(0, 0, W, H);
        target.restore();
      };
      wash(o.coolWash, "color", ctx.param("cool", t));
      wash(o.warmWash, "soft-light", ctx.param("warm", t));
      let flash = 0;
      for (const m of flashes)
        flash += o.transitionGlow * Math.exp(-Math.pow((t - m) / 1.1, 2));
      target.save();
      target.globalCompositeOperation = "screen";
      target.globalAlpha = clamp01(ctx.param("bloom", t) + flash);
      target.translate(W * 0.9, -H * 0.1);
      target.scale(W * 1.2, H * 0.95);
      let g = target.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, "rgba(255,238,196,.95)");
      g.addColorStop(0.38, "rgba(255,214,150,.38)");
      g.addColorStop(0.72, "transparent");
      target.fillStyle = g;
      target.fillRect(-2, -2, 4, 4);
      target.restore();
      target.save();
      target.globalAlpha = ctx.param("vignette", t);
      target.translate(W * 0.5, H * 0.46);
      target.scale(W, H);
      g = target.createRadialGradient(0, 0, 0, 0, 0, 0.74);
      g.addColorStop(0.36, "transparent");
      g.addColorStop(0.76, "rgba(0,0,0,.55)");
      g.addColorStop(1, "rgba(0,0,0,.94)");
      target.fillStyle = g;
      target.fillRect(-1, -1, 2, 2);
      target.restore();
      if (!reduced) renderOverlay(target, gc, W, H, "overlay", o.grain);
    },
  };
}

/** Data-only primitive; it has no player, UI, network loading, or independent rendering loop. */
export function drawCinematic(
  ctx,
  data,
  timeMs,
  width,
  height,
  image,
  omitRoles = [],
  aliases,
) {
  const t = timeMs / 1000,
    W = width,
    H = height;
  let saved = cache.get(data);
  if (!saved || saved.W !== W || saved.H !== H) {
    const fx = createAtmosphere({
      layer: document.createElement("div"),
      timeline: data,
      options: data.options,
      reduced: data.reducedMotion,
      param: (name, time) =>
        curve(data.params[name], time, name === "speed" ? 1 : 0),
      points: (name) => data.params[name],
      rng: (salt) => rngFor(data.seed, salt),
    });
    fx.resize({ width: W, height: H, dpr: 1 });
    saved = { W, H, fx };
    cache.set(data, saved);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  for (const scene of data.scenes) {
    const opacity = sceneOpacity(scene, t);
    if (opacity <= 0.001) continue;
    const c = camAt(scene, data.reducedMotion ? scene.t0 : t);
    const dx = data.reducedMotion ? 0 : Math.sin(t * 0.37 + scene.t0) * 0.0025,
      dy = data.reducedMotion ? 0 : Math.cos(t * 0.29 + scene.t0) * 0.002;
    const asset = data.assets[scene.image];
    const f = frameForImage(
      W,
      H,
      { fx: c.fx + dx, fy: c.fy + dy, z: c.z },
      asset.widthPx,
      asset.heightPx,
    );
    const source = image(asset.asset);
    if (!source) throw new Error("Missing cinematic source " + asset.asset);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(
      source,
      f.left,
      f.top + bobAt(data.steps, t, scene.bob, data.reducedMotion) * (H / 900),
      f.width,
      f.height,
    );
    ctx.restore();
  }
  saved.fx.render(t);
  saved.fx.compose(ctx, W, H, t);
  const measurements = drawCopy(ctx, data, t, W, H, omitRoles, aliases);
  ctx.restore();
  return measurements;
}

function drawCopy(ctx, d, t, W, H, omit, aliases) {
  const measurements = [],
    scaleX = W / 1280,
    scaleY = H / 720;
  let role = "caption";
  ctx.save();
  ctx.scale(W / 1280, H / 720);
  W = 1280;
  H = 720;
  const latin = `"${aliases.latin}", "${aliases.serif}"`,
    serif = `"${aliases.serif}"`;
  function text(
    value,
    x,
    y,
    size,
    font,
    alpha = 1,
    color = "#f4efe4",
    align = "center",
    spacing = 0,
    glow = false,
  ) {
    if (!value || alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font =
      font + " " + size + "px " + (font.startsWith("italic") ? latin : serif);
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.letterSpacing = spacing + "px";
    if (glow) {
      ctx.shadowColor = "rgba(233,196,106,.28)";
      ctx.shadowBlur = 60;
    } else if (role === "caption") {
      ctx.shadowColor = "rgba(0,0,0,.55)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 2;
    }
    ctx.fillText(value, x, y, W * 0.84);
    const m = ctx.measureText(value),
      width = Math.min(m.width, W * 0.84);
    if (alpha > 0.01)
      measurements.push({
        role,
        text: value,
        color,
        box: {
          x: (x - (align === "center" ? width / 2 : 0)) * scaleX,
          y: (y - (m.actualBoundingBoxAscent ?? size * 0.8)) * scaleY,
          w: width * scaleX,
          h:
            ((m.actualBoundingBoxAscent ?? size * 0.8) +
              (m.actualBoundingBoxDescent ?? size * 0.2)) *
            scaleY,
        },
      });
    ctx.restore();
  }
  const visible = d.captions.filter((c) => t >= c.t0 && t <= c.t1);
  if (!omit.includes("caption")) {
    let a = 0;
    for (const c of visible)
      if (!c.mid)
        a = Math.max(
          a,
          smooth((t - c.t0) / 0.6) * (1 - smooth((t - (c.t1 - 1.1)) / 1.1)),
        );
    const g = ctx.createLinearGradient(0, H, 0, H * 0.54);
    g.addColorStop(0, "rgba(0,0,0,.66)");
    g.addColorStop(0.55, "rgba(0,0,0,.28)");
    g.addColorStop(1, "transparent");
    ctx.save();
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.54, W, H * 0.46);
    ctx.restore();
    for (const c of visible) {
      const a =
          smooth((t - c.t0) / 0.6) * (1 - smooth((t - (c.t1 - 1.1)) / 1.1)),
        size = Math.max(
          17.6,
          Math.min(W * (c.mid ? 0.03 : 0.026), c.mid ? 43.2 : 36.8),
        );
      const y = c.mid ? H * 0.48 : H * 0.8;
      const words = c.text.split(" ");
      ctx.font = "italic 400 " + size + "px " + latin;
      const space = ctx.measureText(" ").width;
      let x =
        (W -
          words.reduce((n, w) => n + ctx.measureText(w).width, 0) -
          space * (words.length - 1)) /
        2;
      for (let i = 0; i < words.length; i++) {
        const wa = smooth((t - c.t0 - i * 0.11) / 0.9);
        text(
          words[i],
          x,
          y + (1 - wa) * size * 0.35 * (d.reducedMotion ? 0 : 1),
          size,
          "italic 400",
          a * wa,
          "#f4efe4",
          "left",
        );
        x += ctx.measureText(words[i]).width + space;
      }
      text(
        c.sub,
        W / 2,
        y + size * 1.5,
        Math.max(12.8, Math.min(W * 0.015, 19.2)),
        "400",
        a * smooth((t - c.t0 - 0.7) / 1.1),
        "#c4bfb5",
        "center",
        2,
      );
    }
  }
  if (!omit.includes("title")) {
    role = "title";
    for (const slate of d.slates) {
      const a = showAlpha(slate.show, t);
      ctx.save();
      ctx.globalAlpha = a * 0.7;
      ctx.strokeStyle = "#e9c46a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W * 0.06, H * 0.08);
      ctx.lineTo(W * 0.06, H * 0.17);
      ctx.stroke();
      ctx.restore();
      text(
        slate.display,
        W * 0.075,
        H * 0.095,
        Math.min(W * 0.019, 24),
        "500",
        a,
        "#f4efe4",
        "left",
        2.5,
      );
      text(
        slate.text,
        W * 0.075,
        H * 0.13,
        Math.min(W * 0.014, 17.6),
        "italic 400",
        a * 0.74,
        "#f4efe4",
        "left",
      );
    }
    const card = (c, ending) => {
      if (!c) return;
      const a = showAlpha(c.show, t);
      const y = ending ? H * 0.4 : H * 0.39;
      text(
        c.display,
        W / 2,
        y,
        ending ? Math.min(W * 0.08, 83.2) : Math.min(W * 0.15, 160),
        "500",
        a,
        "#f4efe4",
        "center",
        ending ? 28.3 : 54.4,
        !ending,
      );
      text(
        c.name,
        W / 2,
        y + (ending ? 55 : 90),
        ending ? 25.6 : 35.2,
        "italic 300",
        a,
        "#e9c46a",
        "center",
        6,
      );
      text(c.tagline, W / 2, y + 145, 20.8, "italic 300", a * 0.74);
      text(
        c.taglineSub,
        W / 2,
        y + 175,
        15.2,
        "400",
        a * 0.6,
        "#f4efe4",
        "center",
        3,
      );
      let lineY = y + 105;
      for (const line of c.lines ?? []) {
        for (const part of line.split("\n")) {
          text(part, W / 2, lineY, 18.4, "italic 300", a * 0.74);
          lineY += 31;
        }
      }
      text(
        c.footer,
        W / 2,
        lineY + 5,
        15.2,
        "400",
        a * 0.74,
        "#f4efe4",
        "center",
        3,
      );
    };
    card(d.titleCard, false);
    card(d.credits, true);
  }
  ctx.restore();
  return measurements;
}
