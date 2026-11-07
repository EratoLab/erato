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
  gistShownPaths,
  readArgumentView,
  toolCallCardOf,
  unshownArguments,
} from "./gist";
import {
  GIST_SHAPES,
  GIST_TITLE_SLOT,
  GIST_WHERE_SLOT,
  gistAskLineSlots,
  gistKindLabel,
  gistPlainLine,
  gistSentence,
  gistWarningLabel,
} from "./gistLabels";

import type {
  ToolArgumentNode,
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
    expect(toolCallCardOf(label, undefined)).toMatchObject({
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

/** The readable view the backend sends for an input, member by member. */
const viewOf = (value: unknown, path = ""): ToolArgumentNode =>
  Array.isArray(value)
    ? {
        path,
        kind: "list",
        children: value.map((entry, index) =>
          viewOf(entry, `${path}/${index}`),
        ),
      }
    : typeof value === "object" && value !== null
      ? {
          path,
          kind: "group",
          children: Object.entries(value).map(([name, member]) =>
            viewOf(
              member,
              `${path}/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`,
            ),
          ),
        }
      : { path, kind: "value" };

/** The paths of every value a view lists, in order. */
const leavesOf = (node: ToolArgumentNode | undefined): string[] =>
  node === undefined
    ? []
    : node.kind === "group" || node.kind === "list"
      ? (node.children ?? []).flatMap(leavesOf)
      : [node.path];

describe("arguments a gist does not show", () => {
  const input = {
    to: ["ana@example.com"],
    bcc: ["leak@example.net"],
    subject: "Q3",
    body: "Attached.",
    hasUserApproved: true,
  };
  const sendEmail: ToolCallLabel = {
    action: "send",
    object_kind: "email",
    source: "model",
    arguments: viewOf(input),
    items: [
      {
        title: {
          pointer: "/subject",
          values: [{ path: "/subject", text: "Q3" }],
        },
        target: {
          pointer: "/to/*",
          values: [{ path: "/to/0", text: "ana@example.com" }],
        },
        after: {
          pointer: "/body",
          values: [{ path: "/body", text: "Attached." }],
        },
      },
    ],
  };
  const restOf = (label: ToolCallLabel, value: unknown = input) => {
    const card = toolCallCardOf(label, value);
    if (card.kind !== "gist" || card.rest.kind !== "view") {
      throw new Error(`expected a gist with a view, got ${card.kind}`);
    }
    return card.rest;
  };

  it("lists a bcc the label leaves out, and no consent flag", () => {
    expect(leavesOf(restOf(sendEmail).view)).toEqual(["/bcc/0"]);
  });

  it("lists nothing when the gist shows every argument", () => {
    const shown = { ...input, bcc: undefined, hasUserApproved: undefined };
    const exact = JSON.parse(JSON.stringify(shown)) as unknown;
    expect(
      restOf({ ...sendEmail, arguments: viewOf(exact) }, exact).view,
    ).toBeUndefined();
  });

  it("lists the values a field holds past the ones it shows", () => {
    const many = { ...input, bcc: [], cc: ["a", "b", "c", "d", "e"] };
    const rest = restOf(
      {
        ...sendEmail,
        arguments: viewOf(many),
        items: [
          {
            ...sendEmail.items![0],
            fields: [
              {
                pointer: "/cc/*",
                name: "cc",
                values: many.cc.slice(0, 4).map((text, index) => ({
                  path: `/cc/${index}`,
                  text,
                })),
                omitted: 1,
              },
            ],
          },
        ],
      },
      many,
    );
    expect(leavesOf(rest.view)).toEqual(["/cc/3", "/cc/4"]);
  });

  it("lists the names a line counts instead of naming", () => {
    const batch = { pages: [{ title: "A" }, { title: "B" }] };
    const label: ToolCallLabel = {
      action: "create",
      object_kind: "page",
      source: "rules",
      arguments: viewOf(batch),
      items: [
        {
          // Two values on a pointer without a wildcard: no rows to name them in.
          title: {
            pointer: "/pages",
            values: [
              { path: "/pages/0/title", text: "A" },
              { path: "/pages/1/title", text: "B" },
            ],
          },
        },
      ],
    };
    expect(leavesOf(restOf(label, batch).view)).toEqual([
      "/pages/0/title",
      "/pages/1/title",
    ]);
  });

  it("counts a whole object a value shows, but not one it cuts short", () => {
    const nested = { meta: { a: "1", b: "2" }, title: "T" };
    const label = (truncated: boolean): ToolCallLabel => ({
      action: "create",
      object_kind: "page",
      source: "rules",
      arguments: viewOf(nested),
      items: [
        {
          title: {
            pointer: "/title",
            values: [{ path: "/title", text: "T" }],
          },
          fields: [
            {
              pointer: "/meta",
              name: "meta",
              values: [{ path: "/meta", text: '{"a":"1","b":"2"}', truncated }],
            },
          ],
        },
      ],
    });
    expect(restOf(label(false), nested).view).toBeUndefined();
    expect(leavesOf(restOf(label(true), nested).view)).toEqual([
      "/meta/a",
      "/meta/b",
    ]);
  });

  it("keeps members the view left out as a count, and says the view is cut", () => {
    const rest = restOf({
      ...sendEmail,
      warnings: ["arguments_truncated"],
      arguments: { ...viewOf(input), omitted: 3 },
    });
    expect(rest.view?.omitted).toBe(3);
    expect(rest.truncated).toBe(true);
  });

  it("shows the raw arguments for a gist whose label has no view", () => {
    const { arguments: _view, ...withoutView } = sendEmail;
    expect(toolCallCardOf(withoutView, input)).toMatchObject({
      kind: "gist",
      rest: { kind: "raw" },
    });
  });

  it("lists a title a translation's line leaves out", () => {
    try {
      i18n.load("en", {
        ...(enMessages as unknown as Messages),
        "toolGist.send.ask": "Send it",
      });
      i18n.activate("en");
      const card = toolCallCardOf(sendEmail, input, gistAskLineSlots);
      const rest =
        card.kind === "gist" && card.rest.kind === "view"
          ? card.rest.view
          : undefined;
      expect(leavesOf(rest)).toEqual(["/to/0", "/bcc/0", "/subject"]);
    } finally {
      activate("en");
    }
  });

  it("knows which values the card shows, and which whole", () => {
    const gist = gistOf(sendEmail, input)!;
    expect([...gistShownPaths(gist)]).toEqual([
      ["/subject", true],
      ["/to/0", true],
      ["/body", true],
    ]);
    expect(unshownArguments(viewOf(input), gist, input)).toBeDefined();
  });
});

describe("consent flags in a label", () => {
  const withField = (field: ToolCallLabelSlot) =>
    gistOf(
      {
        ...createRow,
        items: [{ ...createRow.items![0], fields: [field] }],
      },
      undefined,
    );

  it.each<[string, ToolCallLabelSlot]>([
    [
      "hasUserApproved",
      {
        pointer: "/hasUserApproved",
        name: "hasUserApproved",
        values: [{ path: "/hasUserApproved", text: "true" }],
      },
    ],
    [
      "a flag nested under a consent member",
      {
        pointer: "/userConsent/given",
        values: [{ path: "/userConsent/given", text: "yes" }],
      },
    ],
    [
      "a flag whose name only the label gives",
      {
        pointer: "/x",
        name: "user_confirmed",
        values: [{ path: "/x", text: "false" }],
      },
    ],
  ])("leaves %s out of the key values", (_name, field) => {
    expect(withField(field)?.items[0].fields).toEqual([]);
  });

  it("keeps a field that changes approval itself", () => {
    const field: ToolCallLabelSlot = {
      pointer: "/approved",
      name: "approved",
      values: [{ path: "/approved", text: "true" }],
    };
    expect(withField(field)?.items[0].fields).toHaveLength(1);
  });

  it("gives a line that would name a consent flag the generic card", () => {
    expect(
      gistOf(
        {
          ...createRow,
          items: [
            {
              title: {
                pointer: "/hasUserApproved",
                values: [{ path: "/hasUserApproved", text: "true" }],
              },
            },
          ],
        },
        undefined,
      ),
    ).toBeUndefined();
  });
});

describe("labels from other writers", () => {
  it.each<[string, unknown]>([
    ["a source this build does not know", { ...createRow, source: "adapter" }],
    ["a warning this build does not know", { ...createRow, warnings: ["x"] }],
    ["warnings that are not a list", { ...createRow, warnings: "other" }],
    ["a verb that is not text", { ...createRow, action: ["create"] }],
  ])("gives %s the generic card", (_name, label) => {
    expect(gistOf(label as ToolCallLabel, undefined)).toBeUndefined();
    expect(toolCallCardOf(label as ToolCallLabel, undefined).kind).toBe(
      "generic",
    );
  });

  it.each<[string, unknown]>([
    ["text", "create row"],
    ["a number", 42],
    ["a list", [createRow]],
  ])("gives a label that is %s the old card", (_name, label) => {
    expect(toolCallCardOf(label as ToolCallLabel, {}).kind).toBe("legacy");
  });

  it("gives a label that throws when read the old card", () => {
    const label = { ...createRow };
    Object.defineProperty(label, "items", {
      get() {
        throw new Error("unreadable");
      },
    });
    expect(toolCallCardOf(label, {})).toEqual({ kind: "legacy" });
  });

  it("reads values of the wrong types as absent, and only text as text", () => {
    const gist = gistOf(
      {
        ...createRow,
        items: [
          null,
          "row",
          {
            title: {
              pointer: "/pages/*/properties/Name",
              values: [
                null,
                { path: 1, text: "x" },
                { path: "/pages/0/properties/Name", text: { a: 1 } },
                {
                  path: "/pages/1/properties/Name",
                  text: "Northwind\u202E",
                  resolved: ["Acme"],
                },
              ],
              omitted: "3",
              name: { a: 1 },
            },
            fields: "Status",
            target: { pointer: 5, values: [] },
          },
        ],
      } as unknown as ToolCallLabel,
      undefined,
    )!;
    expect(gist.items).toHaveLength(1);
    const [item] = gist.items;
    expect(item.names).toEqual([
      expect.objectContaining({ text: "Northwind", origin: "written" }),
    ]);
    expect(item.count).toBe(1);
    expect(item.where).toEqual([]);
    expect(item.fields).toEqual([]);
  });

  it("caps huge labels: long text, many values, many items", () => {
    const text = "N".repeat(1_000_000);
    const title = {
      pointer: "/pages/*/properties/Name",
      values: Array.from({ length: 10_000 }, (_, index) => ({
        path: `/pages/${index}/properties/Name`,
        text,
      })),
    };
    const fields = Array.from({ length: 1_000 }, (_, index) => ({
      pointer: `/f${index}`,
      values: [{ path: `/f${index}`, text: "v" }],
    }));
    const gist = gistOf(
      {
        ...createRow,
        items: Array.from({ length: 1_000 }, () => ({ title, fields })),
      },
      undefined,
    )!;
    expect(gist.items.length).toBeLessThanOrEqual(10);
    const [item] = gist.items;
    expect(item.names.length).toBeLessThanOrEqual(50);
    expect(item.count).toBe(10_000);
    expect(item.names[0].text.length).toBeLessThanOrEqual(4_000);
    expect(item.names[0].truncated).toBe(true);
    expect(item.fields.length).toBeLessThanOrEqual(16);
  });

  it("reads a readable view it can render, counting the rest", () => {
    let deep: unknown = { path: "/leaf", kind: "value" };
    for (let depth = 0; depth < 5_000; depth++) {
      deep = { path: "", kind: "group", children: [deep] };
    }
    const deepView = readArgumentView(deep)!;
    let depth = 0;
    for (let node = deepView; node.children?.length; node = node.children[0]) {
      depth += 1;
    }
    expect(depth).toBeLessThanOrEqual(16);

    const wide = readArgumentView({
      path: "",
      kind: "group",
      children: Array.from({ length: 100_000 }, (_, index) => ({
        path: `/m${index}`,
        kind: "value",
      })),
    })!;
    expect(wide.children!.length).toBeLessThan(1_000);
    expect(wide.children!.length + (wide.omitted ?? 0)).toBe(100_000);

    expect(
      readArgumentView({
        path: "",
        kind: "group",
        children: [null, 5, { path: 1, kind: "value" }, { path: "/a" }],
        omitted: -2,
      }),
    ).toEqual({ path: "", kind: "group", children: [], omitted: 4 });
    expect(readArgumentView("view")).toBeUndefined();
  });

  it("finds a sharing member in a huge input without walking all of it", () => {
    const input = {
      title: "Hiring",
      visibility: "public",
      rows: Array.from({ length: 200_000 }, (_, index) => ({ index })),
    };
    const started = Date.now();
    const gist = gistOf(
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
          },
        ],
      },
      input,
    );
    expect(gist?.warnings).toEqual(["public"]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
