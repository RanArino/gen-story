import { expect, it } from "vitest";
import type { FilmChapters, FilmTreatment } from "../contracts/types.js";
import { readFixture } from "../testing/fixtures.js";
import { createWorld } from "../testing/world.js";

it("rejects Chapter Plans from another project even when Treatment IDs coincide", () => {
  const { service } = createWorld();
  const treatment = readFixture<FilmTreatment>(
    "project/treatments/test-baseline.json",
  );
  const chapters = readFixture<FilmChapters>("project/chapters.json");
  const compiled = service.compile({ treatment, chapters }).result!;
  const file = {
    name: "fixture.mp4",
    sha256: `sha256:${"a".repeat(64)}`,
    bytes: 1,
  };
  const artifacts = compiled.map(({ plan }) => ({
    plan,
    artifact: { files: { mp4: file, stem: { ...file, name: "fixture.wav" } } },
  }));
  const result = service.concatPlan({
    treatment: { ...treatment, projectId: "another-project" },
    chapters,
    artifacts,
  });
  expect(result.errors[0]?.code).toBe("FS_SEMANTIC_INVALID");
});

it("compiles any project slug the Treatment schema accepts, including a leading digit", () => {
  const { service } = createWorld();
  const treatment = readFixture<FilmTreatment>(
    "project/treatments/test-baseline.json",
  );
  const chapters = readFixture<FilmChapters>("project/chapters.json");
  const result = service.compile({
    treatment: { ...treatment, projectId: "2026-trip" },
    chapters,
  });
  expect(result.errors).toEqual([]);
  expect(result.result![0]!.plan.provenance.projectId).toBe("2026-trip");
});
