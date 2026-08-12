export const GEMINI_MAX_ATTEMPTS = 3;
export const GEMINI_RETRY_BASE_DELAY_MS = 1_000;

type Delay = (milliseconds: number) => Promise<void>;

type RetryOptions = {
  maxAttempts?: number;
  wait?: Delay;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function statusOf(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;

  const status = error.status;
  if (typeof status === "number") return status;
  if (typeof status === "string" && /^\d+$/.test(status)) {
    return Number(status);
  }

  const response = error.response;
  if (isRecord(response)) {
    const responseStatus = response.status;
    if (typeof responseStatus === "number") return responseStatus;
  }

  return undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function retryDelayMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value !== "string") return null;

  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  if (!match) return null;

  return Math.ceil(Number(match[1]) * 1_000);
}

function providerRetryDelayMs(error: unknown): number | null {
  if (!isRecord(error)) {
    const match = /retryDelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)s/i.exec(
      messageOf(error),
    );
    return match ? Math.ceil(Number(match[1]) * 1_000) : null;
  }

  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!isRecord(current) || seen.has(current)) continue;
    seen.add(current);

    const value = retryDelayMs(current.retryDelay);
    if (value !== null) return value;

    for (const child of Object.values(current)) {
      if (isRecord(child)) queue.push(child);
      if (Array.isArray(child)) queue.push(...child);
    }
  }

  const match = /retryDelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)s/i.exec(
    messageOf(error),
  );
  return match ? Math.ceil(Number(match[1]) * 1_000) : null;
}

export function isGeminiRateLimitError(error: unknown): boolean {
  return (
    statusOf(error) === 429 ||
    /\b429\b|\bRESOURCE_EXHAUSTED\b/.test(messageOf(error))
  );
}

export async function retryGeminiRateLimit<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? GEMINI_MAX_ATTEMPTS;
  const wait = options.wait ?? delay;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isGeminiRateLimitError(error)) throw error;

      if (attempt === maxAttempts - 1) {
        throw new Error(
          `Gemini rate limit persisted after ${maxAttempts} attempts. Retry this AI task in a moment.`,
          { cause: error },
        );
      }

      const fallbackDelayMs = GEMINI_RETRY_BASE_DELAY_MS * 2 ** attempt;
      await wait(providerRetryDelayMs(error) ?? fallbackDelayMs);
    }
  }

  throw new Error("Gemini retry loop ended unexpectedly.");
}
