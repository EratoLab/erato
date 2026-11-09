import { describe, expect, it } from "vitest";

import { reminderConfirmationOf } from "./reminderConfirmation";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const wireConfirmation = {
  item_id: "item-1",
  language: "de",
  heading: "Erinnerung geplant",
  name: "Angebot nachfassen",
  when: "Freitag, 13. Nov., 10:00",
  repeats: null,
  delivery: "Zustellung per Teams-Chat",
  cancel_label: "Abbrechen",
  open_scheduled_label: "In „Geplant“ öffnen",
  scheduled_path: "/scheduled",
};

// The generated schema types a tool's free-form input and output as void.
const createCall = (overrides: Record<string, unknown> = {}): ContentPart =>
  ({
    content_type: "tool_use",
    tool_call_id: "call-1",
    tool_name: "create_reminder",
    status: "success",
    input: {},
    output: {
      status: "created",
      reminder: { id: "item-1" },
      confirmation: wireConfirmation,
    },
    ...overrides,
  }) as unknown as ContentPart;

describe("reminderConfirmationOf", () => {
  it("reads the stored item's confirmation from a successful create", () => {
    expect(reminderConfirmationOf(createCall())).toEqual({
      itemId: "item-1",
      heading: "Erinnerung geplant",
      name: "Angebot nachfassen",
      when: "Freitag, 13. Nov., 10:00",
      repeats: null,
      delivery: "Zustellung per Teams-Chat",
      cancelLabel: "Abbrechen",
      openScheduledLabel: "In „Geplant“ öffnen",
      scheduledPath: "/scheduled",
    });
  });

  it("gives no card for a refused create, another tool or no confirmation", () => {
    expect(
      reminderConfirmationOf(
        createCall({
          status: "error",
          output: { status: "refused", code: "limit_reached" },
        }),
      ),
    ).toBeNull();
    expect(
      reminderConfirmationOf(createCall({ tool_name: "list_reminders" })),
    ).toBeNull();
    expect(
      reminderConfirmationOf(
        createCall({
          output: { status: "created", reminder: { id: "item-1" } },
        }),
      ),
    ).toBeNull();
    expect(reminderConfirmationOf({ content_type: "text", text: "" })).toBe(
      null,
    );
  });

  it("links only to a page of this app", () => {
    for (const path of ["https://example.com/scheduled", "//example.com"]) {
      expect(
        reminderConfirmationOf(
          createCall({
            output: {
              confirmation: { ...wireConfirmation, scheduled_path: path },
            },
          }),
        ),
      ).toBeNull();
    }
  });
});
