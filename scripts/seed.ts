import { createProject, createScene, createStoryboard } from "@gen-story/domain";
import {
  LOCAL_ORGANIZATION_ID,
  LOCAL_USER_ID,
  seedLocalPrincipal,
} from "../apps/api/src/auth/local-auth.ts";
import { getDatabasePath, openDatabase } from "../apps/api/src/db/client.ts";
import { createSqliteRepositories } from "../apps/api/src/db/repositories.ts";
import { SYSTEM_STYLE_PRESETS } from "./style-presets.ts";

const SEED_DEMO_PROJECT_NAME = "Demo — Family Trip";

function now(): string {
  return new Date().toISOString();
}

async function main() {
  const dbPath = getDatabasePath();
  console.log(`Using database: ${dbPath}`);
  const { db, close } = openDatabase(dbPath);

  try {
    const repos = createSqliteRepositories(db);
    await seedLocalPrincipal(repos);

    // Seed/refresh the nine system style presets (idempotent, matched by id).
    // Done before the demo-project early-return so prompt revisions still
    // propagate when re-seeding an existing database.
    const presetTs = now();
    for (const preset of SYSTEM_STYLE_PRESETS) {
      const existing = await repos.stylePresets.findById(preset.id);
      await repos.stylePresets.save({
        id: preset.id,
        scope: "system",
        name: preset.name,
        description: preset.description,
        prompt: preset.prompt,
        createdAt: existing?.createdAt ?? presetTs,
        updatedAt: presetTs,
      });
    }
    console.log(`Seeded ${SYSTEM_STYLE_PRESETS.length} system style presets.`);

    // Check if demo project already exists (idempotent)
    const existingProjects = await repos.projects.findByOrganizationId(LOCAL_ORGANIZATION_ID);
    const existing = existingProjects.find((p) => p.name === SEED_DEMO_PROJECT_NAME);
    if (existing) {
      console.log(`Seed already applied. Project id: ${existing.id}`);
      console.log(`Visit http://localhost:3000/projects/${existing.id}/storyboard to explore.`);
      return;
    }

    const ts = now();
    const projectId = crypto.randomUUID();
    const storyboardId = crypto.randomUUID();

    const project = createProject({
      id: projectId,
      organizationId: LOCAL_ORGANIZATION_ID,
      ownerUserId: LOCAL_USER_ID,
      name: SEED_DEMO_PROJECT_NAME,
      status: "active",
      createdAt: ts,
      updatedAt: ts,
    });
    await repos.projects.save(project);

    const storyboard = createStoryboard({
      id: storyboardId,
      projectId,
      status: "draft",
      tone: "warm",
      sceneIds: [],
      createdAt: ts,
      updatedAt: ts,
    });
    await repos.storyboards.save(storyboard);

    const sceneSpecs = [
      {
        title: "Arrival",
        description: "The family arrives at the destination, full of excitement.",
        imagePrompt: "A family stepping out of a car at a scenic mountain destination, golden hour light.",
        emotion: "Excitement",
      },
      {
        title: "Exploration",
        description: "The children run ahead, discovering the surroundings.",
        imagePrompt: "Children running through a sunlit meadow, candid joyful moment.",
        emotion: "Joy",
      },
      {
        title: "Together",
        description: "The family gathers around a campfire at dusk.",
        imagePrompt: "A family sitting around a warm campfire at twilight, soft bokeh background.",
        emotion: "Gratitude",
      },
    ];

    const sceneIds: string[] = [];
    for (let i = 0; i < sceneSpecs.length; i++) {
      const spec = sceneSpecs[i]!;
      const sceneId = crypto.randomUUID();
      sceneIds.push(sceneId);
      const scene = createScene({
        id: sceneId,
        projectId,
        storyboardId,
        orderIndex: i,
        status: "draft",
        title: spec.title,
        description: spec.description,
        imagePrompt: spec.imagePrompt,
        emotion: spec.emotion,
        cameraDirection: "Wide",
        lightingDirection: "Golden hour",
        motionDirection: "Slow pan",
        notes: "",
        photoAssets: [],
        adoptedGeneratedImageId: null,
        createdAt: ts,
        updatedAt: ts,
      });
      await repos.scenes.save(scene);
    }

    // Update storyboard with scene IDs
    await repos.storyboards.save({ ...storyboard, sceneIds, updatedAt: now() });

    console.log(`Seed complete. Project id: ${projectId}.`);
    console.log(`Visit http://localhost:3000/projects/${projectId}/storyboard to explore.`);
  } finally {
    close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
