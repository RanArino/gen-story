import { operatorReviews } from "../testing/candidates.js";
// The torn-reveal lifecycle gates after the contained run, in temporary state: the fallback compile
// (M6 step 5), FS_NOT_PROMOTED for quarantined references, evidence gating, review-then-approval
// promotion, and promoted loading through the contained process.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { digestOf } from "../contracts/canonical.js";
import type { FilmStyleRecipe, FilmTreatment, GroupNode, PainterNode, RegistryRecord } from "../contracts/types.js";
import { forkCut } from "../testing/cuts.js";
import { chapters, checkAndRun, scaffoldTornReveal } from "../testing/candidates.js";
import { operatorApproves } from "../testing/state.js";
import { createWorld, type World } from "../testing/world.js";

const ok = <T>(env: { ok: boolean; errors: unknown[]; result?: T }): T => {
  expect(env.ok, JSON.stringify(env.errors)).toBe(true);
  return env.result as T;
};

function groups(nodes: PainterNode[]): GroupNode[] {
  return nodes.flatMap((n) => (n.type === "group" ? [n, ...groups(n.children)] : []));
}

describe("torn-reveal fallback compile before promotion", () => {
  let world: World;
  let board: ReturnType<typeof forkCut>;
  beforeAll(() => {
    world = createWorld();
    board = forkCut(world, "memory-board", "org.local.board-candidates");
    scaffoldTornReveal(world);
  });

  it("requires a current static report and never executes the quarantined code", () => {
    expect(world.service.candidateCompile({ candidate: "torn-reveal", treatment: board.treatment, chapters: chapters() }).errors[0]?.code).toBe("FS_SEMANTIC_INVALID");
    ok(world.service.candidateStaticCheck({ candidate: "torn-reveal" }));
    const report = ok(world.service.candidateCompile({ candidate: "torn-reveal", treatment: board.treatment, chapters: chapters() })) as {
      variants: { options: { reducedMotion: boolean; forceLevel0: boolean }; active: string; activeLevel: number; chain: string[]; compiled: boolean; plans: unknown[] }[];
    };
    const [standard, reduced, forced] = report.variants;
    expect(standard).toMatchObject({ active: "film.transition.torn-reveal@1.0.0", compiled: false, plans: [] });
    for (const variant of [reduced!, forced!]) {
      expect(variant).toMatchObject({ active: "film.transition.dissolve@1.0.0", activeLevel: 0, chain: ["film.transition.torn-reveal@1.0.0", "film.transition.dissolve@1.0.0"], compiled: true });
      expect(variant.plans.length).toBe(chapters().chapters.length);
    }
    expect(reduced!.options).toEqual({ forceLevel0: false, reducedMotion: true });
    expect(forced!.options).toEqual({ forceLevel0: true, reducedMotion: false });
    expect(existsSync(`${world.paths.state}quarantine/capabilities/torn-reveal/run-first`)).toBe(false);
    expect(existsSync(`${world.paths.state}quarantine/capabilities/torn-reveal/compile.json`)).toBe(true);
  });

  it("[A27] refuses a Recipe or fork that references the quarantined candidate with FS_NOT_PROMOTED", () => {
    const manifest = JSON.parse(readFileSync(`${world.paths.state}quarantine/capabilities/torn-reveal/manifest.json`, "utf8"));
    const recipe: FilmStyleRecipe = {
      ...board.recipe,
      revision: "r2",
      capabilities: board.recipe.capabilities.map((c) => (c.slot === "transition" ? { slot: "transition", ref: { id: manifest.id, version: manifest.version, digest: digestOf(manifest) } } : c)),
    };
    writeFileSync(`${world.paths.state}recipes/${recipe.id}.${recipe.revision}.json`, JSON.stringify(recipe));
    const treatment: FilmTreatment = { ...board.treatment, recipe: { id: recipe.id, revision: recipe.revision, digest: digestOf(recipe) } };
    const compiled = world.service.compile({ treatment, chapters: chapters() });
    expect(compiled.errors.map((e) => e.code)).toEqual(["FS_NOT_PROMOTED"]);
    const fork = world.service.recipeFork({ source: { id: "system.memory-board", revision: "r1" }, id: "org.local.memory-torn", slots: { transition: { id: manifest.id, version: manifest.version } } });
    expect(fork.errors.map((e) => e.code)).toEqual(["FS_NOT_PROMOTED"]);
  });
});

describe("torn-reveal evidence and promotion gates", () => {
  let world: World;
  let board: ReturnType<typeof forkCut>;
  let executionApproval: string;
  beforeAll(() => {
    world = createWorld();
    board = forkCut(world, "memory-board", "org.local.board-candidates");
    scaffoldTornReveal(world);
    ({ executionApproval } = checkAndRun(world, "torn-reveal"));
    ok(world.service.candidateCompile({ candidate: "torn-reveal", treatment: board.treatment, chapters: chapters() }));
  });

  it("gates evidence on the exact execution approval and a current runtime report, and dry run renders nothing", async () => {
    const { service } = world;
    expect((await service.candidateEvidence({ candidate: "torn-reveal", dryRun: false })).errors[0]?.code).toBe("FS_APPROVAL_REQUIRED");
    const wrong = operatorApproves(world.paths, "promotion", "sha256:" + "1".repeat(64));
    expect((await service.candidateEvidence({ candidate: "torn-reveal", approvalId: wrong, dryRun: false })).errors[0]?.code).toBe("FS_APPROVAL_MISMATCH");
    const dry = await service.candidateEvidence({ candidate: "torn-reveal", approvalId: executionApproval });
    expect(ok(dry)).toMatchObject({ evidence: null });
    expect(existsSync(`${world.paths.out}candidates/torn-reveal/evidence`)).toBe(false);
  });

  it("requires every report, then an accepted review, then the exact promotion approval", () => {
    const { service, paths } = world;
    const dir = `${paths.state}quarantine/capabilities/torn-reveal/`;
    expect(service.registryPromote({ candidate: "torn-reveal" }).errors[0]?.code).toBe("FS_SEMANTIC_INVALID");
    // Stands in for Chrome evidence (exercised in evidence.test.ts); bound to the current execution target.
    const executionDigest = JSON.parse(readFileSync(`${dir}runtime.json`, "utf8")).subject.digest as string;
    writeFileSync(`${dir}evidence.json`, JSON.stringify({ candidate: "torn-reveal", ok: true, subject: { id: "film.transition.torn-reveal", version: "1.0.0", digest: executionDigest }, stub: "test" }));
    const target = ok(service.candidatePromotionTarget({ candidate: "torn-reveal" })) as { subject: string; digest: string };
    expect(target.subject).toBe("film.transition.torn-reveal@1.0.0");

    expect(service.registryPromote({ candidate: "torn-reveal", dryRun: false }).errors[0]?.code).toBe("FS_REVIEW_REQUIRED");
    const early = operatorApproves(paths, "promotion", target.digest);
    expect(service.registryPromote({ candidate: "torn-reveal", approvalId: early, dryRun: false }).errors[0]?.code).toBe("FS_REVIEW_REQUIRED");
    operatorReviews(world, { candidate: "torn-reveal", subjectDigest: target.digest, subject: target.subject, reviewer: "test reviewer", verdict: "reject", notes: "Edge too regular." });
    expect(service.registryPromote({ candidate: "torn-reveal", approvalId: early, dryRun: false }).errors[0]?.code).toBe("FS_REVIEW_REQUIRED");
    operatorReviews(world, { candidate: "torn-reveal", subjectDigest: target.digest, subject: target.subject, reviewer: "test reviewer", verdict: "accept", notes: "Edge reads as torn paper." });
    expect(service.registryPromote({ candidate: "torn-reveal", dryRun: false }).errors[0]?.code).toBe("FS_APPROVAL_REQUIRED");
    expect(service.registryPromote({ candidate: "torn-reveal", approvalId: executionApproval, dryRun: false }).errors[0]?.code).toBe("FS_APPROVAL_MISMATCH");
    expect(service.registryPromote({ candidate: "torn-reveal", approvalId: early }).mutations).toEqual([]);
    expect(service.registry.record("film.transition.torn-reveal", "1.0.0")).toBeUndefined();

    // A changed report after review moves the target: the review and approval no longer apply.
    const compile = JSON.parse(readFileSync(`${dir}compile.json`, "utf8"));
    writeFileSync(`${dir}compile.json`, JSON.stringify({ ...compile, createdAt: "2000-01-01T00:00:00.000Z" }));
    expect(service.registryPromote({ candidate: "torn-reveal", approvalId: early, dryRun: false }).errors[0]?.code).toBe("FS_REVIEW_REQUIRED");
    writeFileSync(`${dir}compile.json`, JSON.stringify(compile));

    const promoted = service.registryPromote({ candidate: "torn-reveal", approvalId: early, dryRun: false });
    expect(promoted.mutations.map((m) => m.kind)).toEqual(["registry.promote"]);
    const record = service.registry.record("film.transition.torn-reveal", "1.0.0") as RegistryRecord;
    expect(record).toMatchObject({ trust: "promoted", reviewId: expect.stringMatching(/^rev-/) });
    expect(record.approvalIds).toHaveLength(3);
    expect(record.validationReportDigests).toHaveLength(4);
    expect(service.registryVerify().ok).toBe(true);
    expect(service.catalogSearch({ query: "torn" }).result!.map((h) => `${h.id}@${h.version}`)).toEqual(["film.transition.torn-reveal@1.0.0"]);
    // Identical bytes: a repeated static check and promotion are no-ops, not collisions.
    ok(service.candidateStaticCheck({ candidate: "torn-reveal" }));
  });

  it("loads the promoted implementation from the registry and runs it only in the contained process", () => {
    const { service } = world;
    const fork = ok(service.recipeFork({
      source: { id: board.recipe.id, revision: board.recipe.revision },
      id: "org.local.memory-torn",
      slots: { transition: { id: "film.transition.torn-reveal", version: "1.0.0" } },
      dryRun: false,
    })) as { recipe: FilmStyleRecipe; digest: string };
    const treatment: FilmTreatment = { ...board.treatment, recipe: { id: fork.recipe.id, revision: fork.recipe.revision, digest: fork.digest } };
    const [first] = ok(service.compile({ treatment, chapters: chapters() })) as { plan: { capabilities: { slot: string; active: { id: string } }[]; layers: PainterNode[] } }[];
    expect(first!.plan.capabilities.find((c) => c.slot === "transition")!.active.id).toBe("film.transition.torn-reveal");
    const clipped = groups(first!.plan.layers).filter((g) => g.clipPolygon);
    expect(clipped.length).toBeGreaterThan(0);
    expect(clipped[0]!.clipPolygon!.length).toBe(15);
    expect(existsSync(`${world.paths.state}cache/capabilities/`)).toBe(true);
    // Recompiling yields the same Plan: the contained call is deterministic.
    const [again] = ok(service.compile({ treatment, chapters: chapters() })) as { plan: unknown }[];
    expect(digestOf(again!.plan)).toBe(digestOf(first!.plan));
  }, 120_000);
});
