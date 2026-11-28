// Trusted Canvas effects, adapted from the supplied prototype into the shared production painter.
import {
  clamp01,
  smooth,
  curve,
  camAt,
  frameForImage,
  paperCardFrame,
  paperCardBox,
  paperNoteFrame,
  photoBox,
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

function paperTexture(seed) {
  return sprite(384, (ctx, size) => {
    const random = rngFor(seed, 56);
    ctx.fillStyle = "#e9dfcb";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 11000; i++) {
      ctx.fillStyle = i % 2 ? "#6a503b" : "#fff9eb";
      ctx.globalAlpha = 0.025 + random() * 0.12;
      ctx.fillRect(random() * size, random() * size, 0.4 + random() * 1.7, 0.7);
    }
  });
}

/** The caption a Memory Board card carries: the first one that starts during its scene. */
function cardCaption(data, index) {
  return data.captions.find(
    (c) => data.scenes.findLastIndex((scene) => scene.t0 <= c.t0) === index,
  );
}

function noteFace(data, aliases) {
  const serif = `"${aliases.serif}"`;
  return data.captionStyle?.font === "sans"
    ? `"${aliases.sans}", ${serif}`
    : serif;
}

function drawPaperCards(ctx, data, t, W, H, image, paper, omit, aliases) {
  const notes =
    data.captionStyle?.position === "note" && !omit.includes("caption");
  ctx.fillStyle = ctx.createPattern(paper, "repeat");
  ctx.fillRect(0, 0, W, H);
  for (const [i, scene] of data.scenes.entries()) {
    if (t < scene.t0 || t >= scene.t1) continue;
    const previous = data.scenes[i - 1];
    const next = data.scenes[i + 1];
    const overlap = previous ? Math.max(0, previous.t1 - scene.t0) : 0;
    const slide = data.transition === "card-slide" && overlap > 0;
    const progress = slide ? clamp01((t - scene.t0) / overlap) : 1;
    const nextOverlap = next ? Math.max(0, scene.t1 - next.t0) : 0;
    const nextProgress =
      nextOverlap > 0 ? clamp01((t - next.t0) / nextOverlap) : 0;
    const slidesOut = data.transition === "card-slide" && nextOverlap > 0;
    const opacity =
      data.reducedMotion && data.transition === "card-slide"
        ? (slide && progress < 0.5) || (slidesOut && nextProgress >= 0.5)
          ? 0
          : 1
        : (slide ? 1 : smooth((t - scene.t0) / scene.fadeIn)) *
          (slidesOut
            ? 1 - smooth((nextProgress - 0.8) / 0.2)
            : 1 - smooth((t - scene.t1 + scene.fadeOut) / scene.fadeOut));
    if (opacity <= 0.001) continue;
    const asset = data.assets[scene.image];
    const source = image(asset.asset);
    if (!source) throw new Error("Missing cinematic source " + asset.asset);
    const camera = camAt(scene, data.reducedMotion ? scene.t0 : t);
    if (scene.frame) {
      const card = paperCardBox(W, H, scene.frame.photo, i);
      const fill = frameForImage(
        card.width,
        card.height,
        camera,
        asset.widthPx,
        asset.heightPx,
      );
      const offset = data.reducedMotion ? 0 : W * 1.08 * (1 - smooth(progress));
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.translate(card.x + offset, card.y);
      ctx.rotate(card.rotation);
      ctx.shadowColor = "rgba(51,37,25,0.42)";
      ctx.shadowBlur = card.border * 1.55;
      ctx.shadowOffsetY = card.border * 0.45;
      ctx.fillStyle = "#fff9ee";
      ctx.fillRect(
        -card.outerWidth / 2,
        -card.outerHeight / 2,
        card.outerWidth,
        card.outerHeight,
      );
      ctx.shadowColor = "transparent";
      ctx.beginPath();
      ctx.rect(-card.width / 2, -card.height / 2, card.width, card.height);
      ctx.clip();
      ctx.drawImage(
        source,
        -card.width / 2 + fill.left,
        -card.height / 2 + fill.top,
        fill.width,
        fill.height,
      );
      ctx.restore();
      continue;
    }
    const card = paperCardFrame(
      W,
      H,
      camera,
      asset.widthPx,
      asset.heightPx,
      i,
      notes
        ? noteInput(ctx, cardCaption(data, i), noteFace(data, aliases))
        : null,
    );
    const offset = data.reducedMotion ? 0 : W * 1.08 * (1 - smooth(progress));
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(card.x + offset, card.y);
    ctx.rotate(card.rotation);
    ctx.shadowColor = "rgba(51,37,25,0.42)";
    ctx.shadowBlur = card.border * 1.55;
    ctx.shadowOffsetY = card.border * 0.45;
    ctx.fillStyle = "#fff9ee";
    ctx.fillRect(
      -card.width / 2 - card.border,
      -card.height / 2 - card.border,
      card.width + card.border * 2,
      card.height + card.border * 2,
    );
    ctx.shadowColor = "transparent";
    ctx.drawImage(
      source,
      -card.width / 2,
      -card.height / 2,
      card.width,
      card.height,
    );
    ctx.restore();
  }
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
    saved = {
      W,
      H,
      fx,
      paper: data.layout === "paper-cards" ? paperTexture(data.seed) : null,
    };
    cache.set(data, saved);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (saved.paper)
    drawPaperCards(ctx, data, t, W, H, image, saved.paper, omitRoles, aliases);
  else
    for (const scene of data.scenes) {
      const opacity = sceneOpacity(scene, t);
      if (opacity <= 0.001) continue;
      const c = camAt(scene, data.reducedMotion ? scene.t0 : t);
      const dx = data.reducedMotion
          ? 0
          : Math.sin(t * 0.37 + scene.t0) * 0.0025,
        dy = data.reducedMotion ? 0 : Math.cos(t * 0.29 + scene.t0) * 0.002;
      const asset = data.assets[scene.image];
      if (scene.frame) {
        const box = photoBox(W, H, scene.frame.photo);
        const source = image(asset.asset);
        if (!source) throw new Error("Missing cinematic source " + asset.asset);
        ctx.save();
        ctx.globalAlpha = opacity;
        if (
          box.left > 0.5 ||
          box.top > 0.5 ||
          box.left + box.width < W - 0.5 ||
          box.top + box.height < H - 0.5
        ) {
          const background = frameForImage(
            W,
            H,
            { fx: 0.5, fy: 0.5, z: 1.1 },
            asset.widthPx,
            asset.heightPx,
          );
          ctx.save();
          ctx.filter = `blur(${(24 * H) / 1080}px) brightness(0.4)`;
          ctx.drawImage(
            source,
            background.left,
            background.top,
            background.width,
            background.height,
          );
          ctx.restore();
        }
        const fill = frameForImage(
          box.width,
          box.height,
          { fx: c.fx + dx, fy: c.fy + dy, z: c.z },
          asset.widthPx,
          asset.heightPx,
        );
        ctx.beginPath();
        ctx.rect(box.left, box.top, box.width, box.height);
        ctx.clip();
        ctx.drawImage(
          source,
          box.left + fill.left,
          box.top +
            fill.top +
            bobAt(data.steps, t, scene.bob, data.reducedMotion) * (H / 900),
          fill.width,
          fill.height,
        );
        ctx.restore();
        continue;
      }
      const f = frameForImage(
        W,
        H,
        { fx: c.fx + dx, fy: c.fy + dy, z: c.z },
        asset.widthPx,
        asset.heightPx,
        scene.framing,
      );
      const source = image(asset.asset);
      if (!source) throw new Error("Missing cinematic source " + asset.asset);
      ctx.save();
      ctx.globalAlpha = opacity;
      if (scene.framing === "contain" || scene.framing === "follow") {
        const background = frameForImage(
          W,
          H,
          { fx: 0.5, fy: 0.5, z: 1.1 },
          asset.widthPx,
          asset.heightPx,
        );
        ctx.save();
        ctx.filter = `blur(${(24 * H) / 1080}px) brightness(0.4)`;
        ctx.drawImage(
          source,
          background.left,
          background.top,
          background.width,
          background.height,
        );
        ctx.restore();
      }
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

/** Caption text for a Memory Board note, measured in the caller's canvas units. */
function noteInput(ctx, caption, face) {
  if (!caption || !(caption.text || caption.sub)) return null;
  return {
    text: caption.text,
    sub: caption.sub,
    measure: (value, size) => {
      ctx.save();
      ctx.font = `400 ${size}px ${face}`;
      const width = ctx.measureText(value).width;
      ctx.restore();
      return width;
    },
  };
}

function drawCopy(ctx, d, t, W, H, omit, aliases) {
  // Uniform scale: landscape keeps the 1280x720 reference layout exactly. Portrait and square
  // frames use a narrower logical canvas (800 / 1000 wide) so captions stay readable on phones.
  const scale =
      W / H >= 16 / 9 - 0.01
        ? Math.min(W / 1280, H / 720)
        : W / (H > W ? 800 : 1000),
    measurements = [],
    scaleX = scale,
    scaleY = scale;
  let role = "caption";
  ctx.save();
  ctx.scale(scale, scale);
  W = W / scale;
  H = H / scale;
  const latin = `"${aliases.latin}", "${aliases.serif}"`,
    serif = `"${aliases.serif}"`;
  const note = d.captionStyle?.position === "note";
  const captionFace =
    d.captionStyle?.font === "sans" ? `"${aliases.sans}", ${serif}` : null;
  const titleInk = d.layout === "paper-cards" ? "#45372c" : "#f4efe4";
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
      font +
      " " +
      size +
      "px " +
      ((role === "caption" && captionFace) ||
        (font.startsWith("italic") ? latin : serif));
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.letterSpacing = spacing + "px";
    if (glow) {
      ctx.shadowColor = "rgba(233,196,106,.28)";
      ctx.shadowBlur = 60;
    } else if (role === "caption" && !note) {
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
  if (!omit.includes("caption") && note && visible.length) {
    const c = visible.at(-1);
    const a = smooth((t - c.t0) / 0.35) * (1 - smooth((t - c.t1 + 0.3) / 0.3));
    const cardIndex = d.scenes.findLastIndex((scene) => scene.t0 <= c.t0);
    const scene = d.scenes[cardIndex];
    const photo = d.assets[scene.image];
    const face = noteFace(d, aliases);
    const box = scene.frame
      ? paperNoteFrame(
          W,
          H,
          scene.frame.caption,
          noteInput(ctx, c, face),
          paperCardBox(W, H, scene.frame.photo, cardIndex).outerWidth,
        )
      : paperCardFrame(
          W,
          H,
          camAt(scene, d.reducedMotion ? scene.t0 : t),
          photo.widthPx,
          photo.heightPx,
          cardIndex,
          noteInput(ctx, c, face),
        ).note;
    if (box) {
      ctx.save();
      ctx.translate(box.x, box.y);
      ctx.rotate(box.rotation);
      ctx.globalAlpha = a;
      ctx.fillStyle = "#fff6cf";
      ctx.shadowColor = "rgba(64,45,22,0.25)";
      ctx.shadowBlur = box.size * 0.3;
      ctx.shadowOffsetY = box.size * 0.1;
      ctx.fillRect(-box.width / 2, -box.height / 2, box.width, box.height);
      ctx.shadowColor = "transparent";
      ctx.fillStyle = "rgba(176,151,101,0.34)";
      ctx.fillRect(
        -box.size * 0.8,
        -box.height / 2 - box.size * 0.22,
        box.size * 1.6,
        box.size * 0.44,
      );
      ctx.restore();
      // Lines stay upright (the paper tilts only 1.4°) so measured boxes stay axis-aligned.
      let y = box.y - box.height / 2 + box.padY;
      const lines = [
        ...box.main.map((line) => [line, box.size, "#403629"]),
        ...box.sub.map((line) => [line, box.subSize, "#524535"]),
      ];
      lines.forEach(([line, size, color], i) => {
        if (i === box.main.length && i > 0) y += box.gapLines;
        y += (size * box.lineHeight) / 2;
        text(line, box.x, y, size, "400", a, color);
        y += (size * box.lineHeight) / 2;
      });
    }
  } else if (!omit.includes("caption") && !note) {
    // A photo with a frame places its caption (top edge, size); older directions keep 0.8 H.
    const unit = Math.min(W, H);
    const placeOf = (c) =>
      c.mid
        ? null
        : (d.scenes[d.scenes.findLastIndex((s) => s.t0 <= c.t0)]?.frame
            ?.caption ?? null);
    let a = 0;
    for (const c of visible)
      if (!c.mid)
        a = Math.max(
          a,
          smooth((t - c.t0) / 0.6) * (1 - smooth((t - (c.t1 - 1.1)) / 1.1)),
        );
    const anchor = visible.map(placeOf).find(Boolean);
    // The scrim darkens the frame edge nearest the caption.
    const top = anchor ? anchor.y * H : H * 0.54;
    const bottom = anchor ? top + anchor.size * unit * 3.2 : H;
    const low = (top + bottom) / 2 >= H / 2;
    const from = low ? H : 0,
      to = anchor
        ? low
          ? Math.max(0, top - H * 0.22)
          : Math.min(H, bottom + H * 0.22)
        : H * 0.54;
    const g = ctx.createLinearGradient(0, from, 0, to);
    g.addColorStop(0, "rgba(0,0,0,.66)");
    g.addColorStop(0.55, "rgba(0,0,0,.28)");
    g.addColorStop(1, "transparent");
    ctx.save();
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.min(from, to), W, Math.abs(to - from));
    ctx.restore();
    for (const c of visible) {
      const place = placeOf(c);
      const a =
          smooth((t - c.t0) / 0.6) * (1 - smooth((t - (c.t1 - 1.1)) / 1.1)),
        // Caption sizes follow the 1280-wide reference, not the logical canvas width.
        size = place
          ? place.size * unit
          : Math.max(
              17.6,
              Math.min(1280 * (c.mid ? 0.03 : 0.026), c.mid ? 43.2 : 36.8),
            ),
        subSize = place
          ? size * 0.58
          : Math.max(12.8, Math.min(1280 * 0.015, 19.2));
      ctx.font = "italic 400 " + size + "px " + latin;
      const space = ctx.measureText(" ").width;
      // Text without spaces (Japanese) breaks by character when it is wider than the frame.
      const words = c.text.split(" ").flatMap((word) => {
        if (ctx.measureText(word).width <= W * 0.86) return [word];
        const parts = [""];
        for (const ch of word) {
          if (
            parts.at(-1) &&
            ctx.measureText(parts.at(-1) + ch).width > W * 0.86
          )
            parts.push("");
          parts[parts.length - 1] += ch;
        }
        return parts;
      });
      // Wrap the word-revealed line within the frame; the last line keeps the original baseline.
      const lines = [[]];
      let lineWidth = 0;
      for (const word of words) {
        const w = ctx.measureText(word).width;
        if (lines.at(-1).length && lineWidth + space + w > W * 0.86) {
          lines.push([]);
          lineWidth = 0;
        }
        lineWidth += (lines.at(-1).length ? space : 0) + w;
        lines.at(-1).push(word);
      }
      const widthOf = (line) =>
        line.reduce((n, w) => n + ctx.measureText(w).width, 0) +
        space * (line.length - 1);
      let cx = W / 2,
        y = c.mid ? H * 0.48 : H * 0.8;
      if (place) {
        const widest = Math.max(...lines.map(widthOf));
        const edge = W * 0.03;
        cx = Math.min(
          W - edge - widest / 2,
          Math.max(edge + widest / 2, place.x * W),
        );
        y = place.y * H + size * 0.65 + (lines.length - 1) * size * 1.3;
        const end = y + (c.sub ? size * 1.5 + subSize * 0.6 : size * 0.5);
        if (end > H * 0.97) y -= end - H * 0.97;
      }
      let index = 0;
      lines.forEach((line, row) => {
        const ly = y - (lines.length - 1 - row) * size * 1.3;
        let x = cx - widthOf(line) / 2;
        for (const word of line) {
          const wa = smooth((t - c.t0 - index++ * 0.11) / 0.9);
          text(
            word,
            x,
            ly + (1 - wa) * size * 0.35 * (d.reducedMotion ? 0 : 1),
            size,
            "italic 400",
            a * wa,
            "#f4efe4",
            "left",
          );
          x += ctx.measureText(word).width + space;
        }
      });
      text(
        c.sub,
        cx,
        y + size * 1.5,
        subSize,
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
        titleInk,
        "center",
        ending ? 28.3 : 54.4,
        !ending && d.layout !== "paper-cards",
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
