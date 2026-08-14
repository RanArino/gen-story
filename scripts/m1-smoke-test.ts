/**
 * M1-10 acceptance: real subscription-backed smoke test. Starts the actual
 * API server (in-process) with GEN_STORY_AGENT_RUNTIME set to codex, then
 * claude, and drives the real HTTP routes — create project, upload a photo,
 * request photo analysis, poll the job, and read GET /api/ai-runtime — to
 * prove the whole stack (create-api-context wiring, the stateless CLI
 * adapters, and the async job worker) works end to end with no new model
 * API key. Not a vitest test: it makes real, billable subscription calls,
 * so it is run manually, not on every `pnpm test`.
 *
 * Run: pnpm tsx scripts/m1-smoke-test.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "../apps/api/src/server";

async function main() {
  for (const runtime of ["codex", "claude"] as const) {
    console.log(`\n=== ${runtime} ===`);
    await runSmokeTest(runtime);
  }
  console.log("\nAll smoke tests passed.");
}

async function runSmokeTest(runtime: "codex" | "claude") {
  const directory = mkdtempSync(join(tmpdir(), `gen-story-smoke-${runtime}-`));
  const port = runtime === "codex" ? 4091 : 4092;

  process.env.GEN_STORY_SQLITE_PATH = join(directory, "test.sqlite");
  process.env.GEN_STORY_AGENT_RUNTIME = runtime;
  process.env.GEN_STORY_DEPLOY_TARGET = "local";
  delete process.env.GEMINI_API_KEY;

  const server = await startServer(port);
  const base = `http://localhost:${port}`;

  try {
    const runtimeInfo = await getJson(`${base}/api/ai-runtime`);
    console.log("GET /api/ai-runtime:", JSON.stringify(runtimeInfo));
    assert(runtimeInfo.runtime === runtime, `runtime should be ${runtime}`);
    assert(
      runtimeInfo.availability.status === "available",
      `availability should be available, got ${JSON.stringify(runtimeInfo.availability)}`,
    );

    const project = await postJson(`${base}/api/projects`, {
      name: `M1-10 smoke (${runtime})`,
    });
    console.log("created project:", project.id);

    const photo = await postJson(
      `${base}/api/projects/${project.id}/photo-assets`,
      {
        name: "smoke-test.png",
        mimeType: "image/png",
        contentBase64: SYNTHETIC_PHOTO_BASE64,
        usage: "reference",
      },
    );
    console.log("uploaded photo:", photo.id);

    const analysisStart = await postJson(
      `${base}/api/projects/${project.id}/photo-analysis`,
      {},
    );
    console.log("photo-analysis kicked off:", JSON.stringify(analysisStart));

    let analysis = analysisStart.photoAnalysis;
    if (analysisStart.jobId != null) {
      // ai_jobs.resultJson for photo_analysis is just a pointer
      // ({projectPhotoAnalysisId, model, photoCount}), not the full DTO —
      // fetch the persisted analysis once the job succeeds.
      await pollJob(base, analysisStart.jobId);
      const refetched = await getJson(
        `${base}/api/projects/${project.id}/photo-analysis`,
      );
      analysis = refetched.photoAnalysis;
    }

    console.log("final analysis:", JSON.stringify(analysis));
    assert(analysis != null, "analysis should not be null");
    assert(
      analysis.model !== "local-deterministic",
      "model should not be the no-key local fallback",
    );
    assert(
      Array.isArray(analysis.emotionCandidates) &&
        analysis.emotionCandidates.length >= 3,
      "should have at least 3 emotion candidates",
    );

    console.log(`${runtime}: PASS (model=${analysis.model})`);
  } finally {
    // server.close()'s callback only fires once every open connection
    // closes; fetch's keep-alive can leave one dangling long enough to look
    // like a hang. Force-close sockets immediately since this script only
    // ever needs one clean run, not a graceful drain.
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
}

async function pollJob(base: string, jobId: string): Promise<unknown> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const job = await getJson(`${base}/api/ai-jobs/${jobId}`);
    if (job.status === "succeeded") return job.resultJson;
    if (job.status === "failed") {
      throw new Error(`Job failed: ${job.errorMessage}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for AI job.");
}

// A real 320x240 solid-color PNG. Not a bare 1x1 pixel: M1-05's Discoveries
// found Claude's vision pipeline rejects a degenerate 1x1 test image
// ("could not be processed"), so this fixture must be an actual photo-sized
// image for the smoke test to exercise both providers realistically.
const SYNTHETIC_PHOTO_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAUAAAADwCAIAAAD+Tyo8AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAGPklEQVR4nO3VUQ0DARAC0ZN9cipnZNVDf0izL0HAZoDl6fMSAgj0n0V45hcQAgikwEKAQPf2wALvPSAEUmAhQKB739AC7z0gBFJgIUCge9/QAu89IARSYCFAoHvf0ALvPSAEUmAhQKB739AC7z0gBFJgIUCge9/QAu89IARSYCFAoHvf0ALvPSAEUmAhQKB739AC7z0gBFJgIUCge9/QAu89IARSYCFAoHvf0ALvPSAEUmAhQKB739AC7z0gBFJgIUCge9/QAu89IARSYCFAoHvf0ALvPSAEUmAhQKB739AC7z0gBFJgIUCge9/QAu89IARSYCFAoHvf0ALvPSAEUmAhQKB739AC7z0gBFJgIUCge9/QAu89IARSYCFAoHvf0ALvPSAEUmAhQKB739AC7z0gBFJgIUCge9/QAu89IARSYCFAoHvf0ALvPSAEUmAhQKB739AC7z0gBFJgIUCge9/QAu89IARSYCFAoHvf0ALvPSAEUmAhQKB739AC7z0gBFJgIUCge9/QAu89IARSYCFAoHvf0ALvPSAEUmAhQKB739AC7z0gBFJgIUCge9/QAu89IARSYCFAoHvf0ALvPSAEUmAhQKB739AC7z0gBFJgIUCge9/QAu89IARSYCFAoHvf0ALvPSAEUmAhQKB739AC7z0gBFJgIUCge9/QAu89IAQUWAgQeA8+Agu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEEiBhQCB7n1DC7z3gBBIgYUAge59Qwu894AQSIGFAIHufUMLvPeAEOjXGHwBrtGg7xPr/ukAAAAASUVORK5CYII=";

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`POST ${url} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
