/**
 * Prepare a Gen Story edit plan for QCut, apply it atomically, and optionally
 * export a local MP4. QCut transitions require video inputs, so source images
 * are converted to deterministic silent clips before the manifest is applied.
 *
 * Run:
 *   pnpm tsx scripts/qcut-replay-edit-plan.ts \
 *     --plan /path/to/edit-plan.json \
 *     --bundle /path/to/storyboard-export \
 *     --workspace /path/to/qcut-workspace \
 *     --output /path/to/output.mp4
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { spawnSync } from "node:child_process";

import {
  type EditPlan,
  type EditPlanScene,
  type EditPlanTransition,
  validateEditPlan,
} from "../packages/shared/src/edit-plan";

type JsonRecord = Record<string, unknown>;

type Command = {
  executable: string;
  prefixArgs: string[];
  environment?: NodeJS.ProcessEnv;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

type Options = {
  planPath: string;
  bundlePath: string;
  workspacePath: string;
  projectId?: string;
  outputPath?: string;
  prepareOnly: boolean;
};

const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;
const VIDEO_FPS = 30;
const SUPPORTED_QCUT_APP_VERSION = "2026.9.201";
const SUPPORTED_QCUT_API_VERSION = "1.3.0";
const SUPPORTED_QCUT_PROTOCOL_VERSION = "1.0.0";

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const bundlePath = realpathSync(options.bundlePath);
  const workspacePath = resolve(options.workspacePath);
  mkdirSync(workspacePath, { recursive: true });

  const rawPlan = JSON.parse(readFileSync(options.planPath, "utf8")) as unknown;
  const plan = validateEditPlan(normalizeLegacyPlan(rawPlan));
  validateQCutCompatibility(plan);

  const preparedMedia = plan.scenes.map((scene) =>
    prepareSceneClip({ scene, bundlePath, workspacePath }),
  );
  const manifest = createQCutManifest(plan, preparedMedia);
  const normalizedPlanPath = join(workspacePath, "edit-plan.v1.json");
  const manifestPath = join(workspacePath, "qcut-timeline-manifest.json");
  writeJson(normalizedPlanPath, plan);
  writeJson(manifestPath, manifest);

  console.log(`Prepared ${plan.scenes.length} scene clips.`);
  console.log(`Edit plan: ${normalizedPlanPath}`);
  console.log(`Manifest: ${manifestPath}`);
  if (options.prepareOnly) {
    return;
  }

  const qcut = resolveQCutCommand();
  const health = runQCut(qcut, ["editor:health", "--json"]);
  assertSupportedQCutVersion(health);
  const projectId =
    options.projectId ?? createQCutProject(qcut, basename(bundlePath));

  runQCut(qcut, [
    "editor:project:update-settings",
    "--project-id",
    projectId,
    "--ratio",
    "9:16",
    "--data",
    JSON.stringify({ fps: VIDEO_FPS }),
    "--json",
  ]);
  ensurePreparedMedia(qcut, projectId, preparedMedia);

  const timeline = applyTimelineWithRetry(qcut, projectId, manifestPath, plan);
  writeJson(join(workspacePath, "qcut-timeline-readback.json"), timeline);

  if (options.outputPath) {
    const outputPath = resolve(options.outputPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    exportProject(qcut, projectId, outputPath);
    verifyOutput(plan, outputPath);
    console.log(`MP4: ${outputPath}`);
  }

  console.log(`QCut project: ${projectId}`);
}

function normalizeLegacyPlan(value: unknown): unknown {
  if (!isRecord(value) || value.schema_version != null) {
    return value;
  }
  return {
    schema_version: 1,
    video: value.video,
    scenes: value.scenes,
  };
}

function prepareSceneClip(input: {
  scene: EditPlanScene;
  bundlePath: string;
  workspacePath: string;
}): { alias: string; path: string } {
  const assetPath = realpathSync(
    resolve(input.bundlePath, input.scene.asset_path),
  );
  assertContainedPath(input.bundlePath, assetPath);
  if (!statSync(assetPath).isFile()) {
    throw new Error(
      `Scene ${input.scene.order} asset is not a file: ${assetPath}`,
    );
  }

  const duration = input.scene.end_sec - input.scene.start_sec;
  const fingerprint = createHash("sha256")
    .update(readFileSync(assetPath))
    .update(`:${duration}:${VIDEO_WIDTH}:${VIDEO_HEIGHT}:${VIDEO_FPS}`)
    .digest("hex")
    .slice(0, 12);
  const clipPath = join(
    input.workspacePath,
    "prepared-media",
    `scene-${String(input.scene.order).padStart(3, "0")}-${fingerprint}.mp4`,
  );
  mkdirSync(dirname(clipPath), { recursive: true });
  if (!existsSync(clipPath)) {
    runCommand({
      executable: "ffmpeg",
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-loop",
        "1",
        "-i",
        assetPath,
        "-t",
        String(duration),
        "-vf",
        `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`,
        "-r",
        String(VIDEO_FPS),
        "-an",
        clipPath,
      ],
    });
  }
  return { alias: `media-${input.scene.order}`, path: clipPath };
}

export function createQCutManifest(
  plan: EditPlan,
  preparedMedia: Array<{ alias: string; path: string }>,
): JsonRecord {
  if (preparedMedia.length !== plan.scenes.length) {
    throw new Error("Prepared media must contain exactly one clip per scene");
  }
  const textElements = plan.scenes.flatMap((scene) =>
    scene.text == null
      ? []
      : [
          {
            alias: `text-${scene.order}`,
            id: `text-${scene.order}`,
            type: "text",
            content: scene.text.content,
            startTime: scene.text.start_sec,
            duration: scene.text.end_sec - scene.text.start_sec,
          },
        ],
  );
  const tracks: JsonRecord[] = [
    {
      alias: "main-video",
      type: "media",
      name: "Gen Story Main Video",
      elements: plan.scenes.map((scene, index) => ({
        alias: `scene-${scene.order}`,
        id: `scene-${scene.order}`,
        type: "media",
        media: preparedMedia[index]!.alias,
        startTime: scene.start_sec,
        duration: scene.end_sec - scene.start_sec,
      })),
    },
  ];
  if (textElements.length > 0) {
    tracks.push({
      alias: "text",
      type: "text",
      name: "Gen Story Text",
      elements: textElements,
    });
  }

  return {
    settings: {
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      aspectRatio: "9:16",
      fps: VIDEO_FPS,
    },
    media: preparedMedia,
    tracks,
    transitions: plan.scenes.flatMap((scene, index) => {
      if (scene.transition.name === "None") {
        return [];
      }
      return [
        {
          track: "main-video",
          from: `scene-${scene.order}`,
          to: `scene-${plan.scenes[index + 1]!.order}`,
          duration: scene.transition.duration_sec,
          ...qcutTransition(scene.transition),
        },
      ];
    }),
  };
}

function qcutTransition(transition: EditPlanTransition): JsonRecord {
  switch (transition.name) {
    case "Dissolve":
      return { type: "dissolve", presetId: "dissolve", easing: "linear" };
    case "Fade":
      return {
        type: "fade-black",
        presetId: "fade-to-black",
        easing: "easeInOut",
      };
    case "Flash":
      return {
        type: "flash",
        presetId: "shutter-flash",
        easing: "easeInOut",
        tuning: { intensity: 1.35, tint: "#ffffff" },
      };
    case "None":
      throw new Error("None transitions do not produce QCut transitions");
  }
}

function validateQCutCompatibility(plan: EditPlan): void {
  if (plan.video.aspect_ratio !== "9:16") {
    throw new Error("QCut replay v1 supports only the verified 9:16 canvas");
  }
  plan.scenes.forEach((scene, index) => {
    if (scene.transition.name === "None") {
      return;
    }
    const nextScene = plan.scenes[index + 1];
    if (nextScene == null) {
      throw new Error("The final scene cannot have a transition");
    }
    const duration = scene.transition.duration_sec;
    const sceneDuration = scene.end_sec - scene.start_sec;
    const nextDuration = nextScene.end_sec - nextScene.start_sec;
    if (duration < 0.1 || duration > 5) {
      throw new Error(
        `Scene ${scene.order} transition must be between 0.1s and 5s`,
      );
    }
    if (duration > 2 * Math.min(sceneDuration, nextDuration)) {
      throw new Error(
        `Scene ${scene.order} transition is too long for adjacent clips`,
      );
    }
  });
}

function verifyTimeline(plan: EditPlan, response: JsonRecord): void {
  const data = nestedData(response);
  if (
    data.width !== VIDEO_WIDTH ||
    data.height !== VIDEO_HEIGHT ||
    data.fps !== VIDEO_FPS
  ) {
    throw new Error(
      `QCut read-back canvas is not ${VIDEO_WIDTH}x${VIDEO_HEIGHT} at ${VIDEO_FPS}fps`,
    );
  }
  const tracks = asArray(data.tracks, "timeline tracks");
  const mainTrack = tracks
    .map((track) => asRecord(track, "timeline track"))
    .find((track) => track.isMain === true);
  if (!mainTrack) {
    throw new Error("QCut read-back has no main track");
  }
  const elements = asArray(mainTrack.elements, "main track elements").map(
    (element) => asRecord(element, "timeline element"),
  );
  if (elements.length !== plan.scenes.length) {
    throw new Error(
      `QCut read-back has ${elements.length} clips; expected ${plan.scenes.length}`,
    );
  }
  plan.scenes.forEach((scene, index) => {
    const element = elements[index]!;
    if (
      element.id !== `scene-${scene.order}` ||
      element.startTime !== scene.start_sec ||
      element.endTime !== scene.end_sec
    ) {
      throw new Error(`QCut read-back does not match scene ${scene.order}`);
    }
  });

  const expectedTransitions = plan.scenes.flatMap((scene, index) =>
    scene.transition.name === "None"
      ? []
      : [
          {
            fromElementId: `scene-${scene.order}`,
            toElementId: `scene-${plan.scenes[index + 1]!.order}`,
            duration: scene.transition.duration_sec,
            ...qcutTransition(scene.transition),
          },
        ],
  );
  const transitions = Array.isArray(mainTrack.transitions)
    ? mainTrack.transitions.map((transition) =>
        asRecord(transition, "timeline transition"),
      )
    : [];
  if (transitions.length !== expectedTransitions.length) {
    throw new Error(
      `QCut read-back has ${transitions.length} transitions; expected ${expectedTransitions.length}`,
    );
  }
  expectedTransitions.forEach((expected, index) => {
    const actual = transitions[index]!;
    if (
      actual.fromElementId !== expected.fromElementId ||
      actual.toElementId !== expected.toElementId ||
      actual.duration !== expected.duration ||
      actual.type !== expected.type ||
      actual.presetId !== expected.presetId ||
      actual.easing !== expected.easing ||
      JSON.stringify(actual.tuning ?? null) !==
        JSON.stringify(expected.tuning ?? null)
    ) {
      throw new Error(`QCut read-back does not match transition ${index + 1}`);
    }
  });

  const expectedTexts = plan.scenes.flatMap((scene) =>
    scene.text == null
      ? []
      : [
          {
            id: `text-${scene.order}`,
            content: scene.text.content,
            startTime: scene.text.start_sec,
            endTime: scene.text.end_sec,
          },
        ],
  );
  const textElements = tracks
    .map((track) => asRecord(track, "timeline track"))
    .filter((track) => track.type === "text")
    .flatMap((track) => asArray(track.elements, "text track elements"))
    .map((element) => asRecord(element, "text element"));
  if (textElements.length !== expectedTexts.length) {
    throw new Error(
      `QCut read-back has ${textElements.length} text elements; expected ${expectedTexts.length}`,
    );
  }
  expectedTexts.forEach((expected, index) => {
    const actual = textElements[index]!;
    if (
      actual.id !== expected.id ||
      actual.content !== expected.content ||
      actual.startTime !== expected.startTime ||
      actual.endTime !== expected.endTime
    ) {
      throw new Error(`QCut read-back does not match text ${index + 1}`);
    }
  });
}

function verifyOutput(plan: EditPlan, outputPath: string): void {
  if (!existsSync(outputPath)) {
    throw new Error(`QCut did not create ${outputPath}`);
  }
  const probe = runCommand({
    executable: "ffprobe",
    args: [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,avg_frame_rate:format=duration",
      "-of",
      "json",
      outputPath,
    ],
    capture: true,
  });
  const result = JSON.parse(probe.stdout) as {
    streams?: Array<{
      width?: number;
      height?: number;
      avg_frame_rate?: string;
    }>;
    format?: { duration?: string };
  };
  const video = result.streams?.[0];
  const duration = Number(result.format?.duration);
  const expectedDuration = plan.scenes.at(-1)!.end_sec;
  if (video?.width !== VIDEO_WIDTH || video.height !== VIDEO_HEIGHT) {
    throw new Error(`QCut output is not ${VIDEO_WIDTH}x${VIDEO_HEIGHT}`);
  }
  if (video.avg_frame_rate !== `${VIDEO_FPS}/1`) {
    throw new Error(`QCut output is not ${VIDEO_FPS}fps`);
  }
  if (Math.abs(duration - expectedDuration) > 1 / VIDEO_FPS) {
    throw new Error(
      `QCut output duration ${duration}s does not match ${expectedDuration}s`,
    );
  }
}

function createQCutProject(qcut: Command, bundleName: string): string {
  const response = runQCut(qcut, [
    "editor",
    "project",
    "create",
    "--name",
    `gen-story-${bundleName}`,
    "--open",
    "--wait-ready",
    "--json",
  ]);
  const projectId = nestedData(response).projectId;
  if (typeof projectId !== "string") {
    throw new Error("QCut did not return a projectId");
  }
  return projectId;
}

function ensurePreparedMedia(
  qcut: Command,
  projectId: string,
  preparedMedia: Array<{ alias: string; path: string }>,
): void {
  const response = runQCut(qcut, [
    "editor:media:list",
    "--project-id",
    projectId,
    "--json",
  ]);
  const existing = asArray(responsePayload(response), "QCut media list").map(
    (entry) => asRecord(entry, "QCut media entry"),
  );
  for (const media of preparedMedia) {
    const expectedName = basename(media.path);
    const expectedSize = statSync(media.path).size;
    const alreadyImported = existing.some(
      (entry) => entry.name === expectedName && entry.size === expectedSize,
    );
    if (alreadyImported) {
      continue;
    }
    runQCut(qcut, [
      "editor:media:import",
      "--project-id",
      projectId,
      "--source",
      media.path,
      "--json",
    ]);
  }
}

function applyTimelineWithRetry(
  qcut: Command,
  projectId: string,
  manifestPath: string,
  plan: EditPlan,
): JsonRecord {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let applied: JsonRecord | undefined;
    try {
      applied = runQCut(qcut, [
        "editor:timeline:apply",
        "--project-id",
        projectId,
        "--manifest",
        `@${manifestPath}`,
        "--replace",
        "--atomic",
        "--verify",
        "--json",
      ]);
      assertViewMatchesTarget(applied);
    } catch (error) {
      lastError = error;
    }

    try {
      const timeline = runQCut(qcut, [
        "editor:timeline:export",
        "--project-id",
        projectId,
        "--json",
      ]);
      assertViewMatchesTarget(timeline);
      verifyTimeline(plan, timeline);
      return timeline;
    } catch (error) {
      lastError = error;
      // Success and rollback responses are both untrusted until read-back matches.
    }

    if (attempt < 3) {
      console.warn(`QCut timeline apply attempt ${attempt} failed; retrying.`);
      sleep(2_000);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("QCut timeline apply failed after three attempts");
}

function assertSupportedQCutVersion(response: JsonRecord): void {
  const health = nestedData(response);
  const actual = {
    app: health.appVersion,
    api: health.apiVersion,
    protocol: health.protocolVersion,
  };
  if (
    actual.app !== SUPPORTED_QCUT_APP_VERSION ||
    actual.api !== SUPPORTED_QCUT_API_VERSION ||
    actual.protocol !== SUPPORTED_QCUT_PROTOCOL_VERSION
  ) {
    throw new Error(
      `Unsupported QCut contract: app=${String(actual.app)}, api=${String(actual.api)}, protocol=${String(actual.protocol)}; expected app=${SUPPORTED_QCUT_APP_VERSION}, api=${SUPPORTED_QCUT_API_VERSION}, protocol=${SUPPORTED_QCUT_PROTOCOL_VERSION}`,
    );
  }
}

function exportProject(
  qcut: Command,
  projectId: string,
  outputPath: string,
): void {
  const started = runQCut(
    qcut,
    [
      "editor:export:start",
      "--project-id",
      projectId,
      "--preset",
      "instagram-reel",
      "--output",
      outputPath,
      "--json",
    ],
    new Set(["ok", "pending"]),
  );
  const jobId =
    typeof started.jobId === "string"
      ? started.jobId
      : nestedData(started).jobId;
  if (typeof jobId !== "string") {
    throw new Error("QCut did not return an export jobId");
  }

  const deadline = Date.now() + 60 * 60 * 1000;
  let lastReportedProgress = -1;
  while (Date.now() < deadline) {
    const response = runQCut(qcut, [
      "editor:export:status",
      "--project-id",
      projectId,
      "--job-id",
      jobId,
      "--json",
    ]);
    const status = nestedData(response);
    if (status.status === "completed") {
      return;
    }
    if (status.status === "failed" || status.status === "cancelled") {
      throw new Error(
        `QCut export ${String(status.status)}: ${String(status.error ?? "unknown error")}`,
      );
    }
    const progress =
      typeof status.progress === "number" ? status.progress : undefined;
    if (
      progress != null &&
      (lastReportedProgress < 0 || progress - lastReportedProgress >= 0.05)
    ) {
      console.log(`QCut export progress: ${(progress * 100).toFixed(1)}%`);
      lastReportedProgress = progress;
    }
    sleep(5_000);
  }
  throw new Error(`QCut export timed out after 60 minutes: ${jobId}`);
}

function resolveQCutCommand(): Command {
  const override = process.env.QCUT_CLI_PATH?.trim();
  if (override) {
    return { executable: override, prefixArgs: [] };
  }
  const macApp = "/Applications/QCut AI Video Editor.app";
  const executable = join(macApp, "Contents/MacOS/QCut AI Video Editor");
  const archive = join(macApp, "Contents/Resources/app.asar");
  const cli = join(archive, "electron/native-pipeline/cli/cli.js");
  if (existsSync(executable) && existsSync(archive)) {
    return {
      executable,
      prefixArgs: [cli],
      environment: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    };
  }
  return { executable: "qcut", prefixArgs: [] };
}

function runQCut(
  command: Command,
  args: string[],
  acceptedStatuses = new Set(["ok"]),
): JsonRecord {
  const output = runCommand({
    executable: command.executable,
    args: [...command.prefixArgs, ...args],
    environment: command.environment,
    capture: true,
  });
  const result = lastJsonObject(output.stdout);
  if (
    typeof result.status !== "string" ||
    !acceptedStatuses.has(result.status)
  ) {
    throw new Error(
      `QCut command failed: ${[output.stdout, output.stderr].filter(Boolean).join("\n").trim()}`,
    );
  }
  return result;
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function lastJsonObject(output: string): JsonRecord {
  // lastIndexOf clamps a negative position to 0, so step off index 0 explicitly
  // instead of rescanning it forever when the output starts with an unparsable "{".
  let index = output.lastIndexOf("{");
  while (index >= 0) {
    try {
      const value = JSON.parse(output.slice(index)) as unknown;
      if (isRecord(value)) {
        return value;
      }
    } catch {
      // Keep scanning for the start of the final complete JSON document.
    }
    index = index === 0 ? -1 : output.lastIndexOf("{", index - 1);
  }
  throw new Error(`Command did not return JSON: ${output.trim()}`);
}

function runCommand(input: {
  executable: string;
  args: string[];
  environment?: NodeJS.ProcessEnv;
  capture?: boolean;
}): CommandResult {
  const result = spawnSync(input.executable, input.args, {
    env: input.environment ?? process.env,
    encoding: "utf8",
    stdio: input.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.status !== 0) {
    throw new Error(
      `${input.executable} exited with ${result.status}: ${[stdout, stderr].filter(Boolean).join("\n").trim()}`,
    );
  }
  return { stdout, stderr };
}

function assertContainedPath(rootPath: string, candidatePath: string): void {
  const pathFromRoot = relative(rootPath, candidatePath);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`Asset escapes the bundle: ${candidatePath}`);
  }
}

function assertViewMatchesTarget(response: JsonRecord): void {
  const view = asRecord(nestedData(response).view, "QCut view");
  if (view.matchesTarget !== true) {
    throw new Error("QCut window is not showing the target project");
  }
}

function nestedData(response: JsonRecord): JsonRecord {
  return asRecord(responsePayload(response), "QCut command data");
}

function responsePayload(response: JsonRecord): unknown {
  return asRecord(response.data, "QCut response data").data;
}

function asRecord(value: unknown, name: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function asArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function writeJson(outputPath: string, value: unknown): void {
  writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseOptions(args: string[]): Options {
  const values = new Map<string, string>();
  let prepareOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--prepare-only") {
      prepareOnly = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    values.set(argument, value);
    index += 1;
  }

  return {
    planPath: requiredOption(values, "--plan"),
    bundlePath: requiredOption(values, "--bundle"),
    workspacePath: requiredOption(values, "--workspace"),
    projectId: values.get("--project-id"),
    outputPath: values.get("--output"),
    prepareOnly,
  };
}

function requiredOption(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (!value) {
    throw new Error(`Missing required option ${name}`);
  }
  return value;
}

main();
