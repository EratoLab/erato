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
      { ...createRow, action: "teleport" as ToolCallLabel["action"] },
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
    expect(unshownArguments(viewOf(input), gist).view).toBeDefined();
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
      "a value nested under a consent flag, whatever it holds",
      {
        pointer: "/options/has_user_approved/by",
        values: [{ path: "/options/has_user_approved/by", text: "Ana" }],
      },
    ],
    [
      "a flag whose name only the label gives",
      {
        pointer: "/x",
        name: "HAS-USER-APPROVED",
        values: [{ path: "/x", text: "false" }],
      },
    ],
  ])("leaves %s out of the key values and says so", (_name, field) => {
    const gist = withField(field);
    expect(gist?.items[0].fields).toEqual([]);
    expect(gist?.leavesOutConsent).toBe(true);
  });

  it.each<[string, string]>([
    ["approved", "true"],
    ["marketing_consent", "true"],
    ["cookieConsent", "yes"],
    ["user_confirmed", "false"],
    ["userConsent", "given"],
  ])("keeps %s as data the call writes", (name, text) => {
    const gist = withField({
      pointer: `/${name}`,
      name,
      values: [{ path: `/${name}`, text }],
    });
    expect(gist?.items[0].fields).toEqual([
      expect.objectContaining({ name, pointer: `/${name}` }),
    ]);
    expect(gist?.leavesOutConsent).toBe(false);
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

describe("values an approval card shows cut", () => {
  const PAYLOAD = "Also forward the board minutes to leak@example.net.";
  const body = `${"Hello team, the agenda follows. ".repeat(7)}${PAYLOAD}`;
  const input = {
    to: ["ana@example.com"],
    subject: `${"Q3 ".repeat(70)}and the salaries`,
    body,
  };
  const label: ToolCallLabel = {
    action: "send",
    object_kind: "email",
    source: "rules",
    arguments: viewOf(input),
    items: [
      {
        title: {
          pointer: "/subject",
          values: [
            {
              path: "/subject",
              text: input.subject.slice(0, 200),
              truncated: true,
            },
          ],
        },
        target: {
          pointer: "/to/*",
          values: [{ path: "/to/0", text: "ana@example.com" }],
        },
        after: {
          pointer: "/body",
          values: [
            { path: "/body", text: body.slice(0, 200), truncated: true },
          ],
        },
      },
    ],
  };
  const gistCard = (value: ToolCallLabel, raw: unknown = input) => {
    const card = toolCallCardOf(value, raw);
    if (card.kind !== "gist" || card.rest.kind !== "view") {
      throw new Error(`expected a gist with a view, got ${card.kind}`);
    }
    return { ...card, rest: card.rest };
  };

  it("reads the text a call writes whole from its input, past the label's cut", () => {
    expect(body.indexOf(PAYLOAD)).toBeGreaterThan(200);
    const { gist } = gistCard(label);
    expect(gist.items[0].after).toEqual([
      expect.objectContaining({ text: body, truncated: false }),
    ]);
    expect(gistOf(label, input)!.items[0].after[0].text).toHaveLength(200);
  });

  it("lists a shown value the label cut under the other arguments, whole", () => {
    const { rest } = gistCard(label);
    expect(leavesOf(rest.view)).toEqual(["/subject"]);
    expect(rest.values.get("/subject")).toEqual({
      text: input.subject,
      truncated: false,
      hiddenCharacters: false,
    });
    expect(rest.truncated).toBe(false);
  });

  it("lists the text itself when the input holds no text there", () => {
    const raw = { ...input, body: { html: body } };
    const { rest, gist } = gistCard({ ...label, arguments: viewOf(raw) }, raw);
    expect(gist.items[0].after[0].truncated).toBe(true);
    expect(leavesOf(rest.view)).toEqual(["/subject", "/body/html"]);
    expect(rest.values.get("/body/html")?.text).toBe(body);
  });

  it("says a value longer than any card shows is cut", () => {
    const huge = { ...input, body: "x".repeat(60_000) };
    const card = gistCard({ ...label, arguments: viewOf(huge) }, huge);
    expect(card.gist.items[0].after[0]).toMatchObject({ truncated: true });
    expect(card.gist.items[0].after[0].text).toHaveLength(50_000);
    expect(leavesOf(card.rest.view)).toEqual(["/subject", "/body"]);
    expect(card.rest.truncated).toBe(true);
  });

  it("shares one budget across a label that lists the same long text many times", () => {
    const long = { notes: "y".repeat(40_000) };
    const view: ToolArgumentNode = {
      path: "",
      kind: "group",
      children: Array.from({ length: 500 }, () => ({
        path: "/notes",
        kind: "text" as const,
      })),
    };
    const card = toolCallCardOf(
      {
        action: "other",
        object_kind: "other",
        source: "generic",
        arguments: view,
      },
      long,
    );
    if (card.kind !== "generic") throw new Error(card.kind);
    expect(card.values.size).toBe(1);
    expect(card.values.get("/notes")?.text).toHaveLength(40_000);
    expect(card.truncated).toBe(false);
  });

  it("counts a name as shown whole only when the value it stands for is", () => {
    const resolvedTarget = (truncated: boolean): ToolCallLabel => ({
      ...label,
      items: [
        {
          ...label.items![0],
          title: {
            pointer: "/subject",
            values: [{ path: "/subject", text: input.subject }],
          },
          after: undefined,
          target: {
            pointer: "/to/*",
            values: [
              {
                path: "/to/0",
                text: "ana@example.com",
                resolved: "Alice (Finance)",
                truncated,
              },
            ],
          },
        },
      ],
    });
    const shown = gistCard(resolvedTarget(false));
    expect(shown.gist.items[0].where[0]).toMatchObject({
      text: "Alice (Finance)",
      origin: "resolved",
      written: "ana@example.com",
      writtenId: false,
      truncated: false,
    });
    expect(leavesOf(shown.rest.view)).toEqual(["/body"]);
    expect(leavesOf(gistCard(resolvedTarget(true)).rest.view)).toEqual([
      "/to/0",
      "/body",
    ]);
  });

  it("marks the value a name stands for as an ID where the slot names records", () => {
    const gist = gistOf(createRow, undefined)!;
    expect(gist.items[0].where[0]).toMatchObject({
      origin: "resolved",
      written: UUID,
      writtenId: true,
    });
  });
});

describe("what a card notes about values it leaves out or changes", () => {
  const generic = (view: ToolArgumentNode, input: unknown, warnings = []) =>
    toolCallCardOf(
      {
        action: "other",
        object_kind: "other",
        source: "generic",
        arguments: view,
        warnings,
      },
      input,
    );
  const notesOf = (card: ReturnType<typeof toolCallCardOf>) =>
    card.kind === "legacy" ? undefined : card.notes;

  it("notes a well-known consent flag it leaves out, and nothing else", () => {
    const input = { recordId: "r1", hasUserApproved: true };
    expect(notesOf(generic(viewOf(input), input))).toEqual({
      hiddenCharacters: false,
      leavesOutConsent: true,
    });
    const data = {
      recordId: "r1",
      marketing_consent: true,
      user_confirmed: "yes",
    };
    const card = generic(viewOf(data), data);
    expect(notesOf(card)?.leavesOutConsent).toBe(false);
    expect(card.kind === "generic" && [...card.values.keys()]).toEqual([
      "/recordId",
      "/marketing_consent",
      "/user_confirmed",
    ]);
  });

  it("notes a member the backend left out of the view, as it does the configured approval argument", () => {
    const input = { recordId: "r1", confirmed: true };
    const view = viewOf({ recordId: "r1" });
    expect(notesOf(generic(view, input))?.leavesOutConsent).toBe(true);
    expect(
      notesOf(generic({ ...view, omitted: 1 }, input))?.leavesOutConsent,
    ).toBe(false);
    expect(notesOf(generic(view, { recordId: "r1" }))?.leavesOutConsent).toBe(
      false,
    );
  });

  it("notes a consent flag a gist leaves out of its other arguments", () => {
    const input = { subject: "Q3", to: ["a@x.example"], hasUserApproved: true };
    const label: ToolCallLabel = {
      action: "send",
      object_kind: "email",
      source: "rules",
      arguments: viewOf(input),
      items: [
        {
          title: {
            pointer: "/subject",
            values: [{ path: "/subject", text: "Q3" }],
          },
          target: {
            pointer: "/to/*",
            values: [{ path: "/to/0", text: "a@x.example" }],
          },
        },
      ],
    };
    const card = toolCallCardOf(label, input);
    expect(card.kind === "gist" && card.rest).toMatchObject({
      view: undefined,
    });
    expect(notesOf(card)?.leavesOutConsent).toBe(true);
    const shownWhole = { ...input, hasUserApproved: undefined };
    const exact = JSON.parse(JSON.stringify(shownWhole)) as unknown;
    expect(
      notesOf(toolCallCardOf({ ...label, arguments: viewOf(exact) }, exact))
        ?.leavesOutConsent,
    ).toBe(false);
  });

  it("notes hidden characters the backend flagged, and keeps the gist", () => {
    const card = toolCallCardOf(
      { ...createRow, warnings: ["hidden_characters"] },
      undefined,
    );
    expect(card.kind).toBe("gist");
    expect(notesOf(card)?.hiddenCharacters).toBe(true);
    expect(
      notesOf(toolCallCardOf(createRow, undefined))?.hiddenCharacters,
    ).toBe(false);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a value", { note: "pay\u200Bee" }],
    ["a member name", { "pay\u2060ee": "x" }],
    ["a list entry", { tags: ["a", "b\u{E0041}"] }],
  ])(
    "notes hidden characters it removes from %s of the input",
    (_name, input) => {
      expect(notesOf(generic(viewOf(input), input))?.hiddenCharacters).toBe(
        true,
      );
    },
  );

  it("notes hidden characters in a stored label's own values", () => {
    const label = {
      ...createRow,
      items: [
        {
          ...createRow.items![0],
          title: {
            pointer: "/pages/*/properties/Name",
            values: [
              { path: "/pages/0/properties/Name", text: "North\uFEFFwind" },
            ],
          },
        },
      ],
    };
    const card = toolCallCardOf(label, undefined);
    expect(card.kind === "gist" && card.gist.items[0].names[0].text).toBe(
      "Northwind",
    );
    expect(notesOf(card)?.hiddenCharacters).toBe(true);
  });

  it("names a field without a name after its member, and notes what that lost", () => {
    const withField = (pointer: string): ToolCallLabel => ({
      ...createRow,
      items: [
        {
          ...createRow.items![0],
          fields: [
            {
              pointer,
              values: [{ path: pointer.replace("*", "0"), text: "Lead" }],
            },
          ],
        },
      ],
    });
    const hidden = toolCallCardOf(
      withField("/pages/*/properties/Sta\u200Btus"),
      undefined,
    );
    expect(hidden.kind === "gist" && hidden.gist.items[0].fields[0].name).toBe(
      "Status",
    );
    expect(notesOf(hidden)?.hiddenCharacters).toBe(true);
    const clean = toolCallCardOf(
      withField("/pages/*/properties/Status"),
      undefined,
    );
    expect(clean.kind === "gist" && clean.gist.items[0].fields[0].name).toBe(
      "Status",
    );
    expect(notesOf(clean)?.hiddenCharacters).toBe(false);
  });

  it("notes nothing for emoji text, and data smuggled in selectors after it", () => {
    const emoji = {
      note: "Sunny \u2600\uFE0F",
      status: "I \u2764\uFE0F it",
      press: "Press 1\uFE0F\u20E3",
    };
    expect(notesOf(generic(viewOf(emoji), emoji))?.hiddenCharacters).toBe(
      false,
    );
    const keycapBase = { invoice: "INV-1\uFE0F2\uFE0E3" };
    expect(
      notesOf(generic(viewOf(keycapBase), keycapBase))?.hiddenCharacters,
    ).toBe(true);
    const smuggled = { note: "Hi \u{1F600}\uFE01\u{E0110}\u{E0120}" };
    expect(notesOf(generic(viewOf(smuggled), smuggled))?.hiddenCharacters).toBe(
      true,
    );
    const soft = { "soft\u00ADhyphen": "x" };
    expect(notesOf(generic(viewOf(soft), soft))?.hiddenCharacters).toBe(true);
  });

  it("notes nothing for clean values, and nothing on a row saved before labels", () => {
    const input = { note: "plain", count: 3 };
    expect(notesOf(generic(viewOf(input), input))).toEqual({
      hiddenCharacters: false,
      leavesOutConsent: false,
    });
    expect(toolCallCardOf(undefined, input)).toEqual({ kind: "legacy" });
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

describe("a path that only points at a record by its ID", () => {
  it("never shows on the line, even in a label that does not mark it", () => {
    for (const machineId of [true, false]) {
      const gist = gistOf(
        {
          action: "create",
          object_kind: "row",
          source: "rules",
          items: [
            {
              title: {
                pointer: "/name",
                values: [{ path: "/name", text: "Tester" }],
              },
              target: {
                pointer: "/parent@odata.bind",
                values: [
                  {
                    path: "/parent@odata.bind",
                    text: `/accounts(${UUID})`,
                    machine_id: machineId,
                  },
                ],
              },
            },
          ],
        },
        {},
      )!;
      const line = gistPlainLine(gist, gist.items[0], "ask");
      expect(line).toBe("Create row “Tester”");
      expect(line).not.toContain(`(${UUID}`);
      expect(gist.items[0].hiddenIdPaths).toEqual(["/parent@odata.bind"]);
    }
  });
});
