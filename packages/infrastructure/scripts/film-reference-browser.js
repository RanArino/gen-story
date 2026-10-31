// Browser-only reference driver; loaded locally without TypeScript callback serialization.
import { createFilm } from "/core/player.js";
import { loadFilm } from "/core/load.js";
import { AudioHost, audioBufferToWav } from "/core/audio.js";

let film;
let original;
globalThis.referenceCapture = {
  async load(origin, specPath) {
    const specUrl = `${origin}/${specPath}`;
    original = await (await fetch(specUrl)).json();
    const input = structuredClone(original);
    input.style.theme.fonts = {
      text: "ReferenceLatin",
      display: "ReferenceSerif",
      googleFontsUrl: null,
    };
    await document.fonts.load("400 32px ReferenceSerif");
    await document.fonts.load("400 32px ReferenceLatin");
    film = await createFilm(document.getElementById("film"), input, {
      resolveAsset: (src) => new URL(src, specUrl).href,
      loadFonts: false,
      intro: false,
      ui: false,
      keyboard: false,
    });
    await film.ready;
    const tl = film.timeline;
    return {
      duration: film.duration,
      segments: tl.segments.map(({ id, kind, t0, t1 }) => ({
        id,
        kind,
        t0,
        t1,
      })),
      audioEvents: tl.events,
      beds: tl.beds,
      camera: tl.scenes,
    };
  },
  draw(time) {
    film.renderFrame(time);
  },
  async audio() {
    const { timeline, sounds } = await loadFilm(original);
    const audio = await AudioHost.renderOffline(timeline, sounds, {
      sampleRate: 48000,
    });
    const bytes = new Uint8Array(audioBufferToWav(audio));
    const chunks = [];
    for (let i = 0; i < bytes.length; i += 32768)
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
    await globalThis.saveReferenceAudio(btoa(chunks.join("")));
  },
};
