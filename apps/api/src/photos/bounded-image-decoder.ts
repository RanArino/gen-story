import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  chmod,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IMAGE_RESOURCE_LIMITS } from "../http/security-policy";
import { MediaError } from "./upload-session";

export type DecodedUpload = {
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  preview: Uint8Array;
  agentPreview: Uint8Array;
};
export interface BoundedImageDecoder {
  decode(body: Uint8Array): Promise<DecodedUpload>;
}

// Each invocation has a hard cgroup memory/swap/CPU boundary, separate from the API.
// The image contains one Node child and accepts no network or executable input.
export class LinuxContainerImageDecoder implements BoundedImageDecoder {
  private busy = false;
  constructor(private readonly image = "gen-story-media-decoder:m4") {}
  async decode(body: Uint8Array): Promise<DecodedUpload> {
    if (this.busy)
      throw new Error("Decoder is busy; retry persisted execution.");
    if (body.length > IMAGE_RESOURCE_LIMITS.encodedBytes || !body.length)
      throw new MediaError("validation_error");
    this.busy = true;
    let directory: string | undefined;
    const name = `gen-story-decode-${randomUUID()}`;
    try {
      directory = await mkdtemp(join(tmpdir(), "gen-story-decode-"));
      await chmod(directory, 0o777);
      await writeFile(join(directory, "input"), body, { mode: 0o444 });
      await runContainer(
        [
          "run",
          "--rm",
          "--name",
          name,
          "--network=none",
          "--memory=512m",
          "--memory-swap=512m",
          "--cpus=1",
          "--pids-limit=32",
          "--read-only",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--tmpfs=/tmp:rw,noexec,nosuid,size=16m",
          "--mount",
          `type=bind,source=${directory},target=/work`,
          this.image,
        ],
        name,
      );
      for (const name of ["result.json", "preview.jpg", "agent-preview.jpg"]) {
        const size = (await stat(join(directory, name))).size;
        if (
          size < 1 ||
          size >
            (name === "result.json" ? 4096 : IMAGE_RESOURCE_LIMITS.encodedBytes)
        )
          throw new MediaError("validation_error");
      }
      const metadata = JSON.parse(
        await readFile(join(directory, "result.json"), "utf8"),
      ) as Omit<DecodedUpload, "preview" | "agentPreview">;
      if (
        !Number.isSafeInteger(metadata.width) ||
        !Number.isSafeInteger(metadata.height) ||
        metadata.width < 1 ||
        metadata.height < 1 ||
        metadata.width * metadata.height > IMAGE_RESOURCE_LIMITS.pixels ||
        ![
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/heic",
          "image/heif",
        ].includes(metadata.mimeType)
      )
        throw new MediaError("validation_error");
      const preview = await readFile(join(directory, "preview.jpg"));
      const agentPreview = await readFile(join(directory, "agent-preview.jpg"));
      if (
        preview.length > IMAGE_RESOURCE_LIMITS.encodedBytes ||
        agentPreview.length > IMAGE_RESOURCE_LIMITS.encodedBytes
      )
        throw new MediaError("validation_error");
      return { ...metadata, preview, agentPreview };
    } finally {
      await removeContainer(name);
      if (directory) await rm(directory, { recursive: true, force: true });
      this.busy = false;
    }
  }
}
function runContainer(args: string[], name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: "ignore" });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      // Killing the Docker CLI alone would leave the native decoder alive.
      const kill = spawn("docker", ["kill", name], { stdio: "ignore" });
      kill.on("error", () => undefined);
      child.kill("SIGKILL");
    }, 15_000);
    child.on("error", () => {
      clearTimeout(timeout);
      reject(new Error("Linux decoder executor unavailable."));
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0 && !timedOut) resolve();
      else if (code === 125 || code === 126 || code === 127)
        reject(new Error("Linux decoder executor unavailable."));
      else
        reject(new MediaError("validation_error", "Image validation failed."));
    });
  });
}

function removeContainer(name: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["rm", "--force", name], { stdio: "ignore" });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.on("error", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
