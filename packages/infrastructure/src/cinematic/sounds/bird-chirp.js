// Trusted local procedural sound; adapted from the supplied prototype.
import { floorGain } from "./_dsp.js";
export default {
  manifest: {
    id: "bird-chirp",
    version: "1.0.0",
    kind: "oneshot",
    bus: "ambience",
  },

  scatter(p, r) {
    return {
      f: p.freq[0] + (p.freq[1] - p.freq[0]) * r(),
      n: p.count[0] + Math.floor(r() * (p.count[1] - p.count[0] + 1)),
      pan: r() * 1.6 - 0.8,
    };
  },
  play(api, when, p, r) {
    const c = api.ctx,
      f = p.f ?? p.freq[0],
      n = p.n ?? p.count[0],
      pan = p.pan ?? 0;
    for (let i = 0; i < n; i++) {
      const w = when + i * (0.17 + r() * 0.06),
        ff = f * (1 + (r() - 0.5) * 0.12);
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(ff, w);
      o.frequency.exponentialRampToValueAtTime(ff * 1.4, w + 0.06);
      o.frequency.exponentialRampToValueAtTime(ff * 0.92, w + 0.12);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, w);
      g.gain.exponentialRampToValueAtTime(floorGain(0.032 * p.gain), w + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0005, w + 0.13);
      o.connect(g);
      let last = g;
      if (c.createStereoPanner) {
        const pn = c.createStereoPanner();
        pn.pan.value = pan;
        g.connect(pn);
        last = pn;
      }
      api.out(last, 0.8, 0.6);
      o.start(w);
      o.stop(w + 0.16);
    }
  },
};
