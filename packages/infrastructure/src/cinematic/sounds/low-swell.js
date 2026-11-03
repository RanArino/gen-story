// Trusted local procedural sound; adapted from the supplied prototype.
export default {
  manifest: { id: "low-swell", version: "1.0.0", kind: "oneshot", bus: "sfx" },
  play(api, when, p) {
    const c = api.ctx;
    p.freqs.forEach((f, i) => {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime((0.14 / (i + 1)) * p.gain, when + 3);
      g.gain.linearRampToValueAtTime(0.0001, when + 8);
      o.connect(g);
      api.out(g, 0.5, 0.9);
      o.start(when);
      o.stop(when + 8.2);
    });
  },
};
