// Trusted local procedural sound; adapted from the supplied prototype.
export default {
  manifest: { id: "stream", version: "1.0.0", kind: "bed", bus: "ambience" },
  create(api, p) {
    const c = api.ctx,
      hp = api.bq("highpass", 900, 0.7),
      bp = api.bq("bandpass", 2600, 0.7);
    const base = c.createGain();
    base.gain.value = 0;
    const mod = c.createGain();
    mod.gain.value = 1;
    [4.3, 7.1, 11.7].forEach((f) => {
      const o = c.createOscillator();
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = 0.22;
      o.connect(g);
      g.connect(mod.gain);
      o.start(0);
    });
    api.loopNoise().connect(hp);
    hp.connect(bp);
    bp.connect(base);
    base.connect(mod);
    if (c.createStereoPanner) {
      const pn = c.createStereoPanner();
      pn.pan.value = p.pan;
      mod.connect(pn);
      api.out(pn, 0.2, 1);
    } else api.out(mod, 0.2, 1);
    return { gain: base.gain };
  },
};
