export type Language = "en" | "ja";
export const SUPPORTED_LANGUAGES: Language[] = ["en", "ja"];
export const DEFAULT_LANGUAGE: Language = "en";
export const LANGUAGE_COOKIE = "gen_story_language";

export function isLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as string[]).includes(value)
  );
}

export function parseAcceptLanguage(
  header: string | null | undefined,
): Language | null {
  if (!header) return null;
  const tokens = header
    .split(",")
    .map((token) => (token.split(";")[0] ?? "").trim().toLowerCase());
  for (const token of tokens) {
    if (token.startsWith("ja")) return "ja";
    if (token.startsWith("en")) return "en";
  }
  return null;
}
