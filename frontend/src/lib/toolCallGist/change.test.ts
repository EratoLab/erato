import { i18n } from "@lingui/core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { messages as deMessages } from "@/locales/de/messages.json";
import { messages as enMessages } from "@/locales/en/messages.json";
import { messages as esMessages } from "@/locales/es/messages.json";
import { messages as frMessages } from "@/locales/fr/messages.json";
import { messages as plMessages } from "@/locales/pl/messages.json";

import { cardSourceOf } from "./cardLayout";
import {
  MAX_COLLAPSED_NAMES,
  MAX_FIRST_VIEW_VALUES,
  changeLayout,
  changeSaysSomething,
  collapsedNames,
  hidesMachineId,
  readChange,
} from "./change";
import {
  batchFieldLine,
  batchLossLines,
  batchOperationsLine,
  changeRowCounts,
  changeSeeMoreLine,
  changeSummaryLine,
  newNamePhrase,
} from "./changeLabels";
import { gistOf, gistShownPaths, unshownArguments } from "./gist";
import {
  gistLineSentence,
  gistPlainLine,
  gistUnreadRecordLine,
  showsUnreadRecord,
} from "./gistLabels";

import type { ChangeBatch, GistChange } from "./change";
import type { GistAction } from "./gist";
import type {
  ToolArgumentNode,
  ToolCallEffect,
  ToolCallLabel,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const effect = (
  name: string,
  kind: ToolCallEffect["effect"],
  extra: Partial<ToolCallEffect> = {},
): ToolCallEffect => ({
  path: `/${name}`,
  name,
  raw_name: `raw_${name}`,
  effect: kind,
  ...extra,
});

const change = (effects: ToolCallEffect[], extra: object = {}): GistChange => {
  const counts = {
    emptied: 0,
    list_replaced: 0,
    list_removed: 0,
    list_added: 0,
    changed: 0,
    set: 0,
    unchanged: 0,
    unreadable: 0,
  };
  for (const { effect: kind } of effects) counts[kind] += 1;
  const read = readChange({ effects, counts, complete: true, ...extra });
  if (!read) throw new Error("no change");
  return read;
};

const labelled = (overrides: Partial<ToolCallLabel>): ToolCallLabel => ({
  action: "update",
  object_kind: "row",
  source: "rules",
  ...overrides,
});

describe("reading a change description", () => {
  it("is absent for anything that is not one", () => {
    for (const raw of [undefined, null, "x", 3, []]) {
      expect(readChange(raw)).toBeUndefined();
    }
  });

  it("reads wrong types as absent and an unknown kind as unreadable", () => {
    const read = readChange({
      effects: [
        { path: "/a", name: "A", raw_name: "a", effect: "teleport" },
        { name: "no path" },
        "junk",
      ],
      notes: ["nothing_changes", "from_the_future"],
      flags: "nope",
      counts: { set: "many", changed: 2 },
    });
    expect(read?.effects).toHaveLength(1);
    expect(read?.effects[0].effect).toBe("unreadable");
    expect(read?.notes).toEqual(["nothing_changes"]);
    expect(read?.flags).toEqual([]);
    expect(read?.counts.changed).toBe(2);
    expect(read?.counts.set).toBe(0);
    expect(read?.complete).toBe(false);
  });

  it("cleans text again and remembers hidden characters", () => {
    const read = readChange({
      effects: [effect("a​b", "set", { values: [{ text: "x‮y" }] })],
    });
    expect(read?.effects[0].name).toBe("ab");
    expect(read?.effects[0].values[0].text).toBe("xy");
    expect(read?.hiddenCharacters).toBe(true);
  });
});

describe("what goes in the first view", () => {
  it("ranks by what happens to the value, never by name, up to five, and leaves unchanged values behind See more", () => {
    const layout = changeLayout(
      change([
        effect("s1", "set"),
        effect("s2", "set"),
        effect("c1", "changed"),
        effect("e1", "emptied"),
        effect("u1", "unchanged"),
        effect("c2", "changed"),
        effect("l1", "list_replaced"),
        effect("s3", "set"),
        effect("s4", "set"),
        effect("s5", "set"),
        effect("s6", "set"),
        effect("r1", "unreadable"),
      ]),
    );
    expect(layout.emptied.map((row) => row.name)).toEqual(["e1"]);
    expect(layout.lists.map((row) => row.name)).toEqual(["l1"]);
    expect(layout.unreadable.map((row) => row.name)).toEqual(["r1"]);
    expect(layout.firstRows.map((row) => row.name)).toEqual([
      "c1",
      "c2",
      "s1",
      "s2",
      "s3",
    ]);
    expect(layout.firstRows).toHaveLength(MAX_FIRST_VIEW_VALUES);
    expect(layout.collapsed.map((row) => row.name)).toEqual([
      "s4",
      "s5",
      "s6",
      "u1",
    ]);
    expect(layout.opensByDefault).toBe(false);
  });

  it("shows up to seven values where See more would hide only one or two", () => {
    const sevenSet = change(
      Array.from({ length: 7 }, (_, index) => effect(`s${index}`, "set")),
    );
    expect(changeLayout(sevenSet).firstRows).toHaveLength(7);
    expect(changeLayout(sevenSet).collapsed).toHaveLength(0);
    const eightSet = change(
      Array.from({ length: 8 }, (_, index) => effect(`s${index}`, "set")),
    );
    expect(changeLayout(eightSet).firstRows).toHaveLength(
      MAX_FIRST_VIEW_VALUES,
    );
    const oneUnchanged = changeLayout(
      change([effect("s1", "set"), effect("u1", "unchanged")]),
    );
    expect(oneUnchanged.firstRows.map((row) => row.name)).toEqual(["s1"]);
    expect(oneUnchanged.collapsed.map((row) => row.name)).toEqual(["u1"]);
  });

  it("puts links and coded values first within what a value does", () => {
    const layout = changeLayout(
      change([
        effect("plain", "set"),
        effect("coded", "set", {
          values: [
            { text: "8", meaning: { label: "Prospect", source: "tool" } },
          ],
        }),
        effect("link", "set", { link: true }),
      ]),
    );
    expect(layout.firstRows.map((row) => row.name)).toEqual([
      "link",
      "coded",
      "plain",
    ]);
  });

  it("keeps every loss in the first view, however many", () => {
    const losses = Array.from({ length: 30 }, (_, index) =>
      effect(`e${index}`, "emptied"),
    );
    const layout = changeLayout(change(losses));
    expect(layout.emptied).toHaveLength(30);
    expect(layout.collapsed).toHaveLength(0);
  });

  it("counts values past the cap and opens when not everything was read", () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      effect(`s${index}`, "set"),
    );
    const read = change(rows, { complete: false });
    read.counts.set = 40;
    const layout = changeLayout(read);
    expect(layout.beyondCap).toBe(32);
    expect(layout.opensByDefault).toBe(true);
    expect(changeSeeMoreLine(read, layout)).toBe("See 35 more fields: 35 set");
  });

  it("calls values past the stored cap what they are, never unreadable", () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      effect(`s${index}`, "set"),
    );
    const read = change(rows);
    read.counts.set = 40;
    expect(changeSeeMoreLine(read, changeLayout(read))).toBe(
      "See 35 more fields, all set with the old value unknown (none is emptied)",
    );
  });

  it("says how many more names there are when not all are listed", () => {
    const names = Array.from({ length: 12 }, (_, index) => `f${index}`);
    expect(collapsedNames(names)).toEqual({
      shown: names.slice(0, MAX_COLLAPSED_NAMES),
      more: 12 - MAX_COLLAPSED_NAMES,
    });
    expect(collapsedNames(["a"]).more).toBe(0);
  });
});

describe("the words of a change", () => {
  it("states a guarantee only over what code put in the collapsed part", () => {
    const seeMoreOf = (read: GistChange) =>
      changeSeeMoreLine(read, {
        ...changeLayout(read),
        firstRows: [],
        collapsed: read.effects,
        beyondCap: 0,
      });
    const set = [effect("a", "set"), effect("b", "set")];
    expect(seeMoreOf(change(set))).toBe(
      "See 2 more fields, all set with the old value unknown (none is emptied)",
    );
    const unchanged = [effect("a", "unchanged"), effect("b", "unchanged")];
    expect(seeMoreOf(change(unchanged))).toBe("See 2 unchanged fields");
    const mixed = [
      effect("a", "changed"),
      effect("b", "set"),
      effect("c", "unchanged"),
    ];
    expect(seeMoreOf(change(mixed))).toBe(
      "See 3 more fields: 1 changed, 1 set, 1 unchanged (none is emptied)",
    );
    // Not everything was read, so "none is emptied" cannot be said.
    expect(seeMoreOf(change(set, { complete: false }))).toBe(
      "See 2 more fields: 2 set",
    );
    const lossPastTheStoredCap = change(set);
    lossPastTheStoredCap.counts.emptied = 3;
    expect(
      changeSeeMoreLine(lossPastTheStoredCap, {
        ...changeLayout(lossPastTheStoredCap),
        firstRows: [],
        collapsed: lossPastTheStoredCap.effects,
        beyondCap: 3,
      }),
    ).toBe("See 5 more fields: 3 emptied or replaced, 2 set");
  });

  it("counts only what the rows do not show, and never on a create", () => {
    const summary = (read: GistChange, action?: GistAction) =>
      changeSummaryLine(read, changeLayout(read), action);
    expect(summary(change([effect("a", "set")]))).toBeUndefined();
    // Every change is a row below: a count would repeat them.
    expect(
      summary(
        change([
          effect("a", "emptied"),
          effect("b", "changed"),
          effect("c", "set"),
        ]),
      ),
    ).toBeUndefined();
    const hiddenEffects = [
      effect("a", "emptied"),
      ...Array.from({ length: 9 }, (_, index) => effect(`s${index}`, "set")),
    ];
    const hidden = change(hiddenEffects);
    expect(summary(hidden)).toBe("10 fields change: 1 emptied, 9 set");
    expect(summary(hidden, "create")).toBeUndefined();
    // See more counts the fields that stay the same; the head never repeats it.
    const resent = change([
      effect("a", "changed"),
      effect("b", "unchanged"),
      effect("c", "unchanged"),
    ]);
    expect(summary(resent)).toBeUndefined();
    expect(changeSeeMoreLine(resent, changeLayout(resent))).toBe(
      "See 2 unchanged fields",
    );
    expect(
      summary(
        change([
          ...hiddenEffects,
          effect("u1", "unchanged"),
          effect("u2", "unchanged"),
        ]),
      ),
    ).toBe("10 fields change: 1 emptied, 9 set");
    expect(changeRowCounts(change([effect("a", "changed")]))).toBe("1 changed");
  });

  it("says what each field does across a batch and whether any row loses something", () => {
    const batch: ChangeBatch = {
      name: "Records",
      total: 200,
      sameChange: false,
      shared: [],
      rows: [],
      deletions: 0,
      rowsEmptying: 0,
      rowsReplacingLists: 0,
      rowsRemovingFromLists: 0,
      operations: [],
      fields: [],
      fieldsOmitted: 0,
      readAll: true,
    };
    const field = {
      name: "Stage",
      rawName: "stage",
      rows: 200,
      emptied: 0,
      listsReplaced: 0,
      listsRemoved: 0,
      listsAdded: 0,
      distinct: 1,
      distinctCapped: false,
      samples: [{ text: "Closed", truncated: false, machineId: false }],
    };
    expect(batchFieldLine(field, 200)).toBe("Set to Closed on all 200 rows");
    expect(batchFieldLine({ ...field, rows: 3 }, 200)).toBe(
      "Set to Closed on 3 of 200 rows",
    );
    expect(batchFieldLine({ ...field, distinct: 2 }, 200)).toBe(
      "2 different values on all 200 rows: Closed",
    );
    expect(batchFieldLine({ ...field, emptied: 200, samples: [] }, 200)).toBe(
      "Emptied on all 200 rows",
    );
    // Only the rows that write a value count as written.
    expect(batchFieldLine({ ...field, emptied: 7 }, 200)).toBe(
      "Set to Closed on 193 of 200 rows · emptied on 7 rows",
    );
    expect(batchFieldLine({ ...field, samples: [] }, 200)).toBe(
      "Set on all 200 rows",
    );
    expect(
      batchFieldLine({ ...field, rows: 5, listsReplaced: 5, samples: [] }, 5),
    ).toBe("list replaced on 5 rows");
    // Items the tool says a row removes or adds are no list replaced, and
    // the line says whose word that is.
    expect(
      batchFieldLine({ ...field, rows: 2, listsRemoved: 2, distinct: 1 }, 2),
    ).toBe("Closed removed on all 2 rows, the tool says");
    expect(
      batchFieldLine({ ...field, rows: 3, listsAdded: 2, distinct: 1 }, 3),
    ).toBe(
      "Set to Closed on 1 of 3 rows · items added on 2 rows, the tool says",
    );
    // Rows that remove different values never all read as removing each.
    const differing = {
      ...field,
      rows: 2,
      listsRemoved: 2,
      distinct: 2,
      samples: [
        { text: "Bug", truncated: false, machineId: false },
        { text: "Urgent", truncated: false, machineId: false },
      ],
    };
    expect(batchFieldLine(differing, 2)).toBe(
      "items removed on 2 rows, the tool says",
    );
    expect(
      batchFieldLine({ ...differing, distinct: 1, distinctCapped: true }, 2),
    ).toBe("items removed on 2 rows, the tool says");
    expect(
      batchOperationsLine({
        ...batch,
        total: 9,
        operations: [
          { action: "move", count: 2 },
          { action: "send", count: 1 },
          { action: "comment", count: 1 },
          { action: "share", count: 1 },
          { action: "run", count: 1 },
          { action: "upsert", count: 1 },
          { action: "archive", count: 1 },
          { action: "upload", count: 1 },
        ],
      }),
    ).toBe(
      "9 operations in one call: 2 move, 1 send, 1 comment, 1 share, 1 run, 1 create or update, 1 archive, 1 upload",
    );

    expect(batchLossLines(batch)).toEqual([
      "No row deletes or empties anything.",
    ]);
    expect(batchLossLines({ ...batch, readAll: false })).toEqual([]);
    expect(batchLossLines(batch, false, true)).toEqual([]);
    expect(batchLossLines({ ...batch, deletions: 2 })).toEqual([]);
    expect(
      batchLossLines({ ...batch, rowsEmptying: 3, rowsReplacingLists: 1 }),
    ).toEqual(["3 rows empty a field", "1 row replaces a list"]);
    expect(batchLossLines({ ...batch, rowsRemovingFromLists: 2 })).toEqual([
      "2 rows remove items from a list, the tool says",
    ]);
  });
});

describe("machine identifiers on the line", () => {
  const id = "aaaaaaaa-0000-4000-8000-0000000000a1";
  const slot = (
    pointer: string,
    value: { text: string; resolved?: string; machine_id?: boolean },
  ) => ({
    pointer,
    values: [{ path: pointer, ...value }],
  });

  it("never shows a machine id and says the thing without it", () => {
    const gist = gistOf(
      labelled({
        items: [
          {
            id: slot("/recordId", { text: id, machine_id: true }),
            target: slot("/table", { text: "opportunity" }),
          },
        ],
      }),
      {},
    );
    const item = gist?.items[0];
    expect(item?.names).toEqual([]);
    expect(item?.count).toBe(1);
    expect(gistPlainLine(gist!, item!, "ask")).toBe(
      "Update row in “opportunity”",
    );
    expect(gistLineSentence(gist!, item!, "ask")).not.toContain(id);
  });

  it("shows a known name alone and counts a batch of machine ids", () => {
    const named = gistOf(
      labelled({
        items: [
          {
            id: slot("/recordId", {
              text: id,
              resolved: "Contoso",
              machine_id: true,
            }),
          },
        ],
      }),
      {},
    );
    expect(named?.items[0].names[0]).toMatchObject({
      text: "Contoso",
      origin: "resolved",
    });
    expect(named?.items[0].names[0].written).toBeUndefined();

    const batch = gistOf(
      labelled({
        items: [
          {
            id: {
              pointer: "/ids/*",
              values: [
                { path: "/ids/0", text: id, machine_id: true },
                { path: "/ids/1", text: id, machine_id: true },
              ],
              omitted: 1,
            },
          },
        ],
      }),
      {},
    );
    expect(batch?.items[0].count).toBe(3);
    expect(gistPlainLine(batch!, batch!.items[0], "ask")).toBe("Update 3 rows");
  });

  it("keeps a written value beside a human-readable name", () => {
    const gist = gistOf(
      labelled({
        items: [{ id: slot("/ticket", { text: "ABC-123", resolved: "Bug" }) }],
      }),
      {},
    );
    expect(gist?.items[0].names[0].written).toBe("ABC-123");
  });

  it("counts a hidden machine id as shown, never as an other argument", () => {
    const gist = gistOf(
      labelled({
        items: [
          {
            id: slot("/recordId", { text: id, machine_id: true }),
            target: slot("/table", { text: "x" }),
          },
        ],
      }),
      {},
    );
    expect(gistShownPaths(gist!).get("/recordId")).toBe(true);
    const view: ToolArgumentNode = {
      path: "",
      kind: "group",
      children: [
        { path: "/recordId", kind: "machine_id" },
        { path: "/ownerid", kind: "machine_id" },
        { path: "/note", kind: "value" },
      ],
    };
    const rest = unshownArguments(view, gist!);
    expect(rest.view?.children?.map((node) => node.path)).toEqual(["/note"]);
  });
});

describe("the place on the line", () => {
  it("uses the place the change names when the call has no target", () => {
    const gist = gistOf(
      labelled({
        items: [
          {
            id: {
              pointer: "/id",
              values: [{ path: "/id", text: "r1" }],
            },
          },
        ],
        change: {
          place: "contoso / uploader",
          counts: {},
          complete: true,
        },
      }),
      {},
    );
    expect(gistPlainLine(gist!, gist!.items[0], "ask")).toBe(
      "Update row r1 in contoso / uploader",
    );
  });

  it("keeps a resolved target and shows the place beside it", () => {
    const gist = gistOf(
      labelled({
        items: [
          {
            id: {
              pointer: "/id",
              values: [{ path: "/id", text: "r1" }],
            },
            target: {
              pointer: "/parent",
              values: [
                { path: "/parent", text: "p1", resolved: "Q4 pipeline" },
              ],
            },
          },
        ],
        change: { place: "contoso / uploader", counts: {}, complete: true },
      }),
      {},
    );
    const where = gist!.items[0].where.map((value) => value.text);
    expect(where).toEqual(["Q4 pipeline", "contoso / uploader"]);
  });

  it("names in the source line every distinct place, even two with one name", () => {
    const gist = gistOf(
      labelled({
        items: [
          {
            id: {
              pointer: "/id",
              values: [{ path: "/id", text: "r1" }],
            },
            target: {
              pointer: "/folders/*",
              values: [
                { path: "/folders/0", text: "f_1", resolved: "Reports" },
                { path: "/folders/1", text: "f_2", resolved: "Reports" },
              ],
            },
          },
        ],
        change: { counts: {}, complete: true },
      }),
      {},
    )!;
    expect(
      cardSourceOf(gist)?.where.map((value) => [value.text, value.written]),
    ).toEqual([
      ["Reports", "f_1"],
      ["Reports", "f_2"],
    ]);

    const named = gistOf(
      labelled({
        items: [
          {
            id: {
              pointer: "/id",
              values: [{ path: "/id", text: "r1" }],
            },
            target: {
              pointer: "/project",
              values: [{ path: "/project", text: "p1", resolved: "prj1" }],
            },
          },
        ],
        change: { place: "prj1", counts: {}, complete: true },
      }),
      {},
    )!;
    expect(named.items[0].where.map((value) => value.text)).toEqual([
      "prj1",
      "prj1",
    ]);
    expect(
      cardSourceOf(named)?.where.map((value) => [value.text, value.origin]),
    ).toEqual([["prj1", "resolved"]]);
  });

  it("lets the place stand for a written target it already repeats", () => {
    const gist = gistOf(
      labelled({
        items: [
          {
            id: {
              pointer: "/id",
              values: [{ path: "/id", text: "r1" }],
            },
            target: {
              pointer: "/repo",
              values: [{ path: "/repo", text: "uploader" }],
            },
          },
        ],
        change: { place: "contoso / uploader", counts: {}, complete: true },
      }),
      {},
    );
    expect(gist!.items[0].where.map((value) => value.text)).toEqual([
      "contoso / uploader",
    ]);
  });

  it("reads a sentence for what a run runs", () => {
    const gist = gistOf(
      labelled({
        action: "run",
        object_kind: "other",
        change: {
          opaque: [
            {
              kind: "sql",
              name: "Query",
              raw_name: "query",
              path: "/query",
              text: "select 1",
              lines: 1,
            },
          ],
          counts: {},
          complete: true,
        } as unknown as ToolCallLabel["change"],
      }),
      {},
    );
    expect(gistLineSentence(gist!, gist!.items[0], "ask")).toBe("Run this SQL");
    expect(gistLineSentence(gist!, gist!.items[0], "done")).toBe(
      "Ran this SQL",
    );
  });

  it("tells a change that says something from one that says nothing", () => {
    expect(changeSaysSomething(change([]))).toBe(false);
    expect(changeSaysSomething(change([effect("a", "set")]))).toBe(true);
    expect(
      hidesMachineId({ text: "", truncated: false, machineId: true }),
    ).toBe(true);
    expect(
      hidesMachineId({ text: "Contoso", truncated: false, machineId: true }),
    ).toBe(false);
  });
});

const UUID = "9b1d5f2e-3c4a-4f88-a1b2-0c1d2e3f4a5b";

/** An update or delete of one row named only by a machine ID. */
const byHiddenId = (
  extra: object,
  overrides: Partial<ToolCallLabel> = {},
): ToolCallLabel =>
  labelled({
    items: [
      {
        id: {
          pointer: "/recordId",
          values: [{ path: "/recordId", text: UUID, machine_id: true }],
        },
      },
    ],
    change: { counts: {}, complete: true, ...extra },
    ...overrides,
  });

describe("the table a record is one of", () => {
  afterEach(() => {
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("qualifies the kind and never reads as where the record lives", () => {
    const gist = gistOf(byHiddenId({ table: "account" }), {})!;
    expect(gist.change?.table).toBe("account");
    expect(gist.items[0].where).toEqual([]);
    expect(gistPlainLine(gist, gist.items[0], "ask")).toBe("Update record");
    const created = gistOf(
      labelled({
        action: "create",
        items: [
          {
            title: {
              pointer: "/item/name",
              values: [{ path: "/item/name", text: "Example Ltd" }],
            },
          },
        ],
        change: { table: "account", counts: {}, complete: true },
      }),
      {},
    )!;
    expect(gistPlainLine(created, created.items[0], "ask")).toBe(
      "Create record “Example Ltd”",
    );
    const batch = gistOf(
      labelled({
        action: "delete",
        items: [
          {
            id: {
              pointer: "/ids/*",
              values: ["a1", "a2", "a3"].map((text, index) => ({
                path: `/ids/${index}`,
                text,
              })),
            },
          },
        ],
        change: { table: "account", counts: {}, complete: true },
      }),
      {},
    )!;
    expect(gistPlainLine(batch, batch.items[0], "ask")).toBe(
      "Delete 3 records",
    );
    expect(cardSourceOf(created)).toEqual({
      where: [],
      whereOmitted: 0,
      table: "account",
    });
    i18n.load("de", deMessages as unknown as Messages);
    i18n.activate("de");
    expect(gistPlainLine(created, created.items[0], "ask")).toBe(
      "Datensatz “Example Ltd” erstellen",
    );
    expect(gistPlainLine(batch, batch.items[0], "ask")).toBe(
      "3 Datensätze löschen",
    );
  });
});

describe("a record no result in the chat named", () => {
  afterEach(() => {
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("says which record is unknown here and where its ID is, only when the backend says so", () => {
    const gist = gistOf(
      byHiddenId({ table: "account", record_unread: true }),
      {},
    )!;
    expect(showsUnreadRecord(gist, gist.items[0])).toBe(true);
    expect(gistUnreadRecordLine(gist)).toBe(
      "Which record: not read in this chat (its ID is in Technical details)",
    );
    i18n.load("de", deMessages as unknown as Messages);
    i18n.activate("de");
    expect(gistUnreadRecordLine(gist)).toBe(
      "Welcher Datensatz: in diesem Chat nicht gelesen (ID unter „Technische Details“)",
    );
    const page = gistOf(
      byHiddenId({ record_unread: true }, { object_kind: "document" }),
      {},
    )!;
    expect(gistUnreadRecordLine(page)).toBe(
      "Welches Dokument: in diesem Chat nicht gelesen (ID unter „Technische Details“)",
    );
    i18n.load("fr", frMessages as unknown as Messages);
    i18n.activate("fr");
    expect(gistUnreadRecordLine(gist)).toBe(
      "Quel enregistrement : non lu dans ce chat (son identifiant est dans Détails techniques)",
    );
    i18n.load("es", esMessages as unknown as Messages);
    i18n.activate("es");
    expect(gistUnreadRecordLine(gist)).toBe(
      "¿Qué registro? No se leyó en este chat (su identificador está en «Detalles técnicos»)",
    );
    i18n.load("pl", plMessages as unknown as Messages);
    i18n.activate("pl");
    expect(newNamePhrase()).toBe("ustawiono na");
  });

  it("says nothing when a name is known or the backend does not say so", () => {
    const read = gistOf(byHiddenId({ table: "account" }), {})!;
    expect(showsUnreadRecord(read, read.items[0])).toBe(false);
    const named = gistOf(
      labelled({
        items: [
          {
            id: {
              pointer: "/recordId",
              values: [
                {
                  path: "/recordId",
                  text: UUID,
                  machine_id: true,
                  resolved: "Example Ltd",
                },
              ],
            },
          },
        ],
        change: { record_unread: true, counts: {}, complete: true },
      }),
      {},
    )!;
    expect(showsUnreadRecord(named, named.items[0])).toBe(false);
  });

  it("reads a name the call gives such a record as a new value", () => {
    const read = change([effect("name", "set", { new_name: true })], {
      record_unread: true,
    });
    expect(read.recordUnread).toBe(true);
    expect(read.effects[0].newName).toBe(true);
    expect(change([effect("name", "set")]).effects[0].newName).toBe(false);
  });
});
