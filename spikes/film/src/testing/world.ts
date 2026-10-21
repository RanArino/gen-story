// A complete, temporary spike world for tests: bootstrapped built-ins, promoted fixture fonts,
// and a fixed environment fingerprint. Approvals are created as the operator would at the prompt.
import { createService, type AuthoringService } from "../authoring/service.js";
import type { EnvFingerprint } from "../env/fingerprint.js";
import type { FontDraft } from "../fonts/fonts.js";
import type { SpikePaths } from "../paths.js";
import { readFixture } from "./fixtures.js";
import { operatorApproves, tempPaths } from "./state.js";

export const TEST_ENV: EnvFingerprint = {
  node: "v25.2.1",
  chrome: { path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", version: "155.0.8059.85" },
  ffmpeg: "8.1.2",
  ffprobe: "8.1.2",
  os: "darwin 25.6.0",
  painterDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
};

export interface World {
  paths: SpikePaths;
  service: AuthoringService;
}

export function promoteFixtureFont(world: World, incoming: string, draftFile: string): string {
  const { service, paths } = world;
  const draft = readFixture<FontDraft>(`fonts/${draftFile}`);
  const q = service.fontQuarantine({ incoming, manifest: draft, dryRun: false });
  if (!q.ok) throw new Error(JSON.stringify(q.errors));
  const candidate = q.result!.candidateId;
  const inspected = service.fontInspect({ candidate });
  if (!inspected.ok) throw new Error(JSON.stringify(inspected.errors));
  const digest = inspected.hashes.manifest!;
  const promoted = service.fontPromote({ candidate, approvalId: operatorApproves(paths, "promotion", digest), dryRun: false });
  if (!promoted.ok) throw new Error(JSON.stringify(promoted.errors));
  return digest;
}

export function createWorld(): World {
  const paths = tempPaths();
  const service = createService({ paths, environment: () => TEST_ENV });
  const world = { paths, service };
  const boot = service.bootstrap();
  if (!boot.ok) throw new Error(JSON.stringify(boot.errors));
  service.fontFixtures();
  promoteFixtureFont(world, "fixture-sans-jp", "fixture-sans-jp.draft.json");
  promoteFixtureFont(world, "fixture-serif-jp", "fixture-serif-jp.draft.json");
  promoteFixtureFont(world, "fixture-latin", "fixture-latin.draft.json");
  return world;
}
