// Trusted-painter evidence for torn-reveal (M6 step 6). Launches the pinned Chrome and ffmpeg, so
// it runs only when CHROME_PATH names an installed Chrome. All state is temporary.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { digestBytes } from "../contracts/canonical.js";
import { probe } from "../render/ffmpeg.js";
import { forkCut } from "../testing/cuts.js";
import { chapters, checkAndRun, scaffoldTornReveal } from "../testing/candidates.js";
import { createWorld } from "../testing/world.js";
import type { CandidateEvidence } from "./evidence.js";

const CHROME = !!process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH);

describe.skipIf(!CHROME)("candidate evidence", () => {
  it("paints the approved outputs into a verified clip and contact sheet bound to the execution target", async () => {
    const world = createWorld();
    const { paths, service } = world;
    const { treatment } = forkCut(world, "memory-board", "org.local.board-candidates");
    scaffoldTornReveal(world);
    const { executionDigest, executionApproval } = checkAndRun(world, "torn-reveal");
    const env = await service.candidateEvidence({ candidate: "torn-reveal", approvalId: executionApproval, dryRun: false });
    expect(env.ok, JSON.stringify(env.errors)).toBe(true);
    const evidence = JSON.parse(readFileSync(`${paths.state}quarantine/capabilities/torn-reveal/evidence.json`, "utf8")) as CandidateEvidence;
    expect(evidence.subject.digest).toBe(executionDigest);
    expect(evidence.cases.map((c) => c.name)).toEqual(["landscape-defaults", "landscape-jaggedness-0", "landscape-jaggedness-1"]);
    expect(evidence.blocked).toEqual([]);
    const clip = `${paths.out}candidates/torn-reveal/evidence/clip.mp4`;
    expect(digestBytes(readFileSync(clip))).toBe(evidence.clip.sha256);
    expect((await probe(clip)).video).toMatchObject({ codec: "h264", width: 1920, height: 1080, frames: 30 });
    expect(digestBytes(readFileSync(`${paths.out}candidates/torn-reveal/evidence/contact-sheet.png`))).toBe(evidence.contactSheet.sha256);

    // Evidence completes the reports promotion binds.
    expect(service.candidateCompile({ candidate: "torn-reveal", treatment, chapters: chapters() }).ok).toBe(true);
    expect(service.candidatePromotionTarget({ candidate: "torn-reveal" }).ok).toBe(true);

    // A runtime report that no longer matches the re-executed outputs blocks evidence.
    const runtimeFile = `${paths.state}quarantine/capabilities/torn-reveal/runtime.json`;
    const runtime = JSON.parse(readFileSync(runtimeFile, "utf8"));
    runtime.data.outputs[0] = `sha256:${"0".repeat(64)}`;
    writeFileSync(runtimeFile, JSON.stringify(runtime));
    expect((await service.candidateEvidence({ candidate: "torn-reveal", approvalId: executionApproval, dryRun: false })).errors[0]?.code).toBe("FS_NONDETERMINISTIC");
  }, 180_000);
});
