export const EDIT_PLAN_SCHEMA_VERSION = 1 as const;
export const MAX_EDIT_PLAN_DURATION_SECONDS = 60;

export type EditPlanTransitionName = "None" | "Dissolve" | "Fade" | "Flash";

export type EditPlanTransition = {
  name: EditPlanTransitionName;
  duration_sec: number;
  reason?: string;
};

export type EditPlanText = {
  content: string;
  start_sec: number;
  end_sec: number;
};

export type EditPlanScene = {
  order: number;
  asset_path: string;
  start_sec: number;
  end_sec: number;
  transition: EditPlanTransition;
  text: EditPlanText | null;
};

export type EditPlan = {
  schema_version: typeof EDIT_PLAN_SCHEMA_VERSION;
  video: {
    aspect_ratio: string;
    language?: string;
    platform?: string;
  };
  scenes: EditPlanScene[];
};

const TRANSITION_NAMES = new Set<EditPlanTransitionName>([
  "None",
  "Dissolve",
  "Fade",
  "Flash",
]);

export function validateEditPlan(value: unknown): EditPlan {
  const plan = record(value, "edit plan");
  if (plan.schema_version !== EDIT_PLAN_SCHEMA_VERSION) {
    throw new Error(`schema_version must be ${EDIT_PLAN_SCHEMA_VERSION}`);
  }

  const video = record(plan.video, "video");
  const aspectRatio = nonEmptyString(video.aspect_ratio, "video.aspect_ratio");
  const scenes = array(plan.scenes, "scenes");
  if (scenes.length === 0) {
    throw new Error("scenes must contain at least one scene");
  }

  let previousEnd = 0;
  const normalizedScenes = scenes.map((rawScene, index): EditPlanScene => {
    const scene = record(rawScene, `scene ${index + 1}`);
    const order = finiteNumber(scene.order, `scene ${index + 1}.order`);
    if (!Number.isInteger(order) || order !== index + 1) {
      throw new Error("scene order must start at 1 and be contiguous");
    }

    const assetPath = nonEmptyString(
      scene.asset_path,
      `scene ${order}.asset_path`,
    );
    if (!isSafeRelativePath(assetPath)) {
      throw new Error(`scene ${order}.asset_path must stay inside the bundle`);
    }

    const start = roundedNumber(scene.start_sec, `scene ${order}.start_sec`);
    const end = roundedNumber(scene.end_sec, `scene ${order}.end_sec`);
    if (start !== previousEnd || end <= start) {
      throw new Error("scenes must be contiguous with positive durations");
    }

    const transition = parseTransition(scene.transition, order, end - start);
    const text = parseText(scene.text, order, start, end);
    previousEnd = end;

    return {
      order,
      asset_path: assetPath,
      start_sec: start,
      end_sec: end,
      transition,
      text,
    };
  });

  if (previousEnd > MAX_EDIT_PLAN_DURATION_SECONDS) {
    throw new Error(
      `timeline exceeds the ${MAX_EDIT_PLAN_DURATION_SECONDS.toFixed(2)}-second maximum`,
    );
  }
  const finalTransition = normalizedScenes.at(-1)?.transition;
  if (
    finalTransition == null ||
    finalTransition.name !== "None" ||
    finalTransition.duration_sec !== 0
  ) {
    throw new Error(
      "the final scene transition must be None with zero duration",
    );
  }

  return {
    schema_version: EDIT_PLAN_SCHEMA_VERSION,
    video: {
      aspect_ratio: aspectRatio,
      ...optionalString(video.language, "video.language", "language"),
      ...optionalString(video.platform, "video.platform", "platform"),
    },
    scenes: normalizedScenes,
  };
}

function parseTransition(
  value: unknown,
  order: number,
  sceneDuration: number,
): EditPlanTransition {
  const transition = record(value, `scene ${order}.transition`);
  const name = nonEmptyString(
    transition.name,
    `scene ${order}.transition.name`,
  );
  if (!TRANSITION_NAMES.has(name as EditPlanTransitionName)) {
    throw new Error(`scene ${order}.transition.name is not supported: ${name}`);
  }
  const duration = roundedNumber(
    transition.duration_sec,
    `scene ${order}.transition.duration_sec`,
  );
  if (duration < 0 || duration > rounded(sceneDuration)) {
    throw new Error("transition duration must fit inside its outgoing clip");
  }
  if ((name === "None") !== (duration === 0)) {
    throw new Error("None transitions must have zero duration and vice versa");
  }

  return {
    name: name as EditPlanTransitionName,
    duration_sec: duration,
    ...optionalString(transition.reason, "transition.reason", "reason"),
  };
}

function parseText(
  value: unknown,
  order: number,
  sceneStart: number,
  sceneEnd: number,
): EditPlanText | null {
  if (value == null) {
    return null;
  }
  const text = record(value, `scene ${order}.text`);
  const start = roundedNumber(text.start_sec, `scene ${order}.text.start_sec`);
  const end = roundedNumber(text.end_sec, `scene ${order}.text.end_sec`);
  if (!(sceneStart <= start && start < end && end <= sceneEnd)) {
    throw new Error("text timing must be within its scene");
  }
  return {
    content: nonEmptyString(text.content, `scene ${order}.text.content`),
    start_sec: start,
    end_sec: end,
  };
}

function isSafeRelativePath(value: string): boolean {
  if (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(value)
  ) {
    return false;
  }
  return !value.split(/[\\/]/).some((segment) => segment === "..");
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  return value;
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function roundedNumber(value: unknown, name: string): number {
  return rounded(finiteNumber(value, name));
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function optionalString<K extends string>(
  value: unknown,
  name: string,
  key: K,
): { [P in K]?: string } {
  if (value == null) {
    return {};
  }
  return { [key]: nonEmptyString(value, name) } as { [P in K]?: string };
}
