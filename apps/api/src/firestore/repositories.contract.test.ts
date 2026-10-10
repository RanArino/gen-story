import { describe, expect, it } from "vitest";
import {
  createAgentConversation,
  createAgentConversationMessage,
} from "@gen-story/domain";
import { createFirestoreRepositories } from "./repositories";
import {
  clearEmulatorData,
  createEmulatorClient,
} from "../test-support/firestore-emulator";
import {
  repositoryContracts,
  seedGenerationFixture,
  buildGeneratedImage,
  now,
  type RepositoryFixture,
} from "../test-support/repository-contracts";

describe.runIf(process.env.FIRESTORE_EMULATOR_HOST != null)(
  "Firestore emulator",
  () => {
    repositoryContracts("Firestore repository contracts", withRepositories);

    it("reserves concurrent sequences without collisions", async () => {
      await withRepositories(async ({ repositories }) => {
        await seedGenerationFixture(repositories);
        await repositories.agentConversations.save(
          createAgentConversation({
            id: "conversation_1",
            projectId: "project_1",
            title: "Refine",
            createdAt: now,
            updatedAt: now,
          }),
        );
        const sequences = await Promise.all(
          Array.from({ length: 8 }, () =>
            repositories.agentConversations.nextMessageSequence(
              "conversation_1",
            ),
          ),
        );
        expect([...sequences].sort((a, b) => a - b)).toEqual([
          1, 2, 3, 4, 5, 6, 7, 8,
        ]);
      });
    }, 30_000);

    it("rejects concurrent transcript sequence collisions", async () => {
      await withRepositories(async ({ repositories }) => {
        await seedGenerationFixture(repositories);
        await repositories.agentConversations.save(
          createAgentConversation({
            id: "conversation_1",
            projectId: "project_1",
            title: "Refine",
            createdAt: now,
            updatedAt: now,
          }),
        );
        const message = createAgentConversationMessage({
          id: "message_1",
          conversationId: "conversation_1",
          sequence: 1,
          role: "assistant",
          kind: "assistant_text",
          text: "first",
          createdAt: now,
        });
        const results = await Promise.allSettled([
          repositories.agentConversations.saveMessage(message),
          repositories.agentConversations.saveMessage({
            ...message,
            id: "message_2",
          }),
        ]);
        expect(
          results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        await expect(
          repositories.agentConversations.listMessages("conversation_1"),
        ).resolves.toHaveLength(1);
      });
    }, 30_000);

    it("serializes concurrent generated-image adoptions", async () => {
      await withRepositories(async ({ repositories }) => {
        await seedGenerationFixture(repositories);
        await Promise.all(
          ["image_1", "image_2"].map((id) =>
            repositories.generatedImages.save({
              ...buildGeneratedImage(id),
              adoptedAt: now,
            }),
          ),
        );
        const images =
          await repositories.generatedImages.findBySceneId("scene_1");
        const adopted = images.filter((image) => image.adoptedAt != null);
        expect(adopted).toHaveLength(1);
        await expect(
          repositories.scenes.findById("scene_1"),
        ).resolves.toMatchObject({ adoptedGeneratedImageId: adopted[0]!.id });
      });
    }, 30_000);
  },
);

async function withRepositories(
  test: (fixture: RepositoryFixture) => Promise<void>,
) {
  await clearEmulatorData();
  let db = createEmulatorClient();
  try {
    await test({
      repositories: createFirestoreRepositories(db),
      async reopen() {
        await db.terminate();
        db = createEmulatorClient();
        return createFirestoreRepositories(db);
      },
    });
  } finally {
    await db.terminate();
  }
}
