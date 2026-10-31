import { describe, expect, it } from "vitest";
import { verifyReferenceMedia, type ReferenceMediaEvidence } from "./verify.js";
const evidence = (): ReferenceMediaEvidence => ({
  expectedSeconds: 103,
  durationSeconds: 103,
  video: { codec: "h264", width: 1280, height: 720, fps: "30/1", frames: 3090 },
  audio: {
    codec: "aac",
    sampleRate: 48000,
    channels: 2,
    integratedLufs: -18,
    truePeakDb: -1.5,
  },
});
describe("reference integrity gate", () => {
  it("accepts full correctly encoded reference evidence", () =>
    expect(() => verifyReferenceMedia(evidence())).not.toThrow());
  it("rejects an excerpt passed off as a full reference", () => {
    const value = evidence();
    value.durationSeconds = 2;
    expect(() => verifyReferenceMedia(value)).toThrow(/duration/);
  });
  it("rejects missing frames even if container duration matches", () => {
    const value = evidence();
    value.video.frames = 60;
    expect(() => verifyReferenceMedia(value)).toThrow(/video/);
  });
  it("rejects silent or unmeasurable audio", () => {
    const value = evidence();
    value.audio.integratedLufs = -Infinity;
    expect(() => verifyReferenceMedia(value)).toThrow(/silent/);
  });
  it("rejects audio with no true-peak headroom", () => {
    const value = evidence();
    value.audio.truePeakDb = 0.2;
    expect(() => verifyReferenceMedia(value)).toThrow(/headroom/);
  });
});
