import { describe, expect, it } from "vitest";

import { allowOnceEmphasisOf, toolMarksOf } from "./decision";
import { toolFactsLine } from "./decisionLabels";
import { toolCallCardOf } from "./gist";

import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const named = {
  title: {
    pointer: "/name",
    values: [{ path: "/name", text: "Example Ltd" }],
  },
};

const cardFor = (
  overrides: Record<string, unknown>,
  change: Record<string, unknown> | null = {},
) =>
  toolCallCardOf(
    {
      action: "update",
      object_kind: "row",
      source: "rules",
      items: [named],
      ...(change === null
        ? {}
        : { change: { counts: {}, complete: true, ...change } }),
      ...overrides,
    } as unknown as ToolCallLabel,
    { name: "Example Ltd" },
  );

const setEffect = {
  path: "/city",
  name: "City",
  raw_name: "city",
  effect: "set",
  values: [{ text: "Sampletown" }],
};

describe("how Allow once looks", () => {
  it("is filled only when the card states nothing to check", () => {
    expect(
      allowOnceEmphasisOf(
        cardFor(
          { action: "create" },
          { effects: [setEffect], counts: { set: 1 } },
        ),
      ),
    ).toBe("filled");
    // A mark on the tool is about every call, not something in this one.
    expect(
      allowOnceEmphasisOf(
        cardFor(
          { action: "create" },
          {
            effects: [setEffect],
            counts: { set: 1 },
            notes: ["operator_marked_destructive", "marked_destructive"],
          },
        ),
      ),
    ).toBe("filled");
    expect(allowOnceEmphasisOf({ kind: "legacy" })).toBe("filled");
  });

  it.each([
    [
      "an address outside the organisation",
      {
        recipients: {
          total: 1,
          groups: [{ kind: "to", count: 1, values: ["ana@fabrikam.example"] }],
          outside: ["ana@fabrikam.example"],
          outside_known: true,
        },
      },
    ],
    [
      "recipients nobody could check",
      {
        recipients: {
          total: 2,
          groups: [{ kind: "to", count: 2, values: ["a@x.example", "b"] }],
          outside_known: false,
        },
      },
    ],
    ["a record nobody read", { record_unread: true }],
    ["a call too large to read", { complete: false }],
    ["a row count nobody knows", { notes: ["row_count_unknown"] }],
    [
      "a hand-off",
      {
        opaque: [
          {
            kind: "instruction",
            path: "/task",
            text: "Click Publish",
            lines: 1,
          },
        ],
        notes: ["instruction_outcome_unknown"],
      },
    ],
    [
      "a risky word that removes nothing",
      {
        opaque: [
          {
            kind: "shell",
            path: "/cmd",
            text: "sudo reboot",
            lines: 1,
            found: ["sudo", "reboot"],
          },
        ],
      },
    ],
    ["an empty filter", { filter: { every_record: true } }],
  ])("is plain for %s", (_case, change) => {
    expect(allowOnceEmphasisOf(cardFor({}, change))).toBe("plain");
  });

  it("is plain for a value the card warns about", () => {
    const card = toolCallCardOf(
      {
        action: "share",
        object_kind: "file",
        source: "rules",
        items: [
          {
            ...named,
            fields: [
              {
                pointer: "/visibility",
                name: "visibility",
                values: [{ path: "/visibility", text: "public" }],
              },
            ],
          },
        ],
      } as unknown as ToolCallLabel,
      { name: "Example Ltd", visibility: "public" },
    );
    expect(allowOnceEmphasisOf(card)).toBe("plain");
  });

  it.each([
    ["a delete", { action: "delete" }, null],
    ["an archive", { action: "archive" }, null],
    [
      "an emptied value",
      {},
      {
        effects: [
          {
            path: "/owner",
            name: "Owner",
            raw_name: "owner",
            effect: "emptied",
          },
        ],
        counts: { emptied: 1 },
      },
    ],
    [
      "list items that go",
      {},
      {
        effects: [
          {
            path: "/labels",
            name: "Labels",
            raw_name: "labels",
            effect: "list_replaced",
            values: [{ text: "bug" }],
            removed: [{ text: "p1" }],
            kept: [{ text: "bug" }],
            list: true,
          },
        ],
        counts: { list_replaced: 1 },
        notes: ["tool_says_replaces_list"],
      },
    ],
    [
      "a DELETE found in SQL",
      { action: "run" },
      {
        opaque: [
          {
            kind: "sql",
            path: "/sql",
            text: "WITH gone AS (DELETE FROM log) SELECT 1",
            lines: 1,
            found: ["DELETE"],
            write_inside_read: true,
          },
        ],
      },
    ],
    [
      "rm found in a command",
      { action: "run" },
      {
        opaque: [
          {
            kind: "shell",
            path: "/cmd",
            text: "rm -rf build",
            lines: 1,
            found: ["rm"],
          },
        ],
      },
    ],
    [
      "a batch that deletes",
      {},
      {
        batch: {
          name: "Operations",
          total: 2,
          rows: [],
          deletions: 1,
          operations: [],
          fields: [],
        },
      },
    ],
  ])("is outlined red for %s", (_case, overrides, change) => {
    expect(allowOnceEmphasisOf(cardFor(overrides, change))).toBe("loss");
  });

  it("never reads a loss from a model's mapping alone, and fills no delete it guessed", () => {
    expect(
      allowOnceEmphasisOf(cardFor({ action: "delete", source: "model" }, null)),
    ).toBe("plain");
    expect(
      allowOnceEmphasisOf(
        cardFor(
          { action: "delete", source: "model" },
          { notes: ["delete_outcome_unknown"] },
        ),
      ),
    ).toBe("loss");
  });

  it("would go is no loss yet: a list that may only be added to is plain", () => {
    expect(
      allowOnceEmphasisOf(
        cardFor(
          {},
          {
            effects: [
              {
                path: "/labels",
                name: "Labels",
                raw_name: "labels",
                effect: "list_replaced",
                values: [{ text: "bug" }],
                removed: [{ text: "p1" }],
                list: true,
              },
            ],
            counts: { list_replaced: 1 },
            notes: ["list_replace_unknown"],
          },
        ),
      ),
    ).toBe("plain");
  });
});

describe("the line about the tool", () => {
  it("merges the organisation's mark with its lock into one sentence", () => {
    const marks = toolMarksOf(
      cardFor({}, { notes: ["operator_marked_destructive"] }),
    );
    expect(marks).toEqual({ toolMarked: false, orgMarked: true });
    expect(toolFactsLine({ ...marks, locked: true, openWorld: false })).toBe(
      "Your organisation has marked this tool as destructive and requires confirmation each time it runs.",
    );
    expect(toolFactsLine({ ...marks, locked: false, openWorld: true })).toBe(
      "Your organisation has marked this tool as destructive. This tool may send data to an external service.",
    );
  });

  it("names the tool's own mark and the lock apart, and says nothing when nothing is known", () => {
    expect(
      toolFactsLine({
        toolMarked: true,
        orgMarked: false,
        locked: true,
        openWorld: false,
      }),
    ).toBe(
      "The tool marks this as destructive. Locked: your organization requires confirmation each time this tool runs.",
    );
    expect(
      toolFactsLine({
        toolMarked: false,
        orgMarked: false,
        locked: false,
        openWorld: false,
      }),
    ).toBeUndefined();
  });
});
