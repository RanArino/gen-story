// Stable error codes. Codes are part of the public contract: fixtures, tests, the CLI,
// and the Tool Calling adapter all match on them.

export type ErrorOwner = "user" | "recipe-author" | "capability-author" | "operator" | "system";

export const ERROR_CODES = {
  FS_SCHEMA_INVALID: { owner: "recipe-author", remediation: "Fix the document so that it matches its canonical schema." },
  FS_SEMANTIC_INVALID: { owner: "recipe-author", remediation: "Fix the cross-field rule named in the message." },
  FS_PREFLIGHT_OVER_LIMIT: {
    owner: "user",
    remediation: "Shorten the fixed scene durations, raise the Chapter limit, or remove the limit.",
  },
  FS_SCENE_TOO_SHORT_FOR_TRANSITIONS: {
    owner: "user",
    remediation: "Enter a duration of at least the reported minimum, or clear the value so it is resolved.",
  },
  FS_COMPAT_CONFLICT: { owner: "recipe-author", remediation: "Select Capabilities whose declared compatibility allows this combination." },
  FS_FALLBACK_MISSING: { owner: "capability-author", remediation: "Declare a registered safety-fallback edge in the Manifest." },
  FS_FALLBACK_CYCLE: { owner: "capability-author", remediation: "Remove the cycle from the safety-fallback edges." },
  FS_FALLBACK_NOT_LEVEL0: { owner: "capability-author", remediation: "Make the fallback chain terminate in a Level 0 Capability." },
  FS_FONT_MISSING: { owner: "operator", remediation: "Promote the referenced Font Asset or select a registered one." },
  FS_GLYPH_MISSING: { owner: "recipe-author", remediation: "Select a Font Asset whose verified coverage includes every caption glyph." },
  FS_FONT_SCOPE: { owner: "recipe-author", remediation: "Use project-only fonts only in that project's Treatment." },
  FS_FONT_INVALID: { owner: "operator", remediation: "Supply complete, parseable font bytes." },
  FS_FONT_COVERAGE_CLAIM: { owner: "operator", remediation: "Declare only the scripts the font bytes actually cover." },
  FS_LICENSE_INCOMPLETE: { owner: "operator", remediation: "Record the license, redistribution, and video-embedding rights." },
  FS_VERSION_COLLISION: { owner: "capability-author", remediation: "Publish different bytes under a new version." },
  FS_DIGEST_MISMATCH: { owner: "system", remediation: "Reference the exact digest recorded in the registry." },
  FS_NOT_PROMOTED: { owner: "recipe-author", remediation: "Reference only promoted registry entries." },
  FS_FORBIDDEN_IMPORT: { owner: "capability-author", remediation: "Import only from the Capability SDK." },
  FS_FORBIDDEN_GLOBAL: { owner: "capability-author", remediation: "Remove the forbidden global or syntax." },
  FS_PERMISSION_FORBIDDEN: { owner: "capability-author", remediation: "Remove the permission; new permissions need an architecture decision." },
  FS_NONDETERMINISTIC: { owner: "capability-author", remediation: "Make the output a pure function of the input." },
  FS_RUNTIME_ERROR: { owner: "capability-author", remediation: "Fix the error raised for the reported fixture." },
  FS_RESOURCE_CEILING: { owner: "capability-author", remediation: "Stay within the declared budget and the time ceiling." },
  FS_APPROVAL_REQUIRED: { owner: "operator", remediation: "Obtain the approval with `film-spike approve` and pass its id." },
  FS_APPROVAL_MISMATCH: { owner: "operator", remediation: "Pass an approval bound to this exact kind and digest." },
  FS_OPERATOR_REQUIRED: { owner: "operator", remediation: "Run the prepared review command in an interactive terminal and confirm the current digest." },
  FS_REVIEW_REQUIRED: { owner: "operator", remediation: "Record an independent review before promotion." },
  FS_REPLAY_MISSING_VERSION: { owner: "operator", remediation: "Restore the exact pinned version; replay never loads a newer one." },
  FS_ENV_MISMATCH: { owner: "operator", remediation: "Recompile the Plan in the current environment or restore the pinned one." },
  FS_ARTIFACT_VERIFY_FAILED: { owner: "system", remediation: "Discard the artifact and render again." },
} as const satisfies Record<string, { owner: ErrorOwner; remediation: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface FilmError {
  code: ErrorCode;
  path: string; // JSON pointer into the subject document, "" for the whole document
  message: string;
  owner: ErrorOwner;
  remediation: string;
  details?: Record<string, unknown>;
}

export function filmError(code: ErrorCode, path: string, message: string, details?: Record<string, unknown>): FilmError {
  const { owner, remediation } = ERROR_CODES[code];
  return { code, path, message, owner, remediation, ...(details ? { details } : {}) };
}

export function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_CODES, value);
}

/** Thrown inside services and caught at the envelope boundary. */
export class FilmFailure extends Error {
  constructor(readonly errors: FilmError[]) {
    super(errors.map((e) => `${e.code} ${e.path} ${e.message}`).join("; "));
  }
}

export function fail(code: ErrorCode, path: string, message: string, details?: Record<string, unknown>): never {
  throw new FilmFailure([filmError(code, path, message, details)]);
}
