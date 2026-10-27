import { mkdirSync } from "node:fs";
import { expect, it } from "vitest";
import { ffmpeg, ffmpegOut } from "../render/ffmpeg.js";
import { tempPaths } from "./state.js";
import { psnr } from "./media.js";

it("compares a selected nonzero video frame to its own PNG at matching timestamps", async () => {
  const paths = tempPaths();
  mkdirSync(paths.out, { recursive: true });
  const file = `${paths.out}sample.mp4`;
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=64x64:r=30:d=4",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-pix_fmt",
    "yuv420p",
    file,
  ]);
  const png = await ffmpegOut([
    "-i",
    file,
    "-vf",
    "select=eq(n\\,90)",
    "-frames:v",
    "1",
    "-c:v",
    "png",
    "-f",
    "image2pipe",
    "-",
  ]);
  expect(await psnr(png, file, 90)).toBe(Infinity);
  expect(await psnr(png, file, 0)).toBeLessThan(35);
}, 30000);
