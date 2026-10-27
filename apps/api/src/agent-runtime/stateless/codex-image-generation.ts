import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, isAbsolute, sep } from "node:path";
import sharp from "sharp";

import {
  CodexAppServerClient,
  type ServerRequestRejecter,
  type ServerRequestResponder,
} from "../codex-app-server/app-server-client";
import { compareVersions, detectAgentRuntime } from "../runtime-detection";

export type CodexImageGenerationInput = {
  prompt: string;
  size?: string;
  quality?: string;
  images?: readonly Uint8Array[];
  environment?: NodeJS.ProcessEnv;
  repositoryRoot?: string;
  timeoutMs?: number;
};

export async function runCodexImageGeneration(
  input: CodexImageGenerationInput,
): Promise<Uint8Array> {
  const root = join(
    input.repositoryRoot ?? process.cwd(),
    "data",
    "agent-runtime-scratch",
    "codex-images",
  );
  await mkdir(root, { recursive: true });
  const scratch = await mkdtemp(join(root, "run-"));
  let client: CodexAppServerClient | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = input.timeoutMs ?? 180_000;
  const started = Date.now();
  const remaining = () => {
    const value = timeoutMs - (Date.now() - started);
    if (expired || value <= 0)
      throw new Error("Codex image generation timed out.");
    return value;
  };

  const attempt = async () => {
    const runtime = await detectAgentRuntime({
      provider: "codex",
      workingDirectory: scratch,
      allowedWorkingDirectoryRoot: root,
      environment: input.environment,
      timeoutMs: Math.min(10_000, remaining()),
    });
    if (runtime.status !== "available")
      throw new Error(
        `Codex unavailable (${runtime.reason}): ${runtime.message}`,
      );
    if (compareVersions(runtime.version, "0.164.0") < 0)
      throw new Error("Codex image generation requires CLI 0.164.0 or later.");
    remaining();
    const images: { type: "localImage"; path: string }[] = [];
    for (const [index, body] of (input.images ?? []).entries()) {
      const path = join(scratch, `reference-${index}.png`);
      await writeFile(path, await sharp(Buffer.from(body)).png().toBuffer());
      images.push({ type: "localImage", path });
    }
    remaining();
    client = new CodexAppServerClient({
      args: [
        "-c",
        "project_doc_max_bytes=0",
        "-c",
        'model_provider="openai"',
        "-c",
        'forced_login_method="chatgpt"',
        "--enable",
        "image_generation",
        "--disable",
        "shell_tool",
        "app-server",
      ],
      workingDirectory: scratch,
      allowedWorkingDirectoryRoot: root,
      environment: input.environment,
    });
    const connection = client;
    connection.on(
      "request",
      (
        _method: string,
        _params: unknown,
        _respond: ServerRequestResponder,
        reject: ServerRequestRejecter,
      ) => {
        reject(
          -32000,
          "Image generation does not permit interactive tool approvals.",
        );
      },
    );
    let image: Record<string, unknown> | undefined;
    let resolveTurn!: () => void;
    let rejectTurn!: (error: Error) => void;
    const completed = new Promise<void>((resolve, reject) => {
      resolveTurn = resolve;
      rejectTurn = reject;
    });
    // A failure can arrive before turn/start's response. Attach a rejection
    // handler immediately, while retaining the rejection for the await below.
    void completed.catch(() => {});
    connection.on("exit", () =>
      rejectTurn(new Error("Codex exited before image generation completed.")),
    );
    connection.on("processError", () =>
      rejectTurn(new Error("Codex image process failed.")),
    );
    connection.on(
      "notification",
      (method: string, params: Record<string, unknown>) => {
        if (method === "item/completed") {
          const item = params.item as Record<string, unknown> | undefined;
          if (item?.type === "imageGeneration") image = item;
        }
        if (method === "turn/completed") {
          const turn = params.turn as {
            status?: string;
            error?: { message?: string };
          };
          if (turn.status === "completed") resolveTurn();
          else
            rejectTurn(
              new Error(
                `Codex image turn ${turn.status}: ${turn.error?.message ?? "generation failed"}`,
              ),
            );
        }
      },
    );
    await connection.request(
      "initialize",
      {
        clientInfo: { name: "gen-story-images", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      },
      remaining(),
    );
    const { thread } = await connection.request<{ thread: { id: string } }>(
      "thread/start",
      {
        cwd: scratch,
        ephemeral: true,
        sandbox: "workspace-write",
        approvalPolicy: "never",
        config: {
          sandbox_workspace_write: {
            writable_roots: [scratch],
            exclude_tmpdir_env_var: true,
            exclude_slash_tmp: true,
            network_access: false,
          },
        },
      },
      remaining(),
    );
    await connection.request(
      "turn/start",
      {
        threadId: thread.id,
        input: [
          {
            type: "text",
            text: [
              "Use the built-in image generation tool to produce exactly one image. Do not use an API, shell, or create an SVG substitute.",
              `Save the generated image inside ${scratch} if a local output path is needed.`,
              `Requested image size: ${input.size ?? "1024x1024"}. Quality: ${input.quality ?? "auto"}.`,
              input.prompt,
            ].join("\n"),
          },
          ...images,
        ],
      },
      remaining(),
    );
    await completed;
    remaining();
    if (!image || image.status !== "completed" || image.failure)
      throw new Error("Codex returned no completed image.");
    let bytes: Uint8Array;
    if (typeof image.result === "string" && image.result.length > 0) {
      bytes = Buffer.from(image.result, "base64");
    } else if (typeof image.savedPath === "string") {
      const path = await realpath(image.savedPath);
      const fromScratch = relative(await realpath(scratch), path);
      if (
        fromScratch === ".." ||
        fromScratch.startsWith(`..${sep}`) ||
        isAbsolute(fromScratch)
      )
        throw new Error("Codex image output escaped the scratch directory.");
      bytes = await readFile(path);
    } else {
      throw new Error("Codex returned no readable image bytes.");
    }
    // Decode even PNG results: a file signature alone does not prove that an
    // image is complete or usable by the review screen.
    return new Uint8Array(await sharp(Buffer.from(bytes)).png().toBuffer());
  };

  try {
    return await Promise.race([
      attempt(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error("Codex image generation timed out."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    expired = true;
    clearTimeout(timer);
    if (client) {
      const exited = client.waitForExit();
      client.kill("SIGKILL");
      await exited;
    }
    await rm(scratch, { recursive: true, force: true });
  }
}
