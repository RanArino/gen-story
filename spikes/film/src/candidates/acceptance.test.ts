// M6 acceptance in temporary state: the torn-reveal lifecycle end to end (A26) and exact-version
// replay after 1.1.0 (A28). Approvals and reviews are created as the operator and an independent
// reviewer would; nothing touches the operator's state. Needs Chrome and ffmpeg.
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createService } from "../authoring/service.js";
import { digestOf } from "../contracts/canonical.js";
import type { CapabilityManifest, CapabilityRequest, FilmStyleRecipe, FilmTreatment, ResolvedRenderPlan } from "../contracts/types.js";
import type { FrameSample } from "../render/render-chapter.js";
import { forkCut } from "../testing/cuts.js";
import { chapters, promoteThroughLifecycle, scaffoldCandidate, VALID_DIR } from "../testing/candidates.js";
import { readFixture } from "../testing/fixtures.js";
import { operatorApproves } from "../testing/state.js";
import { createWorld } from "../testing/world.js";
import { candidateDir } from "./candidate.js";

const CHROME = !!process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH);
const MINUTE = 60_000;
const TORN = "film.transition.torn-reveal";

const codes = (env: { errors: { code: string }[] }) => env.errors.map((e) => e.code);

describe.skipIf(!CHROME)("torn-reveal acceptance", () => {
  const world = CHROME ? createWorld({ liveEnvironment: true }) : null!;
  let board: ReturnType<typeof forkCut>;
  let tornTreatment: FilmTreatment;
  let pinned: { plan: ResolvedRenderPlan; planDigest: string; samples: FrameSample[] };

  const compileTo = (treatment: FilmTreatment, outName: string) => {
    const env = world.service.compile({ treatment, chapters: chapters(), write: true, outName });
    expect(env.ok, JSON.stringify(env.errors)).toBe(true);
    return env.result!;
  };

  it("[A26] torn-reveal goes through every M6 stage in order, each refusing without its prerequisite, then renders in memory-torn", async () => {
    const { service, paths } = world;
    board = forkCut(world, "memory-board", "org.local.board-acceptance");
    const request = readFixture<CapabilityRequest>("requests/torn-reveal.request.json");

    // 1. Request approval precedes any candidate file.
    expect(codes(service.candidateScaffold({ request, dryRun: false }))).toEqual(["FS_APPROVAL_REQUIRED"]);
    expect(existsSync(candidateDir(paths, request.id))).toBe(false);
    const requestApproval = operatorApproves(paths, "request", digestOf(request));
    expect(service.candidateScaffold({ request, approvalId: requestApproval, dryRun: false }).ok).toBe(true);
    const dir = candidateDir(paths, request.id);
    cpSync(`${VALID_DIR}manifest.json`, `${dir}manifest.json`);
    cpSync(`${VALID_DIR}implementation.mjs`, `${dir}implementation.mjs`);

    // 2–3. Nothing runs or compiles before a passing static report.
    expect(codes(service.candidateRun({ candidate: "torn-reveal" }))).toEqual(["FS_SEMANTIC_INVALID"]);
    expect(codes(service.candidateCompile({ candidate: "torn-reveal", treatment: board.treatment, chapters: chapters() }))).toEqual(["FS_SEMANTIC_INVALID"]);
    const checked = service.candidateStaticCheck({ candidate: "torn-reveal" });
    expect(checked.ok, JSON.stringify(checked.errors)).toBe(true);

    // 4–5. Execution needs its own exact approval; evidence needs the run.
    expect(codes(service.candidateRun({ candidate: "torn-reveal", approvalId: requestApproval, dryRun: false }))).toEqual(["FS_APPROVAL_MISMATCH"]);
    const executionApproval = operatorApproves(paths, "execution", checked.hashes.execution!);
    expect(codes(await service.candidateEvidence({ candidate: "torn-reveal", approvalId: executionApproval, dryRun: false }))).toEqual(["FS_SEMANTIC_INVALID"]);
    expect(service.candidateRun({ candidate: "torn-reveal", approvalId: executionApproval, dryRun: false }).ok).toBe(true);
    const compiled = service.candidateCompile({ candidate: "torn-reveal", treatment: board.treatment, chapters: chapters() });
    expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);

    // 6. Promotion needs evidence first.
    expect(codes(service.registryPromote({ candidate: "torn-reveal", dryRun: false }))).toEqual(["FS_SEMANTIC_INVALID"]);
    const evidence = await service.candidateEvidence({ candidate: "torn-reveal", approvalId: executionApproval, dryRun: false });
    expect(evidence.ok, JSON.stringify(evidence.errors)).toBe(true);

    // 7–8. Review, then the exact promotion approval.
    const target = service.candidatePromotionTarget({ candidate: "torn-reveal" }).result!;
    const promotionApproval = operatorApproves(paths, "promotion", target.digest);
    expect(codes(service.registryPromote({ candidate: "torn-reveal", approvalId: promotionApproval, dryRun: false }))).toEqual(["FS_REVIEW_REQUIRED"]);
    expect(service.catalogSearch({ query: "torn" }).result).toEqual([]);
    service.reviewRecord({ subjectDigest: target.digest, subject: target.subject, reviewer: "acceptance reviewer", verdict: "accept", notes: "Edge reads as torn paper." });
    expect(codes(service.registryPromote({ candidate: "torn-reveal", dryRun: false }))).toEqual(["FS_APPROVAL_REQUIRED"]);
    expect(service.registryPromote({ candidate: "torn-reveal", approvalId: promotionApproval, dryRun: false }).ok).toBe(true);
    expect(service.catalogSearch({ query: "torn" }).result!.map((h) => `${h.id}@${h.version}`)).toEqual([`${TORN}@1.0.0`]);

    // 9. memory-torn: fork, compile, and render one Chapter with the promoted transition.
    const fork = service.recipeFork({ source: { id: board.recipe.id, revision: board.recipe.revision }, id: "org.local.memory-torn", slots: { transition: { id: TORN, version: "1.0.0" } }, dryRun: false });
    expect(fork.ok, JSON.stringify(fork.errors)).toBe(true);
    const recipe = fork.result!.recipe as FilmStyleRecipe;
    tornTreatment = { ...board.treatment, id: "memory-torn", recipe: { id: recipe.id, revision: recipe.revision, digest: fork.result!.digest } };
    const [c1] = compileTo(tornTreatment, "memory-torn");
    expect(c1!.plan.capabilities.find((c) => c.slot === "transition")!.active).toEqual({ id: TORN, version: "1.0.0" });
    const planFile = `${paths.out}plans/memory-torn/c1.plan.json`;
    const timing = operatorApproves(paths, "timing", c1!.proposalDigest);
    const rendered = await service.renderChapter({ planFile, approvalId: timing });
    expect(rendered.ok, JSON.stringify(rendered.errors)).toBe(true);
    expect(rendered.result!.artifact.verified).toBe(true);
    expect(rendered.result!.blocked).toEqual([]);
    pinned = { plan: c1!.plan, planDigest: rendered.result!.artifact.planDigest, samples: rendered.result!.samples };
  }, 10 * MINUTE);

  it("[A28] after 1.1.0 is promoted, the pinned 1.0.0 Plan replays with the same Plan digest and frames, and a removed version fails", async () => {
    expect(pinned, "A26 must run first").toBeDefined();
    const { service, paths } = world;
    const manifest = { ...(JSON.parse(readFileSync(`${VALID_DIR}manifest.json`, "utf8")) as CapabilityManifest), version: "1.1.0" };
    manifest.params = { ...manifest.params, jaggedness: { ...manifest.params.jaggedness!, default: 0.024 } };
    scaffoldCandidate(world, "torn-reveal-1-1-0", manifest, readFileSync(`${VALID_DIR}implementation.mjs`, "utf8"), true);
    await promoteThroughLifecycle(world, "torn-reveal-1-1-0", board.treatment);
    expect(service.catalogSearch({ query: "torn" }).result!.map((h) => h.version)).toEqual(["1.0.0", "1.1.0"]);

    // The 1.1.0 default really changes the output: a fork that selects it compiles a different Plan.
    const newer = service.recipeFork({ source: { id: board.recipe.id, revision: board.recipe.revision }, id: "org.local.memory-torn-next", slots: { transition: { id: TORN, version: "1.1.0" } }, dryRun: false });
    const newerRecipe = newer.result!.recipe as FilmStyleRecipe;
    const [next] = compileTo({ ...tornTreatment, id: "memory-torn-next", recipe: { id: newerRecipe.id, revision: newerRecipe.revision, digest: newer.result!.digest } }, "memory-torn-next");
    expect(digestOf(next!.plan.layers)).not.toBe(digestOf(pinned.plan.layers));

    // The pinned Plan replays exactly and renders the same frames.
    const planFile = `${paths.out}plans/memory-torn/c1.plan.json`;
    const replayed = service.replay({ planFile, treatment: tornTreatment, chapters: chapters() });
    expect(replayed.ok, JSON.stringify(replayed.errors)).toBe(true);
    expect(replayed.hashes.plan).toBe(pinned.planDigest);
    const timing = operatorApproves(paths, "timing", pinned.plan.timing.proposalDigest);
    const again = await service.renderChapter({ planFile, approvalId: timing, bypassCache: true });
    expect(again.ok, JSON.stringify(again.errors)).toBe(true);
    expect(again.result!.cache).toBe("miss");
    expect(again.result!.samples).toEqual(pinned.samples);

    // A scratch registry copy without the pinned version refuses to replay.
    const scratch = `${paths.state.replace(/state\/$/, "")}scratch-state/`;
    cpSync(paths.state, scratch, { recursive: true });
    rmSync(`${scratch}registry/records/${TORN}@1.0.0.json`);
    // Replay checks the lock before compiling, so the scratch service needs no environment.
    const missing = createService({ paths: { ...paths, state: scratch } });
    expect(codes(missing.replay({ planFile, treatment: tornTreatment, chapters: chapters() }))).toEqual(["FS_REPLAY_MISSING_VERSION"]);
    expect(service.registry.record(TORN, "1.0.0")).toBeDefined();
  }, 15 * MINUTE);
});
