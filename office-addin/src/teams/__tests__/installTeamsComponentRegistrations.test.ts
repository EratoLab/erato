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

  it("contributes the add-menu row and no Outlook renderers", () => {
    installTeamsComponentRegistrations();

    expect(registry).toEqual({ ChatAddMenuExtraContent: addMenu });
  });
});
