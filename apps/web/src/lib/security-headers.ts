export type SecurityHeader = {
  key: string;
  value: string;
};

export function buildSecurityHeaders(
  isProduction: boolean,
  apiBaseUrl?: string,
): SecurityHeader[] {
  const apiOrigin = configuredApiOrigin(apiBaseUrl);
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${apiOrigin === null ? "" : ` ${apiOrigin}`}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
  ].join("; ");

  const headers: SecurityHeader[] = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
  ];

  if (isProduction) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }

  return headers;
}

function configuredApiOrigin(apiBaseUrl: string | undefined): string | null {
  if (apiBaseUrl === undefined) return "http://localhost:4000";

  try {
    const url = new URL(apiBaseUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
