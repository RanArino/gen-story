import { burst, tone } from "./_dsp.js";

function noiseEnvelope(api, when, freq, q, envelope, gain, random) {
  const source = api.ctx.createBufferSource();
  source.buffer = api.noise;
  source.loop = true;
  const band = api.bq("bandpass", freq, q);
  const level = api.ctx.createGain();
  level.gain.setValueAtTime(0, when);
  for (const [time, amplitude] of envelope) {
    level.gain.linearRampToValueAtTime(gain * amplitude, when + time);
  }
  source.connect(band);
  band.connect(level);
  api.out(level, 0.04);
  source.start(when, random() * api.noise.duration);
  source.stop(when + envelope.at(-1)[0]);
}

const travel = {
  "ocean-wave"(api, when, gain, random) {
    noiseEnvelope(
      api,
      when,
      380,
      0.65,
      [
        [0.35, 0.28],
        [1.05, 1],
        [1.65, 0.65],
        [2.95, 0],
      ],
      gain * 0.21,
      random,
    );
    noiseEnvelope(
      api,
      when,
      2100,
      0.7,
      [
        [0.75, 0.12],
        [1.2, 1],
        [1.4, 0.68],
        [2.55, 0],
      ],
      gain * 0.12,
      random,
    );
  },
  "light-rain"(api, when, gain, random) {
    noiseEnvelope(
      api,
      when,
      3300,
      0.8,
      [
        [0.45, 1],
        [1.95, 0.86],
        [2.65, 0],
      ],
      gain * 0.065,
      random,
    );
    for (let drop = 0; drop < 20; drop++) {
      const t = 0.15 + drop * 0.106 + 0.1 * random();
      const freq = 1300 + 3600 * random();
      burst(api, when + t, 0.025, freq, 3, gain * 0.055, random);
    }
  },
  cicadas(api, when, gain, random) {
    // Two offset calls with short, repeated stridulations.
    for (let call = 0; call < 2; call++) {
      for (let pulse = 0; pulse < 13; pulse++) {
        const t = call * 0.58 + pulse * 0.073;
        const freq = 4400 + call * 680 + random() * 600;
        const strength = Math.sin((Math.PI * (pulse + 1)) / 14);
        burst(api, when + t, 0.066, freq, 10, gain * 0.175 * strength, random);
      }
    }
  },
  "leaf-rustle"(api, when, gain, random) {
    noiseEnvelope(
      api,
      when,
      1700,
      0.9,
      [
        [0.16, 0.68],
        [0.36, 0.24],
        [0.56, 1],
        [0.92, 0.44],
        [1.3, 0],
      ],
      gain * 0.14,
      random,
    );
    for (let leaf = 0; leaf < 7; leaf++) {
      const t = leaf * 0.14 + random() * 0.09;
      burst(
        api,
        when + t,
        0.09,
        2600 + 2300 * random(),
        1.5,
        gain * 0.06,
        random,
      );
    }
  },
  "train-pass"(api, when, gain, random) {
    noiseEnvelope(
      api,
      when,
      148,
      0.8,
      [
        [0.4, 0.14],
        [1.18, 0.85],
        [1.58, 1],
        [2.2, 0.52],
        [3.1, 0],
      ],
      gain * 0.53,
      random,
    );
    noiseEnvelope(
      api,
      when,
      850,
      1.5,
      [
        [0.65, 0.18],
        [1.46, 1],
        [1.94, 0.5],
        [2.95, 0],
      ],
      gain * 0.15,
      random,
    );
    for (let car = 0; car < 6; car++) {
      const t = when + 0.54 + car * 0.35;
      const level = gain * (car === 2 || car === 3 ? 0.21 : 0.11);
      burst(api, t, 0.085, 480, 1.7, level, random);
      burst(api, t + 0.096, 0.077, 750, 2, level * 0.8, random);
    }
  },
  "cafe-cup"(api, when, gain, random) {
    burst(api, when, 0.048, 2500, 1.6, gain * 0.09, random);
    tone(api, when, 1330, 1317, 0.16, gain * 0.09);
    tone(api, when, 2530, 2524, 0.12, gain * 0.045);
    tone(api, when + 0.083, 961, 957, 0.1, gain * 0.044);
  },
  "camera-shutter"(api, when, gain, random) {
    burst(api, when, 0.026, 1470, 1.2, gain * 0.25, random);
    burst(api, when + 0.021, 0.046, 3100, 0.9, gain * 0.18, random);
    burst(api, when + 0.077, 0.033, 940, 1.3, gain * 0.19, random);
  },
  "wind-chime"(api, when, gain) {
    [0, 0.22, 0.57].forEach((offset, strike) => {
      const fundamental = [1175, 1568, 1397][strike];
      tone(api, when + offset, fundamental, fundamental, 0.72, gain * 0.049);
      tone(
        api,
        when + offset,
        fundamental * 2.77,
        fundamental * 2.77,
        0.26,
        gain * 0.029,
      );
    });
  },
};

export default Object.entries(travel).map(([id, play]) => ({
  manifest: { id, version: "1.0.0", kind: "oneshot", bus: "sfx" },
  play(api, when, { gain }, random) {
    if (gain > 0) play(api, when, gain, random);
  },
}));
