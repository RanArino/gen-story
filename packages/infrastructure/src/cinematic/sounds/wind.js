// Trusted local procedural sound; adapted from the supplied prototype.
export default {
  manifest: { id: "wind", version: "1.0.0", kind: "bed", bus: "ambience" },
  create(api, p) {
    const c = api.ctx,
      bp = api.bq("bandpass", p.center, 0.5),
      lp = api.bq("lowpass", 1500, 0.4);
    const base = c.createGain();
    base.gain.value = 0;
    const mod = c.createGain();
    mod.gain.value = 1;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.09;
    const lg = c.createGain();
    lg.gain.value = 0.35;
    lfo.connect(lg);
    lg.connect(mod.gain);
    lfo.start(0);
    const lfo2 = c.createOscillator();
    lfo2.frequency.value = 0.05;
    const lg2 = c.createGain();
    lg2.gain.value = 220;
    lfo2.connect(lg2);
    lg2.connect(bp.frequency);
    lfo2.start(0);
    api.loopNoise().connect(bp);
    bp.connect(lp);
    lp.connect(base);
    base.connect(mod);
    api.out(mod, 0.25, 1);
    return { gain: base.gain };
  },
};
