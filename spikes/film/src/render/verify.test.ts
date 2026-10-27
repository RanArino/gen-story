import { describe, expect, it } from "vitest";
import { PROFILES } from "../compiler/compile.js";
import { tempPaths } from "../testing/state.js";
import { ffmpeg, ffmpegOut, pngEncoder, probe } from "./ffmpeg.js";
import { verifyMp4 } from "./verify.js";
import { mkdirSync } from "node:fs";

it("checks presented audio and container duration, excluding hidden encoder padding", async () => {
  const paths = tempPaths();
  mkdirSync(paths.out, { recursive: true });
  const profile = PROFILES["landscape-1080p30@1"]!;
  const inputs = [
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=1920x1080:r=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
  ];
  const encoding = [
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
  ];
  await ffmpeg([...inputs, ...encoding, "-t", "1", `${paths.out}exact.mp4`]);
  expect(await verifyMp4(`${paths.out}exact.mp4`, 30, profile, 1000)).toEqual(
    [],
  );
  await ffmpeg([
    ...inputs,
    ...encoding,
    "-t",
    "2",
    `${paths.out}long-audio.mp4`,
  ]);
  expect(
    (await verifyMp4(`${paths.out}long-audio.mp4`, 30, profile, 1000))[0]?.code,
  ).toBe("FS_ARTIFACT_VERIFY_FAILED");
}, 30000);

describe("legacy concatenation", () => {
  it("keeps legacy Plans readable", async () => {
    const { readFixture } = await import("../testing/fixtures.js");
    const { validateSchema } = await import("../contracts/schemas.js");
    for (const kind of ["concat-plan", "review-record"])
      expect(
        validateSchema(
          `urn:film-spike:${kind}`,
          readFixture(`legacy/${kind}.json`),
        ),
      ).toEqual([]);
  });
});

it("refuses legacy concatenation rendering without silently upgrading approval", async () => {
  const { readFixture } = await import("../testing/fixtures.js");
  const { writeJson } = await import("../paths.js");
  const { renderConcat } = await import("./concat.js");
  const paths = tempPaths();
  const planFile = `${paths.out}legacy.plan.json`;
  writeJson(planFile, readFixture("legacy/concat-plan.json"));
  await expect(
    renderConcat(
      {
        paths,
        liveEnvironment: () => {
          throw new Error("must refuse before environment or rendering");
        },
      },
      { planFile },
    ),
  ).rejects.toMatchObject({
    errors: [
      expect.objectContaining({
        code: "FS_SCHEMA_INVALID",
        path: "/schema",
        message: expect.stringContaining("v2 Plan"),
      }),
    ],
  });
});

it("preserves exact presented frame ticks in intermediate PNG video encodings", async () => {
  const paths = tempPaths();
  mkdirSync(paths.out, { recursive: true });
  const png = await ffmpegOut([
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=1920x1080",
    "-frames:v",
    "1",
    "-c:v",
    "png",
    "-f",
    "image2pipe",
    "-",
  ]);
  const output = `${paths.out}frames.mp4`;
  const encoder = pngEncoder(output, 30);
  for (let i = 0; i < 157; i++) await encoder.write(png);
  await encoder.close();
  const result = await probe(output);
  expect(result.video!.frames).toBe(157);
  const [num, den] = result.video!.timeBase.split("/").map(Number);
  expect(result.video!.durationTicks * num! * 30).toBe(157 * den!);
}, 30000);
