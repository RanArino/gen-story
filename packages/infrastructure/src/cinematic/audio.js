// Offline procedural score, ambience, Foley and mixing. No network or provider calls.
import { curve, rngFor } from "./math.js";

function makeNoise(c, r, sec) {
  const len = Math.floor(c.sampleRate * sec),
    b = c.createBuffer(1, len, c.sampleRate),
    d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
  return b;
}

function makeIR(c, r, sec, decay) {
  const len = Math.floor(c.sampleRate * sec),
    b = c.createBuffer(2, len, c.sampleRate),
    chs = [];
  let energy = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += (r() * 2 - 1 - lp) * 0.33;
      d[i] = lp * Math.pow(1 - i / len, decay);
      energy += d[i] * d[i];
    }
    chs.push(d);
  }
  const k = 0.5 / Math.sqrt(energy / 2);
  chs.forEach((d) => {
    for (let i = 0; i < len; i++) d[i] *= k;
  });
  return b;
}

export class AudioHost {
  constructor(tl, ctx, sounds) {
    this.tl = tl;
    this.ctx = ctx;
    this.sounds = sounds;
    this.events = tl.events;
    this.nextIdx = 0;
    this.lastUpdate = 0;
    this.persist = new Map();
    this.apis = {};
    this.init();
  }

  init() {
    const c = this.ctx,
      seed = this.tl.seed,
      mx = this.tl.mix;
    this.muteG = c.createGain();
    this.master = c.createGain();
    this.master.gain.value = 0.0001;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.02;
    comp.release.value = 0.35;
    this.dry = c.createGain();
    this.verb = c.createConvolver();
    this.verb.normalize = false;
    this.verb.buffer = makeIR(
      c,
      rngFor(seed, 901),
      mx.reverb.seconds,
      mx.reverb.decay,
    );
    const wet = c.createGain();
    wet.gain.value = mx.reverb.wet;
    this.verb.connect(wet);
    this.dry.connect(this.master);
    wet.connect(this.master);
    this.master.connect(comp);
    comp.connect(this.muteG);
    this.muteG.connect(c.destination);
    this.noise = makeNoise(c, rngFor(seed, 900), 3);
    this.buses = {};
    for (const [name, level] of Object.entries(mx.buses)) {
      const d = c.createGain();
      d.gain.value = level;
      d.connect(this.dry);
      const w = c.createGain();
      w.gain.value = level;
      w.connect(this.verb);
      this.buses[name] = { dry: d, wet: w };
    }
    this.beds = this.tl.beds.map((b) => {
      const m = this.mod(b.sound),
        inst = m.create(
          this.api(m.manifest.bus),
          b.params,
          rngFor(seed, b.salt),
        );
      return { name: b.name, curve: b.curve, gain: inst.gain };
    });
  }

  mod(id) {
    const m = this.sounds[id];
    if (!m) throw new Error(`Sound module "${id}" is unavailable`);
    return m;
  }

  api(busName) {
    if (this.apis[busName]) return this.apis[busName];
    const c = this.ctx,
      bus = this.buses[busName] || this.buses.sfx;
    return (this.apis[busName] = {
      ctx: c,
      noise: this.noise,
      out(node, send = 0, dry = 1) {
        const d = c.createGain();
        d.gain.value = dry;
        node.connect(d);
        d.connect(bus.dry);
        if (send > 0) {
          const s = c.createGain();
          s.gain.value = send;
          node.connect(s);
          s.connect(bus.wet);
        }
      },
      bq(type, f, q = 1) {
        const b = c.createBiquadFilter();
        b.type = type;
        b.frequency.value = f;
        b.Q.value = q;
        return b;
      },
      loopNoise: () => {
        const s = c.createBufferSource();
        s.buffer = this.noise;
        s.loop = true;
        s.start(0);
        return s;
      },

      persistent: (key, make) => {
        const k = busName + ":" + key;
        if (!this.persist.has(k)) this.persist.set(k, make());
        return this.persist.get(k);
      },
    });
  }

  fire(e, when, params = e.params) {
    const m = this.mod(e.sound),
      h = m.play(
        this.api(m.manifest.bus),
        when,
        params,
        rngFor(this.tl.seed, 1000 + e.i),
      );
    void h;
  }

  automateBeds(total, step = 0.1) {
    for (const b of this.beds) b.gain.setValueAtTime(0, 0);
    this.master.gain.setValueAtTime(0.0001, 0);
    for (let t = step; t <= total + 1e-6; t += step) {
      for (const b of this.beds)
        b.gain.linearRampToValueAtTime(curve(b.curve, t), t);
      this.master.gain.linearRampToValueAtTime(
        Math.max(0.0001, curve(this.tl.master, t)),
        t,
      );
    }
  }

  static async renderOffline(
    tl,
    sounds,
    {
      sampleRate = 44100,
      tail = 4,
      OfflineCtor = globalThis.OfflineAudioContext,
    } = {},
  ) {
    const total = tl.duration + tail;
    const ctx = new OfflineCtor(2, Math.ceil(total * sampleRate), sampleRate);
    const host = new AudioHost(tl, ctx, sounds);
    for (const e of host.events) host.fire(e, e.t);
    host.automateBeds(total);
    return ctx.startRendering();
  }
}

export function audioBufferToWav(buf) {
  const nCh = buf.numberOfChannels,
    len = buf.length,
    sr = buf.sampleRate,
    bytes = len * nCh * 2;
  const ab = new ArrayBuffer(44 + bytes),
    v = new DataView(ab);
  const w = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + bytes, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nCh, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * nCh * 2, true);
  v.setUint16(32, nCh * 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, bytes, true);
  const chs = Array.from({ length: nCh }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++)
    for (let c = 0; c < nCh; c++) {
      const s = Math.max(-1, Math.min(1, chs[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  return ab;
}
