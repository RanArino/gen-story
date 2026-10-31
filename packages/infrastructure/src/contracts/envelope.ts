// The one result shape every authoring operation returns, whether called from the CLI or
// from the Tool Calling adapter.
import { FilmFailure, type FilmError } from "./errors.js";

export interface Warning {
  code: string;
  path: string;
  message: string;
  disposition: { acceptedBy: string; reason: string } | null;
}

export interface Mutation {
  kind: string;
  target: string;
  beforeDigest: string | null;
  afterDigest: string | null;
}

export interface ResultEnvelope<T = unknown> {
  ok: boolean;
  operation: string;
  dryRun: boolean;
  errors: FilmError[];
  warnings: Warning[];
  hashes: Record<string, string>;
  evidence: string[];
  mutations: Mutation[];
  result?: T;
}

export interface EnvelopeParts<T> {
  result?: T;
  warnings?: Warning[];
  hashes?: Record<string, string>;
  evidence?: string[];
  mutations?: Mutation[];
}

export function success<T>(
  operation: string,
  dryRun: boolean,
  parts: EnvelopeParts<T> = {},
): ResultEnvelope<T> {
  return {
    ok: true,
    operation,
    dryRun,
    errors: [],
    warnings: parts.warnings ?? [],
    hashes: parts.hashes ?? {},
    evidence: parts.evidence ?? [],
    mutations: parts.mutations ?? [],
    ...(parts.result === undefined ? {} : { result: parts.result }),
  };
}

export function failure(
  operation: string,
  dryRun: boolean,
  errors: FilmError[],
  parts: EnvelopeParts<never> = {},
): ResultEnvelope<never> {
  return { ...success<never>(operation, dryRun, parts), ok: false, errors };
}

/** Runs a service body and converts a FilmFailure into a failed envelope. Other errors propagate. */
export function envelope<T>(
  operation: string,
  dryRun: boolean,
  body: () => EnvelopeParts<T>,
): ResultEnvelope<T> {
  try {
    return success(operation, dryRun, body());
  } catch (error) {
    if (error instanceof FilmFailure)
      return failure(operation, dryRun, error.errors);
    throw error;
  }
}

/** The asynchronous form of `envelope`, for operations that drive the browser and the encoder. */
export async function envelopeAsync<T>(
  operation: string,
  dryRun: boolean,
  body: () => Promise<EnvelopeParts<T>>,
): Promise<ResultEnvelope<T>> {
  try {
    return success(operation, dryRun, await body());
  } catch (error) {
    if (error instanceof FilmFailure)
      return failure(operation, dryRun, error.errors);
    throw error;
  }
}
