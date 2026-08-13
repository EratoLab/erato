import { beforeEach, describe, expect, it, vi } from "vitest";

const { registry, addMenu, attachmentsPreview } = vi.hoisted(() => {
  const registry: Record<string, unknown> = {};
  return {
    registry,
    addMenu: () => null,
    attachmentsPreview: () => null,
  };
});

vi.mock("@erato/frontend/library", () => ({ componentRegistry: registry }));
vi.mock("../components/TeamsChatAddMenuExtraContent", () => ({
  TeamsChatAddMenuExtraContent: addMenu,
}));
vi.mock("../components/TeamsAttachmentsPreview", () => ({
  TeamsAttachmentsPreview: attachmentsPreview,
}));

import { installTeamsComponentRegistrations } from "../installTeamsComponentRegistrations";

describe("installTeamsComponentRegistrations", () => {
  beforeEach(() => {
    for (const key of Object.keys(registry)) delete registry[key];
  });

  it("contributes the add-menu row and the attachments preview, and no Outlook renderers", () => {
    installTeamsComponentRegistrations();

    expect(registry).toEqual({
      ChatAddMenuExtraContent: addMenu,
      ChatAttachmentsPreview: attachmentsPreview,
    });
  });
});
