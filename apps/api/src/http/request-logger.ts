export function logRequest(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
): void {
  console.log(
    `[API] ${JSON.stringify({ method, path, status: statusCode, ms: durationMs })}`,
  );
}
