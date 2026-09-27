// @vitest-environment jsdom
import type { GenerationRequestDto, SceneDto } from "@gen-story/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import enMessages from "../../i18n/messages/en.json";
import jaMessages from "../../i18n/messages/ja.json";

const createGenerationRequest = vi.fn();
const listGenerationRequests = vi.fn();
const listScenes = vi.fn();
const listStoryboards = vi.fn();

vi.mock("../../lib/api-client", () => ({
  cancelGenerationRequest: vi.fn(),
  createGenerationRequest: (sceneId: string, input: unknown) =>
    createGenerationRequest(sceneId, input),
  listGenerationRequests: (sceneId: string) => listGenerationRequests(sceneId),
  listScenes: (storyboardId: string) => listScenes(storyboardId),
  listStoryboards: (projectId: string) => listStoryboards(projectId),
  retryGenerationRequest: vi.fn(),
}));

vi.mock("../AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));

const { GeneratePage } = await import("./GeneratePage");

function scene(id: string, title: string): SceneDto {
  return {
    id,
    title,
    storyboardId: "storyboard_1",
    projectId: "project_1",
  } as SceneDto;
}

function request(
  id: string,
  sceneId: string,
  status: GenerationRequestDto["status"],
): GenerationRequestDto {
  return {
    id,
    sceneId,
    status,
    createdAt: "2026-09-26T00:00:00.000Z",
  } as GenerationRequestDto;
}

function renderPage(locale: "en" | "ja" = "en") {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "ja" ? jaMessages : enMessages}
    >
      <GeneratePage projectId="project_1" />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GeneratePage bulk start", () => {
  it("starts every unstarted scene after a partial generation run", async () => {
    const completed = scene("scene_1", "Completed scene");
    const unstartedA = scene("scene_2", "Unstarted scene A");
    const unstartedB = scene("scene_3", "Unstarted scene B");

    listStoryboards.mockResolvedValue([{ id: "storyboard_1" }]);
    listScenes.mockResolvedValue([completed, unstartedA, unstartedB]);
    listGenerationRequests.mockImplementation((sceneId: string) =>
      Promise.resolve(
        sceneId === completed.id
          ? [request("request_1", completed.id, "succeeded")]
          : [],
      ),
    );
    createGenerationRequest.mockResolvedValue({});

    renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Start all unstarted scenes",
      }),
    );

    await waitFor(() =>
      expect(createGenerationRequest).toHaveBeenCalledTimes(2),
    );
    expect(createGenerationRequest).toHaveBeenNthCalledWith(1, unstartedA.id, {
      sceneId: unstartedA.id,
      storyboardId: unstartedA.storyboardId,
      projectId: unstartedA.projectId,
      model: "gemini-3.1-flash-image",
    });
    expect(createGenerationRequest).toHaveBeenNthCalledWith(2, unstartedB.id, {
      sceneId: unstartedB.id,
      storyboardId: unstartedB.storyboardId,
      projectId: unstartedB.projectId,
      model: "gemini-3.1-flash-image",
    });
  });

  it("renders the bulk-start action in Japanese", async () => {
    const completed = scene("scene_1", "完了済み");
    const unstarted = scene("scene_2", "未開始");

    listStoryboards.mockResolvedValue([{ id: "storyboard_1" }]);
    listScenes.mockResolvedValue([completed, unstarted]);
    listGenerationRequests.mockImplementation((sceneId: string) =>
      Promise.resolve(
        sceneId === completed.id
          ? [request("request_1", completed.id, "succeeded")]
          : [],
      ),
    );

    renderPage("ja");

    expect(
      await screen.findByRole("button", {
        name: "未開始のシーンをすべて開始",
      }),
    ).toBeDefined();
  });
});
