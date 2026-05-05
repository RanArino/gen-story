import { describe, expect, it, vi } from "vitest";

import {
  createGenerationRequestUseCase,
  markGenerationRequestFailed,
} from "@gen-story/application";
import {
  createOrganization,
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
});
