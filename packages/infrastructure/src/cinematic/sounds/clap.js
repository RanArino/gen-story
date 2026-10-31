// Trusted local procedural sound; adapted from the supplied prototype.
import { tone, floorGain } from "./_dsp.js";
export default {
  manifest: { id: "clap", version: "1.0.0", kind: "oneshot", bus: "sfx" },
  play(api, when, p, r) {
    const c = api.ctx,
      v = p.gain,
      s = c.createBufferSource();
    s.buffer = api.noise;
    const bp = api.bq("bandpass", 1700, 0.8),
      hp = api.bq("highpass", 500, 0.7),
      g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(floorGain(v), when + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
    s.connect(bp);
    bp.connect(hp);
    hp.connect(g);
    api.out(g, 0.95, 0.7);
    s.start(when, r() * 1.5, 0.2);
    tone(api, when, 420, 180, 0.05, v * 0.5);
  },
};
