export const HTTP_BODY_LIMITS = {
  standardJsonBytes: 256 * 1024,
  localPhotoJsonBytes: 16 * 1024 * 1024,
} as const;

export const HTTP_SERVER_TIMEOUTS = {
  headersMs: 15_000,
  requestMs: 30_000,
  keepAliveMs: 5_000,
} as const;

export const IMAGE_RESOURCE_LIMITS = {
  encodedBytes: 10 * 1024 * 1024,
  pixels: 40_000_000,
  frames: 1,
} as const;

export function parseAllowedOrigins(
  env: NodeJS.ProcessEnv,
): ReadonlySet<string> {
  const configured = env.CORS_ORIGINS ?? env.CORS_ORIGIN;
  const values = configured
    ? configured.split(",").map((value) => value.trim())
    : ["http://localhost:3000"];

  return new Set(values.filter(isOrigin));
}

export function isAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  return origin === undefined || allowedOrigins.has(origin);
}

function isOrigin(value: string): boolean {
  if (value.length === 0) return false;

  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}
