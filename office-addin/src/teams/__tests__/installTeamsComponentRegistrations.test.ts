import { beforeEach, describe, expect, it, vi } from "vitest";

const { registry, addMenu } = vi.hoisted(() => {
  const registry: Record<string, unknown> = {};
  return { registry, addMenu: () => null };
});

vi.mock("@erato/frontend/library", () => ({ componentRegistry: registry }));
vi.mock("../components/TeamsChatAddMenuExtraContent", () => ({
  TeamsChatAddMenuExtraContent: addMenu,
}));

import { installTeamsComponentRegistrations } from "../installTeamsComponentRegistrations";

describe("installTeamsComponentRegistrations", () => {
  beforeEach(() => {
    for (const key of Object.keys(registry)) delete registry[key];
  });

  it("contributes only the add-menu row, no attachment preview and no Outlook renderers", () => {
    // The registry's own default for an unset slot.
    registry.ChatInputAttachmentPreview = null;

    installTeamsComponentRegistrations();

    expect(registry).toEqual({
      ChatAddMenuExtraContent: addMenu,
      ChatInputAttachmentPreview: null,
    });
  });

  it("leaves a component kit's attachment preview as the kit set it", () => {
    const kitPreview = () => null;
    registry.ChatInputAttachmentPreview = kitPreview;

    installTeamsComponentRegistrations();

    expect(registry).toEqual({
      ChatAddMenuExtraContent: addMenu,
      ChatInputAttachmentPreview: kitPreview,
    });
  });
});
