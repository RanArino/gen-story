import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { FilmFailure } from "../contracts/errors.js";
import type { CapabilityRequest } from "../contracts/types.js";
import { writeJson } from "../paths.js";
import {
  checkAndRun,
  scaffoldTornReveal,
  chapters,
} from "../testing/candidates.js";
import { readFixture } from "../testing/fixtures.js";
import { createWorld } from "../testing/world.js";
import { callTool } from "../adapters/tool-calling.js";
import {
  normalizedIdentity,
  prepareReview,
  recordReview,
  requireAcceptedReview,
} from "./reviews.js";

function code(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof FilmFailure) return e.errors[0]?.code;
    throw e;
  }
}

const world = createWorld();
const { paths, service } = world;
const candidate = "torn-reveal";
const scaffolded = scaffoldTornReveal(world);
checkAndRun(world, candidate);
service.candidateCompile({
  candidate,
  treatment: readFixture("project/treatments/test-board.json"),
  chapters: chapters(),
});
const runtime = JSON.parse(
  readFileSync(`${scaffolded.dir}runtime.json`, "utf8"),
);
writeJson(`${scaffolded.dir}evidence.json`, {
  ok: true,
  subject: runtime.subject,
});
const target = service.candidatePromotionTarget({ candidate }).result!;
const input = {
  candidate,
  subject: target.subject,
  subjectDigest: target.digest,
  reviewer: "Independent reviewer",
  verdict: "accept" as const,
  notes: "Inspected evidence.",
};

describe("operator review boundary", () => {
  it("prepares without persistence, and rejects applied Tool Calling", async () => {
    expect(service.reviewRecord(input).result!.operatorCommand).toContain(
      "--candidate",
    );
    expect(existsSync(`${paths.state}reviews/`)).toBe(false);
    expect(
      (await callTool("review_record", { ...input, dryRun: false }, service))
        .errors[0]?.code,
    ).toBe("FS_OPERATOR_REQUIRED");
  });
  it("rejects Manifest author and requester after identity normalization, and stale targets", () => {
    const prepared = prepareReview(paths, service.registry, input);
    for (const reviewer of [prepared.author, prepared.requester].map(
      (name) => `  ${name.toUpperCase()}  `,
    )) {
      expect(service.reviewRecord({ ...input, reviewer }).errors[0]?.code).toBe(
        "FS_REVIEW_REQUIRED",
      );
    }
    expect(normalizedIdentity("  ＳＴＲＡＳＳＥ  ")).toBe(
      normalizedIdentity("Straße"),
    );
    expect(
      service.reviewRecord({
        ...input,
        subjectDigest: `sha256:${"0".repeat(64)}`,
      }).errors[0]?.code,
    ).toBe("FS_DIGEST_MISMATCH");
  });
  it("refuses noninteractive persistence and records confirmed v2 evidence with TTYs", () => {
    expect(
      code(() =>
        recordReview(
          paths,
          service.registry,
          input,
          "Operator",
          target.digest.slice(7, 15),
        ),
      ),
    ).toBe("FS_OPERATOR_REQUIRED");
    const stdin = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdout = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    try {
      expect(
        code(() =>
          recordReview(paths, service.registry, input, "Operator", "wrong"),
        ),
      ).toBe("FS_APPROVAL_MISMATCH");
      const recorded = recordReview(
        paths,
        service.registry,
        input,
        "Operator",
        target.digest.slice(7, 15),
      );
      expect(recorded.schema).toBe("film.review-record@2");
      const binding = prepareReview(paths, service.registry, input);
      expect(
        requireAcceptedReview(paths.state, target.digest, binding).id,
      ).toBe(recorded.id);
      expect(
        service.registryPromote({ candidate, dryRun: false }).errors[0]?.code,
      ).toBe("FS_APPROVAL_REQUIRED");
      expect(
        code(() =>
          requireAcceptedReview(paths.state, target.digest, {
            ...binding,
            author: "Changed author",
          }),
        ),
      ).toBe("FS_REVIEW_REQUIRED");
    } finally {
      if (stdin) Object.defineProperty(process.stdin, "isTTY", stdin);
      else Reflect.deleteProperty(process.stdin, "isTTY");
      if (stdout) Object.defineProperty(process.stdout, "isTTY", stdout);
      else Reflect.deleteProperty(process.stdout, "isTTY");
      vi.restoreAllMocks();
    }
  });
  it("binds both identities from Manifest and approved request", () => {
    const request = JSON.parse(
      readFileSync(`${scaffolded.dir}request.json`, "utf8"),
    ) as { request: CapabilityRequest };
    expect(prepareReview(paths, service.registry, input).requester).toBe(
      request.request.requester.name,
    );
  });
});
