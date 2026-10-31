// Trusted offline synthesis entry point; callers submit validated data only.
import { AudioHost, audioBufferToWav } from "./audio.js";
import pad from "./sounds/pad.js";
import koto from "./sounds/koto-pluck.js";
import footstep from "./sounds/footstep.js";
import wind from "./sounds/wind.js";
import stream from "./sounds/stream.js";
import bird from "./sounds/bird-chirp.js";
import suzu from "./sounds/suzu.js";
import clap from "./sounds/clap.js";
import bell from "./sounds/temple-bell.js";
import swell from "./sounds/low-swell.js";
const sounds = Object.fromEntries(
  [pad, koto, footstep, wind, stream, bird, suzu, clap, bell, swell].map(
    (m) => [m.manifest.id, m],
  ),
);
export async function synthesize(score) {
  const output = {};
  for (const name of ["music", "stem"]) {
    const copy = structuredClone(score);
    for (const bus of Object.keys(copy.mix.buses))
      if ((bus === "music") !== (name === "music")) copy.mix.buses[bus] = 0;
    const audio = await AudioHost.renderOffline(copy, sounds, {
      sampleRate: 48000,
    });
    const bytes = new Uint8Array(audioBufferToWav(audio)),
      chunks = [];
    for (let i = 0; i < bytes.length; i += 32768)
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
    output[name] = btoa(chunks.join(""));
  }
  return output;
}
