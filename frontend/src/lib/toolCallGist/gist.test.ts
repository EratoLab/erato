import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";

import { messages as deMessages } from "@/locales/de/messages.json";
import { messages as enMessages } from "@/locales/en/messages.json";
import { messages as plMessages } from "@/locales/pl/messages.json";

import {
  GIST_ACTIONS,
  GIST_KINDS,
  GIST_PHASES,
  fieldWarningOf,
  gistOf,
  toolCallCardOf,
} from "./gist";
import {
  GIST_SHAPES,
  GIST_TITLE_SLOT,
  GIST_WHERE_SLOT,
  gistKindLabel,
  gistPlainLine,
  gistSentence,
  gistWarningLabel,
} from "./gistLabels";

import type {
  ToolCallLabel,
  ToolCallLabelSlot,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

const activate = (locale: "de" | "en" | "pl") => {
  const catalogs = { de: deMessages, en: enMessages, pl: plMessages };
  i18n.load(locale, catalogs[locale] as unknown as Messages);
  i18n.activate(locale);
};

const UUID = "9b1d5f2e-3c4a-4f88-a1b2-0c1d2e3f4a5b";

const createRow: ToolCallLabel = {
  action: "create",
  object_kind: "row",
  source: "rules",
  items: [
    {
      title: {
        pointer: "/pages/*/properties/Name",
        values: [{ path: "/pages/0/properties/Name", text: "Northwind" }],
      },
      target: {
        pointer: "/parent/data_source_id",
        values: [
          { path: "/parent/data_source_id", text: UUID, resolved: "Companies" },
        ],
      },
      fields: [
        {
          pointer: "/pages/*/properties/Status",
          name: "Status",
          values: [{ path: "/pages/0/properties/Status", text: "Lead" }],
        },
      ],
    },
  ],
};

describe("gist sentences", () => {
  it("has a sentence for every verb, phase and shape, with the slots it names", () => {
    for (const action of GIST_ACTIONS) {
      for (const phase of GIST_PHASES) {
        const sentences = GIST_SHAPES.map((shape) =>
          gistSentence({
            action,
            phase,
            shape,
            kind: "KIND",
            title: GIST_TITLE_SLOT,
            where: GIST_WHERE_SLOT,
          }),
        );
        const [full, titled, placed, other] = sentences;
        expect(new Set(sentences).size).toBe(4);
        for (const sentence of sentences) {
          expect(sentence).toContain("KIND");
        }
        expect(full).toContain(GIST_TITLE_SLOT);
        expect(full).toContain(GIST_WHERE_SLOT);
        expect(titled).toContain(GIST_TITLE_SLOT);
        expect(titled).not.toContain(GIST_WHERE_SLOT);
        expect(placed).toContain(GIST_WHERE_SLOT);
        expect(placed).not.toContain(GIST_TITLE_SLOT);
        expect(other).not.toMatch(/[\uE000\uE001]/);
      }
    }
  });

  it("says each phase differently", () => {
    const sentence = (phase: (typeof GIST_PHASES)[number]) =>
      gistSentence({
        action: "update",
        phase,
        shape: "other",
        kind: "page",
        title: "",
        where: "",
      });
    expect(sentence("ask")).toBe("Update page");
    expect(sentence("done")).toBe("Updated page");
    expect(sentence("failed")).toBe("Could not update page");
  });

  it("has a noun for every kind, counted when there are several", () => {
    for (const kind of GIST_KINDS) {
      const one = gistKindLabel(kind, 1);
      expect(one.length).toBeGreaterThan(0);
      expect(one).not.toMatch(/\d/);
      expect(gistKindLabel(kind, 3)).toMatch(/^3 /);
    }
    expect(gistKindLabel("other", 1)).toBe("item");
  });

  describe("in other languages", () => {
    afterEach(() => activate("en"));

    it("lets a language put the verb where it belongs and count the kind its way", () => {
      const gist = gistOf(createRow, undefined)!;
      activate("de");
      expect(gistPlainLine(gist, gist.items[0], "ask")).toBe(
        "Zeile “Northwind” in Companies erstellen",
      );
      expect(gistKindLabel("row", 3)).toBe("3 Zeilen");
      activate("pl");
      expect(gistKindLabel("row", 5)).toBe("5 wierszy");
    });
  });

  it("words every warning", () => {
    expect(gistWarningLabel("workspace")).toMatch(/workspace/);
    expect(gistWarningLabel("public")).toMatch(/anyone/);
  });
});

describe("gistOf", () => {
  it("reads a rules label as a line with a quoted title, a resolved destination and key values", () => {
    const gist = gistOf(createRow, undefined);
    expect(gist).toBeDefined();
    const item = gist!.items[0];
    expect(item.names).toEqual([
      expect.objectContaining({ text: "Northwind", origin: "written" }),
    ]);
    expect(item.where).toEqual([
      expect.objectContaining({
        text: "Companies",
        origin: "resolved",
        written: UUID,
      }),
    ]);
    expect(item.fields[0]).toMatchObject({ name: "Status" });
    expect(gistPlainLine(gist!, item, "ask")).toBe(
      "Create row “Northwind” in Companies",
    );
    expect(gistPlainLine(gist!, item, "done")).toBe(
      "Created row “Northwind” in Companies",
    );
  });

  it("shows an ID nothing resolved as a short ID, and a written name as written", () => {
    const gist = gistOf(
      {
        ...createRow,
        action: "update",
        object_kind: "page",
        items: [
          {
            id: {
              pointer: "/page_id",
              values: [{ path: "/page_id", text: UUID }],
            },
            target: {
              pointer: "/channel",
              values: [{ path: "/channel", text: "release" }],
            },
          },
        ],
      },
      undefined,
    );
    const item = gist!.items[0];
    expect(item.names[0]).toMatchObject({
      origin: "id",
      text: "9b1d5f2e…",
      written: UUID,
    });
    expect(item.where[0]).toMatchObject({ origin: "written", text: "release" });
  });

  it("pairs an update's field with the value an earlier result had", () => {
    const gist = gistOf(
      {
        action: "update",
        object_kind: "row",
        source: "rules",
        items: [
          {
            id: {
              pointer: "/recordId",
              values: [
                { path: "/recordId", text: UUID, resolved: "Northwind" },
              ],
            },
            fields: [
              {
                pointer: "/item/statuscode",
                name: "statuscode",
                values: [
                  { path: "/item/statuscode", text: "Won", resolved: "Open" },
                ],
              },
            ],
          },
        ],
      },
      undefined,
    );
    expect(gist!.items[0].fields[0].values[0]).toEqual({
      value: expect.objectContaining({ text: "Won", origin: "written" }),
      earlier: expect.objectContaining({ text: "Open", origin: "earlier" }),
    });
  });

  it("counts a batch and lines its fields up by array position", () => {
    const gist = gistOf(
      {
        ...createRow,
        items: [
          {
            title: {
              pointer: "/pages/*/properties/Name",
              values: [
                { path: "/pages/0/properties/Name", text: "Northwind" },
                { path: "/pages/1/properties/Name", text: "Fabrikam" },
              ],
              omitted: 1,
            },
            fields: [
              {
                pointer: "/pages/*/properties/Status",
                name: "Status",
                values: [{ path: "/pages/1/properties/Status", text: "Lead" }],
              },
            ],
          },
        ],
      },
      undefined,
    );
    const item = gist!.items[0];
    expect(item.count).toBe(3);
    expect(item.names.map((name) => name.row)).toEqual(["0", "1"]);
    expect(item.fields[0].values[0].value.row).toBe("1");
    expect(gistPlainLine(gist!, item, "ask")).toBe("Create 3 rows");
  });

  it("puts a title into the plain line as written, never as a replacement pattern", () => {
    const title = "Q$&A $` x $' $$ \uE001";
    const gist = gistOf(
      {
        ...createRow,
        items: [
          {
            ...createRow.items![0],
            title: {
              pointer: "/pages/*/properties/Name",
              values: [{ path: "/pages/0/properties/Name", text: title }],
            },
          },
        ],
      },
      undefined,
    )!;
    expect(gistPlainLine(gist, gist.items[0], "ask")).toBe(
      `Create row “${title}” in Companies`,
    );
  });

  it.each<[string, ToolCallLabel]>([
    ["a generic label", { ...createRow, source: "generic" }],
    ["a verb without a sentence", { ...createRow, action: "other" }],
    [
      "a verb from a newer server",
      { ...createRow, action: "archive" as ToolCallLabel["action"] },
    ],
    [
      "a kind from a newer server",
      { ...createRow, object_kind: "invoice" as ToolCallLabel["object_kind"] },
    ],
    ["a label without items", { ...createRow, items: [] }],
    [
      "a delete that does not say which record",
      {
        ...createRow,
        action: "delete",
        items: [{ fields: createRow.items![0].fields }],
      },
    ],
    [
      "a label with a warning from a newer server",
      { ...createRow, warnings: ["other"] },
    ],
    [
      "an item of no kind that names nothing",
      {
        ...createRow,
        object_kind: "other",
        items: [
          {
            after: {
              pointer: "/message",
              values: [{ path: "/message", text: "Ready" }],
            },
          },
        ],
      },
    ],
  ])("gives %s the generic card", (_name, label) => {
    expect(gistOf(label, undefined)).toBeUndefined();
    expect(toolCallCardOf(label, undefined)).toEqual({
      kind: "generic",
      label,
    });
  });

  it("keeps a new record that only has values on the gist", () => {
    const gist = gistOf(
      { ...createRow, items: [{ fields: createRow.items![0].fields }] },
      undefined,
    );
    expect(gist && gistPlainLine(gist, gist.items[0], "ask")).toBe(
      "Create row",
    );
  });

  it("keeps rows saved before labels on the old card", () => {
    expect(toolCallCardOf(undefined, {}).kind).toBe("legacy");
    expect(toolCallCardOf(createRow, {}).kind).toBe("gist");
  });
});

describe("gist warnings", () => {
  const folder = (input: unknown, fields?: ToolCallLabelSlot[]) =>
    gistOf(
      {
        action: "create",
        object_kind: "folder",
        source: "rules",
        items: [
          {
            title: {
              pointer: "/title",
              values: [{ path: "/title", text: "Hiring" }],
            },
            fields,
          },
        ],
      },
      input,
    )?.warnings;

  it("reads a sharing member the label kept no field for", () => {
    expect(
      folder({
        title: "Hiring",
        description: "Open roles",
        color: "blue",
        icon: "briefcase",
        parent: "root",
        visibility: "workspace",
      }),
    ).toEqual(["workspace"]);
  });

  it("reads a top-level sharing member beside a nested title", () => {
    const gist = gistOf(createRow, {
      parent: { data_source_id: UUID },
      pages: [{ properties: { Name: "Northwind" } }],
      sharing: "Public",
    });
    expect(gist?.warnings).toEqual(["public"]);
  });

  it("adds the warning of a field the label kept", () => {
    expect(
      folder(undefined, [
        {
          pointer: "/visibility",
          name: "visibility",
          values: [{ path: "/visibility", text: "team" }],
        },
      ]),
    ).toEqual(["workspace"]);
  });

  it("warns about nothing a call keeps private", () => {
    expect(folder({ title: "Hiring", visibility: "private" })).toEqual([]);
    expect(folder({ title: "Hiring", status: "public" })).toEqual([]);
  });
});

describe("fieldWarningOf", () => {
  it.each([
    ["visibility", ["workspace"], "workspace"],
    ["Visibility", ["Public"], "public"],
    ["sharing", ["team"], "workspace"],
    ["visibility", ["private"], undefined],
    ["status", ["public"], undefined],
  ])("reads %s %o as %s", (name, values, warning) => {
    expect(fieldWarningOf(name, values)).toBe(warning);
  });
});
