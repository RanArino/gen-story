// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { StylePresetDto } from "@gen-story/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../i18n/messages/en.json";
import { StylePresetGallery } from "./StylePresetGallery";

const STORAGE_KEY = "gen-story:favorite-style-presets";
const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function preset(id: string, name: string, scope: string): StylePresetDto {
  return {
    id,
    scope,
    name,
    description: `${name} look`,
    prompt: name,
    previewImageUrl: scope === "system" ? `/style-previews/${id}.jpg` : null,
    createdAt: "2026-11-28T00:00:00.000Z",
    updatedAt: "2026-11-28T00:00:00.000Z",
  };
}

const presets = [
  preset("anime", "Anime Movie", "system"),
  preset("film", "Film Photo", "system"),
  preset("mine", "My Style", "user"),
];

function renderGallery(onSelect = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <StylePresetGallery
        presets={presets}
        selectedId={null}
        onSelect={onSelect}
      />
    </NextIntlClientProvider>,
  );
  return onSelect;
}

// Visible group labels and preset names, in document order.
function galleryOrder(): string[] {
  return Array.from(
    document.querySelectorAll(
      "[class*=styleGroupLabel], [class*=styleBtnCardLabel], [class*=styleChipSelect]",
    ),
  ).map((node) => node.textContent ?? "");
}

describe("Style preset favorites", () => {
  it("moves a hearted preset into a Favorites group at the top and persists it", () => {
    const onSelect = renderGallery();
    expect(screen.queryByText("Favorites")).toBeNull();

    const heart = screen.getByRole("button", { name: "Favorite: Film Photo" });
    expect(heart.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(heart);

    expect(galleryOrder()).toEqual([
      "Favorites",
      "Film Photo",
      "System styles",
      "Anime Movie",
      "Custom styles",
      "My Style",
    ]);
    expect(
      screen
        .getByRole("button", { name: "Favorite: Film Photo" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(JSON.parse(values.get(STORAGE_KEY) ?? "[]")).toEqual(["film"]);
    // Toggling a favorite never changes the selected style.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("restores saved favorites, ignores unknown ids, and can unfavorite", () => {
    values.set(STORAGE_KEY, JSON.stringify(["mine", "deleted-preset"]));
    renderGallery();

    expect(galleryOrder().slice(0, 2)).toEqual(["Favorites", "My Style"]);

    fireEvent.click(screen.getByRole("button", { name: "Favorite: My Style" }));
    expect(screen.queryByText("Favorites")).toBeNull();
    expect(JSON.parse(values.get(STORAGE_KEY) ?? "[]")).toEqual([
      "deleted-preset",
    ]);
  });

  it("ignores a corrupt stored value", () => {
    values.set(STORAGE_KEY, "{not json");
    renderGallery();
    expect(screen.queryByText("Favorites")).toBeNull();
  });
});
