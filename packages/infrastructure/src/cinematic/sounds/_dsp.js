// Trusted local procedural sound; adapted from the supplied prototype.
export function tone(api, when, f0, f1, dur, gain) {
  const c = api.ctx,
    o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(f0, when);
  o.frequency.exponentialRampToValueAtTime(f1, when + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), when + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0005, when + dur);
  o.connect(g);
  api.out(g, 0.3, 0.9);
  o.start(when);
  o.stop(when + dur + 0.05);
}
export function burst(api, when, dur, freq, q, gain, r) {
  const c = api.ctx,
    s = c.createBufferSource();
  s.buffer = api.noise;
  const bp = api.bq("bandpass", freq, q),
    g = c.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), when + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0005, when + dur);
  s.connect(bp);
  bp.connect(g);
  api.out(g, 0.25, 0.85);
  s.start(when, r() * 1.5, dur + 0.05);
}

export const floorGain = (g) => Math.max(g, 0.0002);
