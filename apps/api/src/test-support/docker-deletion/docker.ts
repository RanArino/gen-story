import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { createR2Client } from "../../storage/r2-object-storage";

const run = promisify(execFile);
export const docker = async (...args: string[]) =>
  (await run("docker", args, { maxBuffer: 64 * 1024 * 1024 })).stdout.trim();

export async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export const SEAWEEDFS_IMAGE = "chrislusf/seaweedfs:latest";

// S3-compatible stand-in for R2. The container is published on loopback only.
export async function startS3() {
  const accessKeyId = `ak${randomBytes(6).toString("hex")}`;
  const secretAccessKey = randomBytes(18).toString("hex");
  const dir = await mkdtemp(join(tmpdir(), "gen-story-s3-"));
  await writeFile(
    join(dir, "s3.json"),
    JSON.stringify({
      identities: [
        {
          name: "acceptance",
          credentials: [{ accessKey: accessKeyId, secretKey: secretAccessKey }],
          actions: ["Admin", "Read", "Write", "List", "Tagging"],
        },
      ],
    }),
  );
  const port = await freePort();
  const name = `gen-story-accept-s3-${randomBytes(3).toString("hex")}`;
  await docker(
    "run",
    "-d",
    "--name",
    name,
    "-p",
    `127.0.0.1:${port}:8333`,
    "-v",
    `${dir}:/etc/s3:ro`,
    SEAWEEDFS_IMAGE,
    "server",
    "-dir=/data",
    "-s3",
    "-s3.config=/etc/s3/s3.json",
    "-master.volumeSizeLimitMB=64",
    "-volume.max=4",
  );
  const bucket = "acceptance-media";
  const endpoint = `http://127.0.0.1:${port}`;
  const client = createR2Client({ endpoint, accessKeyId, secretAccessKey });
  for (let attempt = 0; ; attempt++) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      break;
    } catch (error) {
      if (attempt >= 60) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return {
    name,
    port,
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    client,
    stop: async () => {
      client.destroy();
      await docker("rm", "-f", name);
    },
  };
}
