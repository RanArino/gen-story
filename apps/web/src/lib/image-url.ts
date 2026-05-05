export function storageKeyToUrl(storageKey: string): string {
  const base =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
  // storageKey starts with "data/uploads/..." — serve via /files/<key>
  return `${base}/files/${storageKey}`;
}
