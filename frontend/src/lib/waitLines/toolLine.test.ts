import { describe, expect, it } from "vitest";

import { toolWaitLine } from "./toolLine";

import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const templates = {
  search: "Ich suche nach {search}.",
  items: "Ich sehe mir {table} an.",
  list: "Ich sehe mir die {table} an.",
};

const withServer = { ...templates, server: "Ich sehe in {server} nach." };

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
    // A long search text would hold the answer back: never said, not cut.
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
    expect(toolWaitLine(long, "de", withServer, "Dynamics")).toBe(
      "Ich sehe in Dynamics nach.",
    );
  });

  it("names only the server for a read-only call nothing else names", () => {
    // Dataverse's `search_data` before its scope was understood, and a
    // Business Central action: no read description at all.
    const generic = {
      action: "other",
      object_kind: "other",
      source: "generic",
    } as unknown as ToolCallLabel;
    expect(toolWaitLine(generic, "de", withServer, "Business Central")).toBe(
      "Ich sehe in Business Central nach.",
    );
    // Nothing known about the call, not a plain read, or no template.
    expect(toolWaitLine(null, "de", withServer, "Dynamics")).toBeUndefined();
    expect(toolWaitLine(generic, "de", withServer)).toBeUndefined();
    expect(toolWaitLine(generic, "de", templates, "Dynamics")).toBeUndefined();
    // What a label can name still wins.
    expect(toolWaitLine(tableRead(true), "de", withServer, "Dynamics")).toBe(
      "Ich sehe mir die Verkaufschancen an.",
    );
  });

  it("says the table a read by one record's key reads", () => {
    // `read_query` with `WHERE opportunityid = '<guid>'`, as labelled live.
    const byKey = {
      action: "other",
      object_kind: "other",
      source: "generic",
      read: {
        object_kind: "row",
        item: {
          id: {
            pointer: "/querytext",
            values: [
              {
                path: "/querytext",
                text: "ae6c577c-e845-5994-a169-6713bbd1296a",
                machine_id: true,
              },
            ],
          },
        },
        query: { tables: ["opportunity"] },
      },
      spoken_names: { en: { tables: { opportunity: "opportunities" } } },
    } as unknown as ToolCallLabel;
    expect(
      toolWaitLine(byKey, "en", { items: "Looking at {table}." }, "Dynamics"),
    ).toBe("Looking at opportunities.");
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
