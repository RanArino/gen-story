export type TestAdjustmentId =
  | "warmer"
  | "cooler"
  | "more_cinematic"
  | "darker"
  | "brighter"
  | "more_candid";

export interface TestAdjustment {
  id: TestAdjustmentId;
  label: string;
  promptSuffix: string;
}

export const TEST_ADJUSTMENTS: Record<TestAdjustmentId, TestAdjustment> = {
  warmer: {
    id: "warmer",
    label: "Warmer",
    promptSuffix: "warmer color temperature, amber and golden tones throughout",
  },
  cooler: {
    id: "cooler",
    label: "Cooler",
    promptSuffix: "cooler color temperature, blue and teal tones throughout",
  },
  more_cinematic: {
    id: "more_cinematic",
    label: "More cinematic",
    promptSuffix: "stronger cinematic grade, deeper contrast, anamorphic feel",
  },
  darker: {
    id: "darker",
    label: "Darker",
    promptSuffix:
      "lower-key lighting overall, deeper shadows, lifted blacks pulled down",
  },
  brighter: {
    id: "brighter",
    label: "Brighter",
    promptSuffix:
      "higher-key lighting overall, brighter midtones, airy exposure",
  },
  more_candid: {
    id: "more_candid",
    label: "More candid",
    promptSuffix:
      "candid documentary feel, off-the-cuff framing, natural unposed body language",
  },
};

export const TEST_ADJUSTMENT_IDS: TestAdjustmentId[] = [
  "warmer",
  "cooler",
  "more_cinematic",
  "darker",
  "brighter",
  "more_candid",
];

export const MAX_ADJUSTMENTS_PER_VARIANT = 3;

export function isTestAdjustmentId(value: unknown): value is TestAdjustmentId {
  return (
    typeof value === "string" &&
    (TEST_ADJUSTMENT_IDS as string[]).includes(value)
  );
}
