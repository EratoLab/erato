import { describe, expect, it } from "vitest";

import { toolWaitLine } from "./toolLine";

import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const templates = {
  search: "Ich suche nach {search}.",
  items: "Ich sehe mir {table} an.",
  list: "Ich sehe mir die {table} an.",
};

const tableRead = (spoken: boolean) =>
  ({
    action: "other",
    object_kind: "row",
    source: "rules",
    read: {
      object_kind: "row",
      filtered: true,
      query: { tables: ["opportunity"], conditions: [] },
    },
    ...(spoken
      ? {
          spoken_names: { de: { tables: { opportunity: "Verkaufschancen" } } },
        }
      : {}),
  }) as unknown as ToolCallLabel;

describe("toolWaitLine", () => {
  it("names what a list reads from the spoken vocabulary", () => {
    expect(toolWaitLine(tableRead(true), "de-DE", templates)).toBe(
      "Ich sehe mir die Verkaufschancen an.",
    );
  });

  it("says nothing without a spoken name, rather than guess", () => {
    expect(toolWaitLine(tableRead(false), "de", templates)).toBeUndefined();
  });

  it("says the search text of a search", () => {
    const search = {
      action: "other",
      object_kind: "row",
      source: "rules",
      read: {
        object_kind: "row",
        item: { title: { values: [{ text: "Keller" }] } },
      },
    } as unknown as ToolCallLabel;
    expect(toolWaitLine(search, "de", templates)).toBe(
      "Ich suche nach Keller.",
    );
    expect(
      toolWaitLine(search, "de", { ...templates, search: undefined }),
    ).toBeUndefined();
    // A long search text would hold the answer back: no line.
    const long = {
      action: "other",
      object_kind: "row",
      source: "rules",
      read: {
        object_kind: "row",
        item: {
          title: {
            values: [{ text: "Keller Maschinenbau GmbH Werk Süd Halle drei" }],
          },
        },
      },
    } as unknown as ToolCallLabel;
    expect(toolWaitLine(long, "de", templates)).toBeUndefined();
  });

  it("says nothing for a call that writes", () => {
    const write = {
      action: "update",
      object_kind: "row",
      source: "rules",
    } as unknown as ToolCallLabel;
    expect(toolWaitLine(write, "de", templates)).toBeUndefined();
    expect(toolWaitLine(undefined, "de", templates)).toBeUndefined();
  });
});
