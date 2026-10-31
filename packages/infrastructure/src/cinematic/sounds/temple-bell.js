// Trusted local procedural sound; adapted from the supplied prototype.
import { floorGain } from "./_dsp.js";
const PARTIALS = [
  [0.5, 0.5, 9],
  [1, 0.9, 8],
  [1.19, 0.45, 6],
  [1.5, 0.3, 5],
  [2, 0.35, 4.5],
  [2.51, 0.18, 3.5],
  [3, 0.15, 3],
  [4.1, 0.08, 2],
];
export default {
  manifest: {
    id: "temple-bell",
    version: "1.0.0",
    kind: "oneshot",
    bus: "sfx",
  },
  play(api, when, p, r) {
    const c = api.ctx;
    PARTIALS.forEach(([m, a, d]) => {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.value = p.pitch * m * (1 + (r() - 0.5) * 0.002);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(
        floorGain(a * 0.13 * p.gain),
        when + 0.012,
      );
      g.gain.exponentialRampToValueAtTime(0.0003, when + d);
      o.connect(g);
      api.out(g, 0.65, 0.8);
      o.start(when);
      o.stop(when + d + 0.1);
    });
  },
};
