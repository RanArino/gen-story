// Trusted local procedural sound; adapted from the supplied prototype.
import { floorGain } from "./_dsp.js";
export default {
  manifest: {
    id: "koto-pluck",
    version: "1.0.0",
    kind: "instrument",
    bus: "music",
  },
  play(api, when, p) {
    const c = api.ctx,
      f = p.freq,
      v = p.vel * p.gain;
    const o1 = c.createOscillator(),
      o2 = c.createOscillator(),
      o3 = c.createOscillator();
    o1.type = "triangle";
    o2.type = "sine";
    o3.type = "square";
    [o1, o2, o3].forEach((o, i) => {
      const m = i + 1;
      o.frequency.setValueAtTime(f * m * 1.014, when);
      o.frequency.exponentialRampToValueAtTime(f * m, when + 0.09);
    });
    const g = c.createGain(),
      g2 = c.createGain(),
      g3 = c.createGain();
    g2.gain.value = 0.32;
    g3.gain.value = 0.025;
    const lp = api.bq("lowpass", 3600, 0.7);
    lp.frequency.setValueAtTime(3600, when);
    lp.frequency.exponentialRampToValueAtTime(600, when + 1.4);
    o1.connect(g);
    o2.connect(g2);
    g2.connect(g);
    o3.connect(g3);
    g3.connect(g);
    g.connect(lp);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, when);
    e.gain.exponentialRampToValueAtTime(floorGain(v * 0.5), when + 0.006);
    e.gain.exponentialRampToValueAtTime(0.0004, when + 2.8);
    lp.connect(e);
    api.out(e, 0.75, 0.8);
    [o1, o2, o3].forEach((o) => {
      o.start(when);
      o.stop(when + 3);
    });
  },
};
