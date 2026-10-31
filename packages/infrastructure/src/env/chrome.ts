import { accessSync, constants } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";
import { fail } from "../contracts/errors.js";

/** Resolve the same executable for environment fingerprints and browser capture. */
export function resolveChromePath(
  chromePath = process.env.CHROME_PATH,
): string {
  const os = platform();
  const explicit = chromePath?.trim();
  const locations =
    os === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          join(
            homedir(),
            "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          ),
        ]
      : os === "win32"
        ? [
            process.env.PROGRAMFILES,
            process.env["PROGRAMFILES(X86)"],
            process.env.LOCALAPPDATA,
          ]
            .filter((p): p is string => Boolean(p))
            .map((p) => join(p, "Google/Chrome/Application/chrome.exe"))
        : [];
  const names =
    os === "win32"
      ? ["chrome.exe"]
      : [
          "google-chrome",
          "google-chrome-stable",
          "chromium",
          "chromium-browser",
        ];
  const candidates = explicit
    ? [explicit]
    : [
        ...locations,
        ...(process.env.PATH ?? "")
          .split(delimiter)
          .filter(Boolean)
          .flatMap((p) => names.map((name) => join(p, name))),
      ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, os === "win32" ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch {
      // Continue only through known local install locations and PATH.
    }
  }
  return fail(
    "FS_ENV_MISMATCH",
    "/environment/chrome",
    explicit
      ? `CHROME_PATH does not identify an executable: ${explicit}. Set CHROME_PATH in apps/api/.env to a Chrome executable and restart the API.`
      : "Install Google Chrome or set CHROME_PATH in apps/api/.env to a Chrome executable, then restart the API.",
  );
}
