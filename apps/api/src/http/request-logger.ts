export function logRequest(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
): void {
  const sanitizedPath = sanitizeLogPath(path);
  console.log(
    `[API] ${JSON.stringify({ method, path: sanitizedPath, status: statusCode, ms: durationMs })}`,
  );
}

export function sanitizeLogPath(rawUrl: string): string {
  const queryStart = rawUrl.indexOf("?");
  return queryStart === -1 ? rawUrl : rawUrl.slice(0, queryStart);
}
