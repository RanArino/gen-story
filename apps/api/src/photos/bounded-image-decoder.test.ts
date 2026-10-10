import { readFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LinuxContainerImageDecoder } from "./bounded-image-decoder";
import { calculateSha256Hex } from "../storage/checksum";
const fixture = (name: string) =>
  readFile(new URL(`../test-support/fixtures/${name}`, import.meta.url));

describe.runIf(process.env.GEN_STORY_MEDIA_LINUX_TEST === "1")(
  "bounded Linux image decoding",
  () => {
    it.each(["jpeg", "png", "webp", "heic", "heif"] as const)(
      "fully decodes %s and emits metadata-free bounded JPEGs",
      async (format) => {
        const body =
          format === "heic" || format === "heif"
            ? await fixture(`valid.${format}`)
            : await sharp({
                create: {
                  width: 1800,
                  height: 1200,
                  channels: 3,
                  background: "red",
                },
              })
                .toFormat(format)
                .withMetadata({ orientation: 6 })
                .toBuffer();
        const hash = calculateSha256Hex(body);
        const result = await new LinuxContainerImageDecoder().decode(body);
        expect(result.mimeType).toBe(`image/${format}`);
        expect(calculateSha256Hex(body)).toBe(hash);
        for (const [output, edge] of [
          [result.preview, 640],
          [result.agentPreview, 1024],
        ] as const) {
          const metadata = await sharp(output).metadata();
          expect(metadata.format).toBe("jpeg");
          expect(
            Math.max(metadata.width!, metadata.height!),
          ).toBeLessThanOrEqual(edge);
          expect(metadata.exif).toBeUndefined();
          expect(metadata.icc).toBeUndefined();
          expect(metadata.xmp).toBeUndefined();
          expect(metadata.iptc).toBeUndefined();
          expect(output.length).toBeLessThanOrEqual(10 * 1024 * 1024);
        }
        if (format === "jpeg")
          expect(result).toMatchObject({ width: 1200, height: 1800 });
      },
      30_000,
    );
    it("orients HEIC EXIF before dropping metadata", async () => {
      const result = await new LinuxContainerImageDecoder().decode(
        await fixture("oriented.heic"),
      );
      expect(result).toMatchObject({ width: 80, height: 120 });
      const raw = await sharp(result.preview)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixel = (x: number, y: number) =>
        Array.from(
          raw.data.subarray(
            (y * raw.info.width + x) * raw.info.channels,
            (y * raw.info.width + x) * raw.info.channels + 3,
          ),
        );
      expect(pixel(40, 10)[2]).toBeGreaterThan(180);
      expect(pixel(40, 100)[0]).toBeGreaterThan(180);
    }, 30_000);
    it("rejects multiple HEIC images, truncated bytes, disguised types, encoded overflow, and excessive pixels", async () => {
      const decoder = new LinuxContainerImageDecoder();
      for (const body of [
        await fixture("multiple.heic"),
        (await fixture("valid.heic")).subarray(0, 100),
        Buffer.from("not an image"),
        Buffer.alloc(10 * 1024 * 1024 + 1),
      ])
        await expect(decoder.decode(body)).rejects.toThrow();
      const frame = await fixture("source.png");
      const animation = Buffer.alloc(20);
      animation.writeUInt32BE(8);
      animation.write("acTL", 4);
      animation.writeUInt32BE(2, 8);
      // Calculate a valid chunk CRC; the decoder must reject the declared frame
      // count rather than silently accepting libpng's default-image-only decode.
      let crc = 0xffffffff;
      for (const byte of animation.subarray(4, 16)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++)
          crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      animation.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 16);
      await expect(
        decoder.decode(
          Buffer.concat([frame.subarray(0, 33), animation, frame.subarray(33)]),
        ),
      ).rejects.toThrow();

      const other = await sharp({
        create: { width: 120, height: 80, channels: 3, background: "green" },
      })
        .png()
        .toBuffer();
      const animated = await sharp([frame, other], { join: { animated: true } })
        .webp()
        .toBuffer();
      expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(
        2,
      );
      await expect(decoder.decode(animated)).rejects.toThrow();
      const oversized = await sharp({
        create: { width: 8000, height: 6000, channels: 3, background: "white" },
        limitInputPixels: false,
      })
        .png()
        .toBuffer();
      await expect(decoder.decode(oversized)).rejects.toThrow();
    }, 60_000);
    it("terminates a stuck decoder at fifteen seconds and removes its container", async () => {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          "docker",
          ["build", "-t", "gen-story-media-decoder-timeout:m4", "-"],
          { stdio: ["pipe", "ignore", "ignore"] },
        );
        child.stdin.end(
          'FROM gen-story-media-decoder:m4\nENTRYPOINT ["node", "-e", "setInterval(()=>{},1000)"]\n',
        );
        child.on("error", reject);
        child.on("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error("Timeout fixture build failed.")),
        );
      });
      const started = Date.now();
      await expect(
        new LinuxContainerImageDecoder(
          "gen-story-media-decoder-timeout:m4",
        ).decode(await fixture("source.png")),
      ).rejects.toThrow("validation failed");
      expect(Date.now() - started).toBeGreaterThanOrEqual(15_000);
      expect(Date.now() - started).toBeLessThan(22_000);
      const { stdout } = await promisify(execFile)("docker", [
        "ps",
        "--filter",
        "name=gen-story-decode-",
        "--format",
        "{{.Names}}",
      ]);
      expect(stdout.trim()).toBe("");
    }, 30_000);
    it("enforces the hard 512 MiB cgroup including native allocations, no swap, and one CPU", async () => {
      const { stdout } = await promisify(execFile)("docker", [
        "run",
        "--rm",
        "--memory=512m",
        "--memory-swap=512m",
        "--cpus=1",
        "--network=none",
        "--entrypoint",
        "sh",
        "gen-story-media-decoder:m4",
        "-c",
        "cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max",
      ]);
      expect(stdout.trim().split("\n")).toEqual([
        "536870912",
        "0",
        "100000 100000",
      ]);
      await expect(
        promisify(execFile)(
          "docker",
          [
            "run",
            "--rm",
            "--memory=512m",
            "--memory-swap=512m",
            "--cpus=1",
            "--network=none",
            "--entrypoint",
            "node",
            "gen-story-media-decoder:m4",
            "-e",
            "const blocks=[];setInterval(()=>blocks.push(Buffer.alloc(64*1024*1024,1)),10)",
          ],
          { timeout: 15000 },
        ),
      ).rejects.toMatchObject({ code: 137 });
    }, 30_000);
  },
);
