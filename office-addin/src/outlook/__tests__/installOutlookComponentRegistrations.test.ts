import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  registry,
  addMenu,
  appointmentRenderer,
  emailRenderer,
  registerSentWithDescriptors,
} = vi.hoisted(() => {
  const registry: Record<string, unknown> = {};
  return {
    registry,
    addMenu: () => null,
    appointmentRenderer: () => null,
    emailRenderer: () => null,
    registerSentWithDescriptors: vi.fn(),
  };
});

vi.mock("@erato/frontend/library", () => ({
  componentRegistry: registry,
  registerSentWithDescriptors,
}));
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
    registerSentWithDescriptors.mockClear();
  });

  it("installs all Outlook contributions synchronously", () => {
    installOutlookComponentRegistrations();

    expect(registry).toEqual({
      ChatAddMenuExtraContent: addMenu,
      EratoAppointmentCodeBlock: appointmentRenderer,
      EratoEmailCodeBlock: emailRenderer,
    });
  });

  it("names what each Outlook facet sent", () => {
    installOutlookComponentRegistrations();

    expect(registerSentWithDescriptors).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(
        registerSentWithDescriptors.mock.calls[0][0] as object,
      ).sort(),
    ).toEqual([
      "compose_email",
      "outlook_reply_from_read",
      "outlook_review_appointment",
      "outlook_review_draft",
      "outlook_rewrite_appointment_selection",
      "outlook_rewrite_selection",
      "outlook_schedule",
    ]);
  });
});
