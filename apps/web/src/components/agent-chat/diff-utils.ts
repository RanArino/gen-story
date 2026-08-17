// Line-level diff for the change approval card's Raw view. Small inputs
// (a field's JSON, at most a few dozen lines) make the classic O(n*m) LCS
// table cheap enough that pulling in a diff dependency isn't worth it.

export type DiffLine = { type: "context" | "add" | "remove"; text: string };

export function diffLines(beforeText: string, afterText: string): DiffLine[] {
  const a = beforeText.length === 0 ? [] : beforeText.split("\n");
  const b = afterText.length === 0 ? [] : afterText.split("\n");
  const n = a.length;
  const m = b.length;

  const lengths: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  const lengthAt = (row: number, col: number): number =>
    lengths[row]?.[col] ?? 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const row = lengths[i];
      if (row == null) continue;
      row[j] =
        a[i] === b[j]
          ? lengthAt(i + 1, j + 1) + 1
          : Math.max(lengthAt(i + 1, j), lengthAt(i, j + 1));
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const lineA = a[i] as string;
    const lineB = b[j] as string;
    if (lineA === lineB) {
      result.push({ type: "context", text: lineA });
      i += 1;
      j += 1;
    } else if (lengthAt(i + 1, j) >= lengthAt(i, j + 1)) {
      result.push({ type: "remove", text: lineA });
      i += 1;
    } else {
      result.push({ type: "add", text: lineB });
      j += 1;
    }
  }
  while (i < n) {
    result.push({ type: "remove", text: a[i] as string });
    i += 1;
  }
  while (j < m) {
    result.push({ type: "add", text: b[j] as string });
    j += 1;
  }
  return result;
}

// The raw text a value diffs against: strings compare as themselves, objects
// as pretty-printed JSON so the diff lines up key by key.
export function jsonForDiff(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

// "imagePrompt" -> "Image Prompt", for object fields with no dedicated
// translation (photo analysis, and any future free-form field).
export function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
