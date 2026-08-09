import { describe, expect, it } from "vitest";

import {
  createOrganization,
  createPhotoAsset,
  createProject,
  createScene,
  createStoryboard,
  createUser,
  type CharacterPolicy,
} from "@gen-story/domain";

import { createInMemoryApplicationDependencies } from "../test-support/in-memory-application";
import { composeScenePrompt } from "./compose-scene-prompt";

const now = "2026-05-02T00:00:00.000Z";

function baseFixture(
  photoFidelity: "off" | "low" | "high",
  hasPhoto: boolean,
  characterPolicy: CharacterPolicy = "background_only",
) {
  return createInMemoryApplicationDependencies({
    users: [
      createUser({
        id: "user_1",
        organizationId: "organization_1",
        displayName: "Test User",
        createdAt: now,
        updatedAt: now,
      }),
    ],
    organizations: [
      createOrganization({
        id: "organization_1",
        name: "Test Organization",
        createdAt: now,
        updatedAt: now,
      }),
    ],
    projects: [
      createProject({
        id: "project_1",
        organizationId: "organization_1",
        ownerUserId: "user_1",
        name: "Family Story",
        createdAt: now,
        updatedAt: now,
      }),
    ],
    storyboards: [
      createStoryboard({
        id: "storyboard_1",
        projectId: "project_1",
        tone: "warm",
        characterPolicy,
        createdAt: now,
        updatedAt: now,
      }),
    ],
    photoAssets: [
      createPhotoAsset({
        id: "photo_1",
        projectId: "project_1",
        name: "family.jpg",
        storageKey: "data/uploads/originals/projects/project_1/photo_1.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        width: 800,
        height: 600,
        checksum: "checksum",
        sourceKind: "upload",
        createdAt: now,
        updatedAt: now,
      }),
    ],
    scenes: [
      createScene({
        id: "scene_1",
        projectId: "project_1",
        storyboardId: "storyboard_1",
        orderIndex: 0,
        title: "Scene 1",
        description: "A quiet memory.",
        imagePrompt: "a family at the beach",
        emotion: "Joy",
        cameraDirection: "Medium",
        lightingDirection: "Natural",
        motionDirection: "Static",
        photoFidelity,
        photoAssets: hasPhoto
          ? [{ photoAssetId: "photo_1", role: "primary" }]
          : [],
        createdAt: now,
        updatedAt: now,
      }),
    ],
  });
}

describe("composeScenePrompt — photo fidelity directive", () => {
  it("adds no directive when photoFidelity is off", async () => {
    const deps = baseFixture("off", true);
    const { prompt } = await composeScenePrompt(deps, { sceneId: "scene_1" });
    expect(prompt).not.toContain("reference photo");
  });

  it("adds no directive when the scene has no photos, even if fidelity is set", async () => {
    const deps = baseFixture("high", false);
    const { prompt } = await composeScenePrompt(deps, { sceneId: "scene_1" });
    expect(prompt).not.toContain("reference photo");
  });

  it("adds a ground-truth directive at high fidelity", async () => {
    const deps = baseFixture("high", true);
    const { prompt } = await composeScenePrompt(deps, { sceneId: "scene_1" });
    expect(prompt).toContain("ground truth");
    expect(prompt).toContain("precisely");
  });

  it("adds a loose-inspiration directive at low fidelity", async () => {
    const deps = baseFixture("low", true);
    const { prompt } = await composeScenePrompt(deps, { sceneId: "scene_1" });
    expect(prompt).toContain("loose inspiration");
    expect(prompt).toContain("feel free to reinterpret");
  });

  it("produces different directives for low and high, since the API cannot", async () => {
    const highDeps = baseFixture("high", true);
    const lowDeps = baseFixture("low", true);
    const high = await composeScenePrompt(highDeps, { sceneId: "scene_1" });
    const low = await composeScenePrompt(lowDeps, { sceneId: "scene_1" });
    expect(high.prompt).not.toBe(low.prompt);
  });

  it("lets an unsaved override take precedence over the persisted scene value", async () => {
    const deps = baseFixture("off", true);
    const { prompt } = await composeScenePrompt(deps, {
      sceneId: "scene_1",
      overrides: { photoFidelity: "high" },
    });
    expect(prompt).toContain("ground truth");
  });
});

describe("composeScenePrompt — character policy directive", () => {
  it("adds no directive when the storyboard is featured", async () => {
    const deps = baseFixture("off", false, "featured");
    const { prompt } = await composeScenePrompt(deps, { sceneId: "scene_1" });
    expect(prompt).not.toContain("human figures");
    expect(prompt).not.toContain("incidental");
  });

  it("instructs against any new human figures when the policy is none", async () => {
    const deps = baseFixture("off", false, "none");
    const { prompt } = await composeScenePrompt(deps, { sceneId: "scene_1" });
    expect(prompt).toContain("Do not add any human figures");
  });

  it("keeps people incidental and background-only under background_only", async () => {
    const deps = baseFixture("off", false, "background_only");
    const { prompt } = await composeScenePrompt(deps, { sceneId: "scene_1" });
    expect(prompt).toContain("incidental");
    expect(prompt).toContain("do not invent a new prominent");
  });
});
