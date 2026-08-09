import { describe, expect, it, vi } from "vitest";

import {
  analyzeProjectPhotos,
  cancelAiJob,
  createGenerationRequestUseCase,
  markGenerationRequestFailed,
} from "@gen-story/application";
import {
  createOrganization,
  createPhotoAsset,
  createProject,
  createScene,
  createStoryboard,
} from "@gen-story/domain";

import { createInMemoryApplicationDependencies } from "../test-support/in-memory-application";
import { MockImageGenerationAdapter } from "./mock-image-generation";
import { LocalJobWorker } from "./local-job-worker";

function now() {
  return new Date().toISOString();
}

function makeDeps(
  overrides?: Parameters<typeof createInMemoryApplicationDependencies>[1],
) {
  const org = createOrganization({
    id: "org-1",
    name: "Org",
    createdAt: now(),
    updatedAt: now(),
  });
  const project = createProject({
    id: "proj-1",
    organizationId: "org-1",
    ownerUserId: "user-1",
    name: "Test",
    createdAt: now(),
    updatedAt: now(),
  });
  const storyboard = createStoryboard({
    id: "sb-1",
    projectId: "proj-1",
    tone: "cinematic",
    createdAt: now(),
    updatedAt: now(),
  });
  const scene = createScene({
    id: "scene-1",
    storyboardId: "sb-1",
    projectId: "proj-1",
    orderIndex: 0,
    title: "Scene 1",
    description: "A scene.",
    imagePrompt: "Cinematic still.",
    emotion: "calm",
    cameraDirection: "wide",
    lightingDirection: "natural",
    motionDirection: "slow pan",
    createdAt: now(),
    updatedAt: now(),
  });

  const deps = createInMemoryApplicationDependencies(
    {
      organizations: [org],
      projects: [project],
      storyboards: [storyboard],
      scenes: [scene],
    },
    overrides,
  );

  return { deps, org, project, storyboard, scene };
}

describe("LocalJobWorker", () => {
  it("moves a queued job to succeeded", async () => {
    const { deps, project, storyboard, scene } = makeDeps({
      imageGeneration: new MockImageGenerationAdapter(
        // Use the in-memory object storage from deps inside overrides — create separately
        (() => {
          const s = { objects: new Map<string, Uint8Array>() };
          return {
            async putObject(i: { key: string; body: Uint8Array }) {
              s.objects.set(i.key, i.body);
            },
            async getObject(k: string) {
              return s.objects.get(k) ?? null;
            },
            async deleteObject(k: string) {
              s.objects.delete(k);
            },
          };
        })(),
      ),
    });

    await createGenerationRequestUseCase(deps, {
      generationRequestId: "req-1",
      projectId: project.id,
      storyboardId: storyboard.id,
      sceneId: scene.id,
      inputJson: { projectId: project.id, sceneId: scene.id },
    });

    const worker = new LocalJobWorker(deps, { pollIntervalMs: 10 });
    worker.start();

    await new Promise((resolve) => setTimeout(resolve, 100));
    worker.stop();

    const req = await deps.generationRequests.findById("req-1");
    expect(req?.status).toBe("succeeded");
    expect(req?.startedAt).not.toBeNull();
    expect(req?.completedAt).not.toBeNull();

    const images = await deps.generatedImages.findBySceneId(scene.id);
    expect(images).toHaveLength(1);
    expect(images[0]!.storageKey).toContain("proj-1");
    expect(images[0]!.adoptedAt).not.toBeNull();
    await expect(deps.scenes.findById(scene.id)).resolves.toMatchObject({
      adoptedGeneratedImageId: images[0]!.id,
    });
  });

  it("caps concurrent running jobs at 5 per project", async () => {
    const { deps, project, storyboard, scene } = makeDeps();

    // Create 6 generation requests
    for (let i = 1; i <= 6; i++) {
      await createGenerationRequestUseCase(deps, {
        generationRequestId: `req-${i}`,
        projectId: project.id,
        storyboardId: storyboard.id,
        sceneId: scene.id,
        inputJson: { projectId: project.id, sceneId: scene.id },
      });
    }

    // Replace imageGeneration with a slow adapter that never resolves during this test
    let runningCount = 0;
    let maxSeen = 0;
    const slowAdapter = {
      generate: vi.fn(async () => {
        runningCount++;
        if (runningCount > maxSeen) maxSeen = runningCount;
        // Block for a bit so concurrency can be observed
        await new Promise((r) => setTimeout(r, 200));
        runningCount--;
        return {
          storageKey:
            "data/uploads/generated/images/projects/proj-1/scenes/scene-1/img.jpg",
          mimeType: "image/jpeg",
          size: 1,
          width: 1,
          height: 1,
          checksum: "abc",
        };
      }),
    };

    const depsWithSlow = { ...deps, imageGeneration: slowAdapter };

    const worker = new LocalJobWorker(depsWithSlow, { pollIntervalMs: 10 });
    worker.start();

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(maxSeen).toBeLessThanOrEqual(5);

    worker.stop();
  });

  it("records errorMessage when generation fails", async () => {
    const { deps, project, storyboard, scene } = makeDeps({
      imageGeneration: {
        generate: vi.fn(async () => {
          throw new Error("OpenAI quota exceeded");
        }),
      },
    });

    await createGenerationRequestUseCase(deps, {
      generationRequestId: "req-fail",
      projectId: project.id,
      storyboardId: storyboard.id,
      sceneId: scene.id,
      inputJson: { projectId: project.id, sceneId: scene.id },
    });

    const worker = new LocalJobWorker(deps, { pollIntervalMs: 10 });
    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 80));
    worker.stop();

    const req = await deps.generationRequests.findById("req-fail");
    expect(req?.status).toBe("failed");
    expect(req?.errorMessage).toContain("OpenAI quota exceeded");
    expect(req?.completedAt).not.toBeNull();
  });

  it("processes a retried request after marking the original failed", async () => {
    const { deps, project, storyboard, scene } = makeDeps({
      imageGeneration: new MockImageGenerationAdapter(
        (() => {
          const s = { objects: new Map<string, Uint8Array>() };
          return {
            async putObject(i: { key: string; body: Uint8Array }) {
              s.objects.set(i.key, i.body);
            },
            async getObject(k: string) {
              return s.objects.get(k) ?? null;
            },
            async deleteObject(k: string) {
              s.objects.delete(k);
            },
          };
        })(),
      ),
    });

    await createGenerationRequestUseCase(deps, {
      generationRequestId: "req-orig",
      projectId: project.id,
      storyboardId: storyboard.id,
      sceneId: scene.id,
      inputJson: { projectId: project.id, sceneId: scene.id },
    });

    // Manually fail it
    await markGenerationRequestFailed(deps, {
      generationRequestId: "req-orig",
      errorMessage: "first attempt failed",
      completedAt: new Date().toISOString(),
    });

    // Create a retry
    const { retryFailedGenerationRequest } =
      await import("@gen-story/application");
    await retryFailedGenerationRequest(deps, {
      generationRequestId: "req-orig",
      newGenerationRequestId: "req-retry",
    });

    const worker = new LocalJobWorker(deps, { pollIntervalMs: 10 });
    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    worker.stop();

    const retry = await deps.generationRequests.findById("req-retry");
    expect(retry?.status).toBe("succeeded");
  });

  it("runs a queued AI job through to succeeded with a stored result", async () => {
    const { deps, project } = makeDeps();

    await deps.photoAssets.save(
      createPhotoAsset({
        id: "photo-1",
        projectId: project.id,
        name: "family.jpg",
        usage: "candidate",
        storageKey: "photos/family.jpg",
        mimeType: "image/jpeg",
        size: 1,
        checksum: "family",
        sourceKind: "upload",
        createdAt: now(),
        updatedAt: now(),
      }),
    );

    const enqueued = await analyzeProjectPhotos(deps, {
      projectId: project.id,
    });
    if (!enqueued.ok || enqueued.value.jobId == null) {
      throw new Error("expected a job to be enqueued");
    }

    const worker = new LocalJobWorker(deps, { pollIntervalMs: 10 });
    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    worker.stop();

    const job = await deps.aiJobs.findById(enqueued.value.jobId);
    expect(job?.status).toBe("succeeded");
    expect(job?.startedAt).not.toBeNull();
    expect(job?.completedAt).not.toBeNull();
    expect(job?.resultJson?.photoCount).toBe(1);

    const analysis = await deps.projectPhotoAnalyses.findLatestByProjectId(
      project.id,
    );
    expect(analysis).not.toBeNull();
  });

  it("discards the result of an AI job canceled mid-flight", async () => {
    const { deps, project } = makeDeps();

    await deps.photoAssets.save(
      createPhotoAsset({
        id: "photo-1",
        projectId: project.id,
        name: "family.jpg",
        usage: "candidate",
        storageKey: "photos/family.jpg",
        mimeType: "image/jpeg",
        size: 1,
        checksum: "family",
        sourceKind: "upload",
        createdAt: now(),
        updatedAt: now(),
      }),
    );

    const enqueued = await analyzeProjectPhotos(deps, {
      projectId: project.id,
    });
    if (!enqueued.ok || enqueued.value.jobId == null) {
      throw new Error("expected a job to be enqueued");
    }
    const jobId = enqueued.value.jobId;

    // Cancel while the model call is in flight.
    const slowDeps = {
      ...deps,
      photoAnalysisGeneration: {
        analyzeProjectPhotos: vi.fn(async () => {
          await cancelAiJob(deps, { aiJobId: jobId });
          return {
            emotionCandidates: [
              {
                value: "calm",
                label: "Calm",
                description: "Calm.",
                reason: "Because.",
              },
            ],
            photoInsights: [
              {
                photoAssetId: "photo-1",
                summary: "s",
                people: "p",
                setting: "s",
                event: "e",
                atmosphere: "a",
              },
            ],
            storySummary: "A story.",
            model: "test",
          };
        }),
      },
    };

    const worker = new LocalJobWorker(slowDeps, { pollIntervalMs: 10 });
    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    worker.stop();

    const job = await deps.aiJobs.findById(jobId);
    expect(job?.status).toBe("canceled");
    expect(job?.resultJson).toBeNull();
  });

  it("leaves AI jobs beyond the per-project cap queued", async () => {
    const { deps, project } = makeDeps();

    await deps.photoAssets.save(
      createPhotoAsset({
        id: "photo-1",
        projectId: project.id,
        name: "family.jpg",
        usage: "candidate",
        storageKey: "photos/family.jpg",
        mimeType: "image/jpeg",
        size: 1,
        checksum: "family",
        sourceKind: "upload",
        createdAt: now(),
        updatedAt: now(),
      }),
    );

    for (let i = 1; i <= 7; i += 1) {
      await deps.jobQueue.enqueue({
        kind: "photo_analysis",
        projectId: project.id,
        payload: { projectId: project.id },
      });
    }

    let running = 0;
    let maxSeen = 0;
    const slowDeps = {
      ...deps,
      photoAnalysisGeneration: {
        analyzeProjectPhotos: vi.fn(async () => {
          running += 1;
          maxSeen = Math.max(maxSeen, running);
          await new Promise((r) => setTimeout(r, 200));
          running -= 1;
          return {
            emotionCandidates: [
              {
                value: "calm",
                label: "Calm",
                description: "Calm.",
                reason: "Because.",
              },
            ],
            photoInsights: [
              {
                photoAssetId: "photo-1",
                summary: "s",
                people: "p",
                setting: "s",
                event: "e",
                atmosphere: "a",
              },
            ],
            storySummary: "A story.",
            model: "test",
          };
        }),
      },
    };

    const worker = new LocalJobWorker(slowDeps, { pollIntervalMs: 10 });
    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 80));
    worker.stop();

    expect(maxSeen).toBeLessThanOrEqual(5);
    expect((await deps.aiJobs.findQueued()).length).toBeGreaterThan(0);
  });

  // A scan must not wait for the work it starts. When it did, a slot freed by a
  // fast job stayed idle until the slowest job in the batch finished, so an
  // eight-scene fill ran as two rigid batches with three slots idle in between.
  it("refills a freed slot without waiting for the rest of the batch", async () => {
    const { deps, project } = makeDeps();

    await deps.photoAssets.save(
      createPhotoAsset({
        id: "photo-1",
        projectId: project.id,
        name: "family.jpg",
        usage: "candidate",
        storageKey: "photos/family.jpg",
        mimeType: "image/jpeg",
        size: 1,
        checksum: "family",
        sourceKind: "upload",
        createdAt: now(),
        updatedAt: now(),
      }),
    );

    for (let i = 1; i <= 8; i += 1) {
      await deps.jobQueue.enqueue({
        kind: "photo_analysis",
        projectId: project.id,
        payload: { projectId: project.id },
      });
    }

    let startedCount = 0;
    let running = 0;
    let maxSeen = 0;
    const slowDeps = {
      ...deps,
      photoAnalysisGeneration: {
        analyzeProjectPhotos: vi.fn(async () => {
          startedCount += 1;
          running += 1;
          maxSeen = Math.max(maxSeen, running);
          // The first job of the batch is the slow one; the other four in the
          // opening batch finish quickly and should free their slots.
          await new Promise((r) =>
            setTimeout(r, startedCount === 1 ? 400 : 20),
          );
          running -= 1;
          return {
            emotionCandidates: [
              {
                value: "calm",
                label: "Calm",
                description: "Calm.",
                reason: "Because.",
              },
            ],
            photoInsights: [
              {
                photoAssetId: "photo-1",
                summary: "s",
                people: "p",
                setting: "s",
                event: "e",
                atmosphere: "a",
              },
            ],
            storySummary: "A story.",
            model: "test",
          };
        }),
      },
    };

    const worker = new LocalJobWorker(slowDeps, { pollIntervalMs: 10 });
    worker.start();
    // Long enough for the fast jobs to cycle several times, still well inside
    // the 400ms job that used to hold the whole batch hostage.
    await new Promise((resolve) => setTimeout(resolve, 200));
    worker.stop();

    // More than one batch worth of jobs has started while the slow one runs.
    expect(startedCount).toBeGreaterThan(5);
    // And the per-project cap was still respected throughout.
    expect(maxSeen).toBeLessThanOrEqual(5);
  });
});
