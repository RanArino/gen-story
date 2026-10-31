// Trusted local procedural sound; adapted from the supplied prototype.
import { floorGain } from "./_dsp.js";
export default {
  manifest: { id: "suzu", version: "1.0.0", kind: "oneshot", bus: "sfx" },
  play(api, when, p, r) {
    const c = api.ctx;
    for (let i = 0; i < 14; i++) {
      const w = when + i * 0.045 + r() * 0.03,
        f = 1900 + r() * 2300,
        d = 0.5 + r() * 0.7,
        a = (0.05 + r() * 0.04) * p.gain;
      [
        [1, 1],
        [2.76, 0.35],
      ].forEach(([m, kk]) => {
        const o = c.createOscillator();
        o.type = "sine";
        o.frequency.value = f * m;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, w);
        g.gain.exponentialRampToValueAtTime(floorGain(a * kk), w + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0004, w + d);
        o.connect(g);
        api.out(g, 0.7, 0.6);
        o.start(w);
        o.stop(w + d + 0.05);
      });
    }
  },
};
