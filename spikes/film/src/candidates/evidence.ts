// Trusted-painter evidence for a candidate transition. It re-executes only the approved synthetic
// inputs in the contained process, requires the outputs to match the runtime report byte for byte,
// and paints them over two locked images. Candidate code never runs in the browser or here.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { CapabilityOutput, Envelope } from "../capability-sdk/abi.js";
import { painterIdentity } from "../authoring/identity.js";
import { PROFILES } from "../compiler/compile.js";
import { planDigest } from "../compiler/fingerprint.js";
import { digestBytes, digestOf } from "../contracts/canonical.js";
import { fail } from "../contracts/errors.js";
import type { GroupNode, ImageNode, PainterNode } from "../contracts/types.js";
import { readMediaLock, type MediaLockEntry } from "../media/lock.js";
import { writeJson, type SpikePaths } from "../paths.js";
import { requireApproval } from "../registry/approvals.js";
import type { Registry } from "../registry/registry.js";
import { openPlan, withBrowser } from "../render/browser.js";
import { ffmpeg, frameCount, probe } from "../render/ffmpeg.js";
import { captureVideo } from "../render/render-chapter.js";
import { startServer } from "../render/server.js";
import { checkedCandidate, runtimeReport } from "./candidate.js";
import { candidateInputs } from "./inputs.js";
import { checkOutput, executeContained } from "./runtime.js";

/** The incoming scene holds after the transition window so the clip ends on a settled frame. */
const HOLD_MS = 300;
/** Contact-sheet columns: these fractions of the transition window, one row per parameter case. */
const SHEET_AT = [0.2, 0.4, 0.6, 0.8];

export interface CandidateEvidence {
  candidate: string;
  ok: true;
  subject: { id: string; version: string; digest: string };
  approvalId: string;
  runtimeReport: string;
  media: { outgoing: { asset: string; sha256: string }; incoming: { asset: string; sha256: string } };
  cases: { name: string; outputDigest: string; planFile: string; planDigest: string }[];
  clip: { file: string; sha256: string; case: string; frames: number; fps: number };
  contactSheet: { file: string; sha256: string; rows: string[]; timesMs: number[] };
  painter: { abi: string; digest: string };
  blocked: string[];
  toolchain: { node: string };
  createdAt: string;
}

function cover(entry: MediaLockEntry, startMs: number, endMs: number, width: number, height: number): ImageNode {
  const w = entry.widthPx!;
  const h = entry.heightPx!;
  const scale = Math.max(width / w, height / h);
  const sw = width / scale;
  const sh = height / scale;
  return {
    type: "image", startMs, endMs, asset: entry.path, sha256: entry.sha256,
    src: { x: (w - sw) / 2, y: (h - sh) / 2, w: sw, h: sh },
    dst: { x: 0, y: 0, w: width, h: height },
  };
}

/** The compiler's envelope rule: wrap the segment so the transition owns the outer group. */
function enveloped(content: GroupNode, envelope: Envelope | undefined): GroupNode {
  if (!envelope) return content;
  const group: GroupNode = { type: "group", startMs: content.startMs, endMs: content.endMs, children: [content] };
  if (envelope.opacity !== undefined) group.opacity = envelope.opacity;
  if (envelope.translateX !== undefined) group.translateX = envelope.translateX;
  if (envelope.clipPolygon !== undefined) group.clipPolygon = envelope.clipPolygon;
  if (envelope.brightness !== undefined || envelope.blur !== undefined) {
    group.filter = { ...(envelope.brightness !== undefined ? { brightness: envelope.brightness } : {}), ...(envelope.blur !== undefined ? { blur: envelope.blur } : {}) };
  }
  return group;
}

export async function candidateEvidence(paths: SpikePaths, registry: Registry, input: { candidate: string; approvalId?: string; dryRun?: boolean }) {
  const c = checkedCandidate(paths, registry, input.candidate);
  if (c.manifest.kind !== "transition") fail("FS_SEMANTIC_INVALID", "/candidate", "painter evidence is implemented for transitions only in this spike");
  const approval = requireApproval(paths.state, input.approvalId, "execution", c.executionDigest);
  const runtime = runtimeReport(c.dir, c.executionDigest);
  if (input.dryRun ?? true) return { executionDigest: c.executionDigest, evidence: null };

  // Exactly the approved inputs, so the execution approval covers this run as well.
  const fixtures = candidateInputs(c.manifest);
  const recorded = runtime.data?.outputs as string[] | undefined;
  const outputs = executeContained(c.source, fixtures.map((f) => f.input), `${c.dir}evidence-run`, 1).map((o) => o[0]!);
  outputs.forEach((raw, i) => {
    if (digestBytes(raw) !== recorded?.[i]) fail("FS_NONDETERMINISTIC", `/fixtures/${i}`, `${fixtures[i]!.name} differs from the runtime report`);
    checkOutput(raw, c.manifest);
  });

  const lock = readMediaLock(paths.media);
  const [outgoing, incoming] = lock.files.filter((f) => f.kind === "image" && f.widthPx && f.heightPx).sort((a, b) => (a.path < b.path ? -1 : 1));
  if (!outgoing || !incoming) fail("FS_ARTIFACT_VERIFY_FAILED", "", "evidence needs two locked images; run prepare:media");
  const profile = PROFILES["landscape-1080p30@1"]!;
  // One row per parameter case of the first fixture: defaults, then each bound.
  const prefix = `${c.manifest.fixtures[0]!.name}-`;
  const outDir = `${paths.out}candidates/${input.candidate}/evidence/`;
  mkdirSync(outDir, { recursive: true });
  const cases = fixtures.flatMap((fixture, i) => {
    if (!fixture.name.startsWith(prefix)) return [];
    const output = JSON.parse(outputs[i]!) as CapabilityOutput;
    const { startMs, endMs } = fixture.input.window;
    const runtimeMs = endMs + HOLD_MS;
    const segment = (entry: MediaLockEntry, from: number, to: number): GroupNode => ({ type: "group", startMs: from, endMs: to, children: [cover(entry, from, to, profile.widthPx, profile.heightPx)] });
    const layers: PainterNode[] = [
      { type: "rect", startMs: 0, endMs: runtimeMs, x: 0, y: 0, w: profile.widthPx, h: profile.heightPx, color: "#000000" },
      ...output.layers,
      enveloped(segment(outgoing, 0, endMs), output.envelopes?.outgoing),
      enveloped(segment(incoming, startMs, runtimeMs), output.envelopes?.incoming),
    ];
    // The painter reads only profile, timing.proposal.runtimeMs, fonts, and layers.
    const plan = { schema: "film.candidate-evidence-plan@1", subject: c.executionDigest, case: fixture.name, profile, timing: { proposal: { runtimeMs } }, fonts: [], layers };
    const planFile = `${outDir}${fixture.name}.plan.json`;
    writeJson(planFile, plan);
    return [{ name: fixture.name, outputDigest: recorded![i]!, planFile: `candidates/${input.candidate}/evidence/${fixture.name}.plan.json`, planDigest: planDigest(plan), window: { startMs, endMs }, runtimeMs }];
  });

  const clipCase = cases[0]!;
  const frames = frameCount(clipCase.runtimeMs, profile.fps);
  const timesMs = SHEET_AT.map((f) => Math.round(clipCase.window.startMs + f * (clipCase.window.endMs - clipCase.window.startMs)));
  const work = mkdtempSync(`${tmpdir()}/film-evidence-`);
  let blocked: string[] = [];
  try {
    const server = await startServer(paths);
    try {
      await withBrowser(async (browser) => {
        const video = await captureVideo(browser, server.origin, clipCase.planFile, frames, profile.fps, `${work}/clip.mp4`);
        blocked = video.blocked;
        let n = 0;
        for (const row of cases) {
          const page = await openPlan(browser, server.origin, row.planFile);
          blocked.push(...page.blocked);
          for (const t of timesMs) writeFileSync(`${work}/sheet-${String(n++).padStart(2, "0")}.png`, await page.frame(t));
          await page.page.close();
        }
      });
    } finally {
      await server.close();
    }
    const p = await probe(`${work}/clip.mp4`);
    if (p.video?.codec !== "h264" || p.video.width !== profile.widthPx || p.video.height !== profile.heightPx || p.video.frames !== frames) {
      fail("FS_ARTIFACT_VERIFY_FAILED", "/clip", `evidence clip failed verification: ${JSON.stringify(p)}`);
    }
    await ffmpeg(["-framerate", "1", "-i", `${work}/sheet-%02d.png`, "-vf", `scale=480:270,tile=${SHEET_AT.length}x${cases.length}`, "-frames:v", "1", `${work}/contact-sheet.png`]);
    copyFileSync(`${work}/clip.mp4`, `${outDir}clip.mp4`);
    copyFileSync(`${work}/contact-sheet.png`, `${outDir}contact-sheet.png`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (blocked.length) fail("FS_ARTIFACT_VERIFY_FAILED", "", `the painter attempted non-local requests: ${blocked.join(", ")}`);

  const evidence: CandidateEvidence = {
    candidate: input.candidate,
    ok: true,
    subject: { id: c.manifest.id, version: c.manifest.version, digest: c.executionDigest },
    approvalId: approval.id,
    runtimeReport: digestOf(runtime),
    media: { outgoing: { asset: outgoing.path, sha256: outgoing.sha256 }, incoming: { asset: incoming.path, sha256: incoming.sha256 } },
    cases: cases.map(({ name, outputDigest, planFile, planDigest: digest }) => ({ name, outputDigest, planFile: `out/${planFile}`, planDigest: digest })),
    clip: { file: `out/candidates/${input.candidate}/evidence/clip.mp4`, sha256: digestBytes(readFileSync(`${outDir}clip.mp4`)), case: clipCase.name, frames, fps: profile.fps },
    contactSheet: { file: `out/candidates/${input.candidate}/evidence/contact-sheet.png`, sha256: digestBytes(readFileSync(`${outDir}contact-sheet.png`)), rows: cases.map((r) => r.name), timesMs },
    painter: painterIdentity(),
    blocked,
    toolchain: { node: process.version },
    createdAt: new Date().toISOString(),
  };
  writeJson(`${c.dir}evidence.json`, evidence);
  return { executionDigest: c.executionDigest, evidence };
}
