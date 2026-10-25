import { describe, expect, it } from "vitest";
import type { AudioEvent } from "../contracts/types.js";
import { bedGraph, stemGraph } from "./audio.js";

const hit: AudioEvent = { asset: "sounds/hit.wav", sha256: `sha256:${"1".repeat(64)}`, startMs: 1250, durationMs: null, gain: 0.6, loop: false, fadeInMs: 0, fadeOutMs: 0 };
const bed: AudioEvent = { asset: "sounds/ambience.wav", sha256: `sha256:${"2".repeat(64)}`, startMs: 0, durationMs: 4000, gain: 0.5, loop: true, fadeInMs: 600, fadeOutMs: 600 };

describe("audio graphs", () => {
  it("renders a Chapter without sound events as exact-length silence", () => {
    const g = stemGraph([], 22000, "/m/", () => 0);
    expect(g.inputs).toEqual(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]);
    expect(g.filter).toContain("apad=whole_dur=22,atrim=0:22[stem]");
  });

  it("trims, fades, gains, and delays each event before mixing", () => {
    const g = stemGraph([bed, hit], 9000, "/m/", (asset) => (asset === "sounds/hit.wav" ? 400 : 120000));
    expect(g.inputs).toEqual(["-stream_loop", "-1", "-i", "/m/sounds/ambience.wav", "-i", "/m/sounds/hit.wav"]);
    expect(g.filter).toContain("atrim=0:4,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.6,afade=t=out:st=3.4:d=0.6,volume=0.5,adelay=0|0[e0]");
    expect(g.filter).toContain("atrim=0:0.4,asetpts=PTS-STARTPTS,volume=0.6,adelay=1250|1250[e1]");
    expect(g.filter).toContain("[e0][e1]amix=inputs=2:normalize=0");
  });

  it("lays the BGM continuously from its offset under stems placed at their starts", () => {
    const bgm = { ...bed, asset: "sounds/bgm.wav", durationMs: 60000, loop: false, gain: 0.8, fadeInMs: 1000, fadeOutMs: 1500, offsetMs: 0 };
    const g = bedGraph({ bgm, runtimeMs: 60000, stems: [{ file: "/c/c1.wav", startMs: 3000 }, { file: "/c/c2.wav", startMs: 37400 }], mediaDir: "/m/", firstInput: 1 });
    expect(g.inputs).toEqual(["-i", "/m/sounds/bgm.wav", "-i", "/c/c1.wav", "-i", "/c/c2.wav"]);
    expect(g.filter).toContain("[1:a]");
    expect(g.filter).toContain("atrim=start=0:duration=60");
    expect(g.filter).toContain("[3:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=37400|37400[s1]");
    expect(g.filter).toContain("[bgm][s0][s1]amix=inputs=3:normalize=0");
  });
});
