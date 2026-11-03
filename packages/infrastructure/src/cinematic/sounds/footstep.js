// Trusted local procedural sound; adapted from the supplied prototype.
import { tone, burst } from "./_dsp.js";
export default {
  manifest: { id: "footstep", version: "1.0.0", kind: "oneshot", bus: "foley" },
  play(api, when, p, r) {
    const k = p.gain;
    if (p.surface === "gravel") {
      for (let i = 0; i < 4; i++)
        burst(
          api,
          when + i * 0.022 + r() * 0.01,
          0.05 + r() * 0.03,
          1300 + r() * 900,
          0.8,
          0.2 * (1 - i * 0.17) * k,
          r,
        );
      tone(api, when, 95, 55, 0.09, 0.1 * k);
    } else if (p.surface === "stone") {
      burst(api, when, 0.03, 2300, 1.2, 0.1 * k, r);
      tone(api, when, 320, 150, 0.1, 0.16 * k);
      burst(api, when + 0.03, 0.04, 1500, 0.9, 0.07 * k, r);
    } else {
      tone(api, when, 430, 190, 0.08, 0.18 * k);
      burst(api, when, 0.04, 3000, 1, 0.1 * k, r);
      tone(api, when, 120, 70, 0.12, 0.08 * k);
    }
  },
};
