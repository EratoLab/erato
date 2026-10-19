import { composerContextChipFaceConformanceFailures } from "@erato/frontend/conformance";
import { ComposerContextLane } from "@erato/frontend/shared";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ExampleComposerContextChipFace } from "./ExampleComposerContextChipFace";

import type { ComposerContextItem } from "@erato/frontend/shared";

i18n.loadAndActivate({ locale: "en", messages: {} });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps the host's context chip contract", () => {
  expect(
    composerContextChipFaceConformanceFailures(ExampleComposerContextChipFace, {
      render: (element) =>
        render(<I18nProvider i18n={i18n}>{element}</I18nProvider>),
    }),
  ).toEqual([]);
});

it("opens the detail from the face and leaves removing to the host's x", () => {
  // The wide web app: the detail is a popover, not a sheet.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  const onRemove = vi.fn();
  const item: ComposerContextItem = {
    id: "document",
    kind: "word.document",
    origin: "ambient",
    dismissScope: "chat",
    state: "included",
    label: "Supply agreement.docx",
    meta: "86 ¶",
    icon: "document",
    onRemove,
    removeLabel: "Don't include this document",
    detail: { title: "Supply agreement.docx", render: () => "Whole document" },
  };
  render(
    <I18nProvider i18n={i18n}>
      <ComposerContextLane
        items={[item]}
        chipFace={ExampleComposerContextChipFace}
      />
    </I18nProvider>,
  );

  const face = document.querySelector('[data-component-kit="example"]');
  expect(face).not.toBeNull();
  fireEvent.click(face!);
  expect(
    screen.getByRole("dialog", { name: "Supply agreement.docx" }),
  ).toBeTruthy();
  expect(onRemove).not.toHaveBeenCalled();

  const remove = document.querySelector('[data-ui="composer-context-remove"]');
  expect(remove?.getAttribute("aria-label")).toBe(
    "Don't include this document",
  );
  fireEvent.click(remove!);
  expect(onRemove).toHaveBeenCalledOnce();
});
