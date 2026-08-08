import { beforeEach, describe, expect, it, vi } from "vitest";

const { registry, addMenu, appointmentRenderer, emailRenderer } = vi.hoisted(
  () => {
    const registry: Record<string, unknown> = {};
    return {
      registry,
      addMenu: () => null,
      appointmentRenderer: () => null,
      emailRenderer: () => null,
    };
  },
);

vi.mock("@erato/frontend/library", () => ({ componentRegistry: registry }));
vi.mock("../components/AddinChatAddMenuExtraContent", () => ({
  AddinChatAddMenuExtraContent: addMenu,
}));
vi.mock("../components/OutlookEratoAppointmentRenderer", () => ({
  OutlookEratoAppointmentRenderer: appointmentRenderer,
}));
vi.mock("../components/OutlookEratoEmailRenderer", () => ({
  OutlookEratoEmailRenderer: emailRenderer,
}));

import { installOutlookComponentRegistrations } from "../installOutlookComponentRegistrations";

describe("installOutlookComponentRegistrations", () => {
  beforeEach(() => {
    for (const key of Object.keys(registry)) delete registry[key];
  });

  it("installs all Outlook contributions synchronously", () => {
    installOutlookComponentRegistrations();

    expect(registry).toEqual({
      ChatAddMenuExtraContent: addMenu,
      EratoAppointmentCodeBlock: appointmentRenderer,
      EratoEmailCodeBlock: emailRenderer,
    });
  });
});
