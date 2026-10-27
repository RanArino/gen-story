// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../i18n/messages/en.json";
import { ImageModelSelect, useImageModel } from "./ImageModelSelect";

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

function Selector() {
  const [model, setModel] = useImageModel();
  return <ImageModelSelect value={model} onChange={setModel} />;
}

function renderSelector() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Selector />
    </NextIntlClientProvider>,
  );
}

describe("Image model selection", () => {
  it("defaults to Automatic and explains API fallback billing", () => {
    renderSelector();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
      "auto",
    );
    expect(
      screen.getByText(messages.imageModel.automaticDescription),
    ).toBeTruthy();
  });

  it("preserves a previously saved explicit API selection", async () => {
    values.set("gen-story:image-model", "gemini-3.1-flash-image");
    renderSelector();
    await waitFor(() =>
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
        "gemini-3.1-flash-image",
      ),
    );
    expect(
      screen.queryByText(messages.imageModel.automaticDescription),
    ).toBeNull();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "auto" },
    });
    expect(values.get("gen-story:image-model")).toBe("auto");
  });
});
