const REDACTED = "[REDACTED]";

const SENSITIVE_ENVIRONMENT_KEY =
  /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE[_-]?KEY)/i;

const TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi,
] as const;

export function collectSensitiveEnvironmentValues(
  environment: NodeJS.ProcessEnv,
): string[] {
  return Object.entries(environment)
    .filter(([key, value]) =>
      Boolean(value && SENSITIVE_ENVIRONMENT_KEY.test(key)),
    )
    .map(([, value]) => value as string)
    .filter((value) => value.length >= 4)
    .sort((left, right) => right.length - left.length);
}

export function redactSensitiveText(
  text: string,
  sensitiveValues: readonly string[] = [],
): string {
  let redacted = text;

  for (const value of [...sensitiveValues].sort(
    (left, right) => right.length - left.length,
  )) {
    if (value.length >= 4) {
      redacted = redacted.split(value).join(REDACTED);
    }
  }

  for (const pattern of TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED);
  }

  return redacted;
}
