import { beforeEach, describe, expect, it, vi } from "vitest";

const { registry, registerSentWithDescriptors, setWordLiveCards } = vi.hoisted(
  () => ({
    registry: {},
    registerSentWithDescriptors: vi.fn(),
    setWordLiveCards: vi.fn(),
  }),
);

vi.mock("@erato/frontend/library", () => ({
  componentRegistry: registry,
  registerSentWithDescriptors,
  setWordLiveCards,
}));
vi.mock("../components/WordHostCardRenderer", () => ({
  WordHostCardRenderer: () => null,
}));

import { installWordComponentRegistrations } from "../installWordComponentRegistrations";

describe("installWordComponentRegistrations", () => {
  beforeEach(() => {
    registerSentWithDescriptors.mockClear();
  });

  it("names what each Word facet sent", () => {
    installWordComponentRegistrations();

    expect(setWordLiveCards).toHaveBeenCalledWith(true);
    expect(registerSentWithDescriptors).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(
        registerSentWithDescriptors.mock.calls[0][0] as object,
      ).sort(),
    ).toEqual([
      "word_comment_thread",
      "word_compose",
      "word_document_authoring",
      "word_document_review",
      "word_selection",
    ]);
  });
});
