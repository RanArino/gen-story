// Every negative candidate under fixtures/candidates/invalid/ is blocked at its first applicable
// gate (static, compile, then run) and never reaches the catalog. All state is temporary.
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { digestOf } from "../contracts/canonical.js";
import type { CapabilityManifest } from "../contracts/types.js";
import { forkCut } from "../testing/cuts.js";
import { chapters, INVALID_DIR, scaffoldCandidate, scaffoldTornReveal, type ScaffoldedCandidate } from "../testing/candidates.js";
import { operatorApproves } from "../testing/state.js";
import { createWorld, type World } from "../testing/world.js";

interface NegativeSpec {
  expect: { gate: "static" | "compile" | "run"; code: string };
  manifest: Partial<CapabilityManifest>;
}

const NAMES = readdirSync(INVALID_DIR).sort();
// Candidate names are slugs; `collides-1.0.0` keeps the plan's name for its fixture directory.
const slug = (name: string) => name.replaceAll(".", "-");

let world: World;
let pairing: ReturnType<typeof forkCut>;
const scaffolded = new Map<string, ScaffoldedCandidate>();

beforeAll(() => {
  world = createWorld();
  // A promoted torn-reveal@1.0.0 for the collision case. Test-only registry setup.
  const torn = scaffoldTornReveal(world);
  world.service.registry.promote({
    entity: "capability", id: torn.manifest.id, version: torn.manifest.version, kind: "transition", trust: "promoted",
    manifest: torn.manifest, implementation: readFileSync(`${torn.dir}implementation.mjs`), assets: [],
    validationReportDigests: [], approvalIds: [], reviewId: null,
  });
  world.service.registry.activate(torn.manifest.id, torn.manifest.version);
  // requires-full-frame is paired with memory-board; every candidate compiles against the same pairing.
  pairing = forkCut(world, "memory-board", "org.local.negative-board");
  // Scaffold every candidate first so that fallback edges between siblings are visible.
  for (const name of NAMES) {
    const spec = JSON.parse(readFileSync(`${INVALID_DIR}${name}/candidate.json`, "utf8")) as NegativeSpec;
    scaffolded.set(name, scaffoldCandidate(world, slug(name), spec.manifest, readFileSync(`${INVALID_DIR}${name}/implementation.mjs`, "utf8")));
  }
});

function firstFailure(candidate: string): { gate: string; code: string } | null {
  const { service } = world;
  const checked = service.candidateStaticCheck({ candidate });
  if (!checked.ok) return { gate: "static", code: checked.errors[0]!.code };
  const compiled = service.candidateCompile({ candidate, treatment: pairing.treatment, chapters: chapters() });
  if (!compiled.ok) return { gate: "compile", code: compiled.errors[0]!.code };
  const approvalId = operatorApproves(world.paths, "execution", checked.hashes.execution!);
  const run = service.candidateRun({ candidate, approvalId, dryRun: false });
  if (!run.ok) return { gate: "run", code: run.errors[0]!.code };
  return null;
}

describe("negative candidates", () => {
  it("[A27] covers every negative candidate named by M6", () => {
    expect(NAMES).toEqual([
      "collides-1.0.0", "fallback-cycle-a", "fallback-cycle-b", "forbidden-import", "forbidden-network", "infinite-loop",
      "missing-fallback", "primitive-flood", "requires-full-frame", "self-granted-permission", "stateful-nondeterministic", "throws-on-portrait",
    ]);
  });

  for (const name of NAMES) {
    it(`[A27] ${name} is blocked at its first applicable gate and never offered`, () => {
      const spec = JSON.parse(readFileSync(`${INVALID_DIR}${name}/candidate.json`, "utf8")) as NegativeSpec;
      const candidate = scaffolded.get(name)!;
      expect(firstFailure(candidate.candidate)).toEqual(spec.expect);
      const hits = world.service.catalogSearch({ query: candidate.manifest.id! }).result!;
      expect(hits.map((h) => h.digest)).not.toContain(digestOf(candidate.manifest));
      if (name !== "collides-1.0.0") expect(world.service.registry.record(candidate.manifest.id!, candidate.manifest.version!)).toBeUndefined();
    }, 90_000);
  }
});
