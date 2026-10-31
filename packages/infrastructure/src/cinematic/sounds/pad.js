// Trusted local procedural sound; adapted from the supplied prototype.
export default {
  manifest: { id: "pad", version: "1.0.0", kind: "sustain", bus: "music" },

  play(api, when, p, r) {
    const c = api.ctx;
    const bus = api.persistent("pad-bus", () => {
      const g = c.createGain();
      g.gain.value = p.level;
      api.out(g, 0.55, 0.9);
      return g;
    });
    const holdEnd = Math.max(when + p.hold, when + p.fadeIn),
      stopAt = holdEnd + p.fadeOut + 0.1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(1, when + p.fadeIn);
    g.gain.setValueAtTime(1, holdEnd);
    g.gain.linearRampToValueAtTime(0.0001, holdEnd + p.fadeOut);
    const lp = api.bq("lowpass", 900, 0.4);
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07 + r() * 0.05;
    const lg = c.createGain();
    lg.gain.value = 260;
    lfo.connect(lg);
    lg.connect(lp.frequency);
    lfo.start(when);
    lfo.stop(stopAt);
    const per = 0.2 / Math.sqrt(p.freqs.length);
    p.freqs.forEach((f) =>
      [-6, 6].forEach((cent) => {
        const o = c.createOscillator();
        o.type = f < 100 ? "sine" : "triangle";
        o.frequency.value = f;
        o.detune.value = cent;
        const og = c.createGain();
        og.gain.value = per;
        o.connect(og);
        og.connect(lp);
        o.start(when);
        o.stop(stopAt);
      }),
    );
    lp.connect(g);
    g.connect(bus);
  },
};
