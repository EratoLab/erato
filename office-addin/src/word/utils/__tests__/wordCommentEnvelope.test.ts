import {
  WORD_COMMENT_ARG_MAX_BYTES,
  WORD_COMMENT_ARG_TARGET_BYTES,
  parseWordCommentEnvelope,
} from "@erato/frontend/word-review";
import { afterEach, describe, expect, it } from "vitest";

import {
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import { v3cRangeText } from "../../../test/mocks/word/commentPackages";
import {
  WORD_COMMENT_DAY_UNCERTAIN_HOURS,
  buildWordCommentEnvelope,
  buildWordCommentModel,
  wordCommentModelOf,
  wordCommentUtcTime,
} from "../wordCommentEnvelope";
import { wordCommentSelection } from "../wordCommentPositions";
import { readWordComments } from "../wordCommentReader";
import { createWordCommentRefRegistry } from "../wordCommentRefs";

import type { CommentHostFlavour } from "../../../test/mocks/word/commentHost";
import type {
  WordCommentClock,
  WordCommentEnvelopeInput,
  WordCommentModel,
  WordCommentPeople,
  WordCommentSource,
} from "../wordCommentEnvelope";
import type {
  WordCommentEntryRecord,
  WordCommentThreadRecord,
} from "../wordCommentReader";
import type {
  WordCommentEntry,
  WordCommentWhere,
} from "@erato/frontend/word-review";

const NOW = new Date("2026-10-12T08:30:45Z");
const BERLIN = "Europe/Berlin";
const PRINCIPAL = "lena.hoffmann@contoso.test";

const entry = (
  id: string,
  changes: Partial<WordCommentEntryRecord> = {},
): WordCommentEntryRecord => ({
  id,
  authorName: "Jonas Weber",
  authorEmail: "jonas.weber@contoso.test",
  creationDate: new Date("2026-10-02T09:14:00Z"),
  content: `Text ${id}`,
  ...changes,
});

function source(
  ref: string,
  pos: number,
  changes: Partial<WordCommentThreadRecord> = {},
  where: Partial<WordCommentWhere> | null = {},
): WordCommentSource {
  return {
    ref,
    pos,
    matchedByContent: false,
    record: {
      ...entry(`${pos}00`, { authorName: "Maya Krüger" }),
      authorEmail: "maya.kruger@contoso.test",
      resolved: false,
      replies: [],
      readOnly: null,
      anchor: null,
      order: pos - 1,
      ...changes,
    },
    where:
      where === null
        ? null
        : { para: pos * 2, quote: `quote ${ref}`, in: "body", ...where },
  };
}

const clock = (changes: Partial<WordCommentClock> = {}): WordCommentClock => ({
  now: NOW,
  userTz: BERLIN,
  host: "PC",
  dateUtc: { byId: new Map(), otherwise: true },
  ...changes,
});

const people: WordCommentPeople = {
  principalEmail: PRINCIPAL,
  label: "Erato AI:",
};

const model = (
  sources: readonly WordCommentSource[],
  changes: {
    clock?: Partial<WordCommentClock>;
    people?: WordCommentPeople;
  } = {},
  legacy: boolean | null = false,
) =>
  buildWordCommentModel({
    sources,
    clock: clock(changes.clock),
    people: changes.people ?? people,
    legacy,
  });

const entriesOf = (built: WordCommentModel, ref: string): WordCommentEntry[] =>
  built.threads.find((t) => t.thread.id === ref)!.thread.entries;

const envelope = (
  built: WordCommentModel,
  changes: Partial<WordCommentEnvelopeInput> = {},
) =>
  buildWordCommentEnvelope({
    scope: "selection",
    model: built,
    now: NOW,
    userTz: BERLIN,
    full: built.threads.map((t) => t.thread.id),
    ...changes,
  });

afterEach(() => uninstallWordCommentHost());

describe("times (F-4)", () => {
  it("ends at in Z to the minute on desktop when the package shows dateUtc", () => {
    const built = model([source("t2p", 1)], {
      clock: {
        dateUtc: { byId: new Map([["100", true]]), otherwise: null },
      },
    });
    expect(entriesOf(built, "t2p")[0]).toMatchObject({
      at: "2026-10-02T09:14Z",
      day: "2026-10-02",
    });
    expect(entriesOf(built, "t2p")[0]).not.toHaveProperty("tz");
  });

  it("gives desktop's host-zone clock without Z and tz unknown when there is no dateUtc", () => {
    // T5: written 08:00 in New York, read by desktop as 08:00 in the host's zone (UTC+2).
    const t5 = source("t5q", 1, {
      creationDate: new Date("2026-09-06T06:00:00Z"),
    });
    for (const dateUtc of [
      { byId: new Map([["100", false]]), otherwise: true },
      { byId: new Map<string, boolean>(), otherwise: null },
      { byId: new Map<string, boolean>(), otherwise: false },
    ]) {
      const [root] = entriesOf(model([t5], { clock: { dateUtc } }), "t5q");
      expect(root).toMatchObject({
        at: "2026-09-06T08:00",
        tz: "unknown",
        day: "2026-09-06",
      });
    }
  });

  it("keeps the web's seconds in UTC, and gives null without dateUtc", () => {
    const built = model(
      [
        source("t1a", 1, { creationDate: new Date("2026-09-03T08:15:30Z") }),
        source("t2b", 2, { creationDate: null }),
      ],
      {
        clock: {
          host: "OfficeOnline",
          dateUtc: { byId: new Map(), otherwise: null },
        },
      },
    );
    expect(entriesOf(built, "t1a")[0]).toMatchObject({
      at: "2026-09-03T08:15:30Z",
      age: 1,
    });
    const [untimed] = entriesOf(built, "t2b");
    expect(untimed).toMatchObject({ at: null, age: null, day: null });
    expect(untimed).not.toHaveProperty("tz");
    expect(built.threads[1].thread).toMatchObject({
      first_at: null,
      last_at: null,
    });
  });

  it("leaves an undated reply out of the ranks and the thread's times", () => {
    const built = model(
      [
        source("t2i", 1, {
          creationDate: new Date("2026-10-01T07:12:00Z"),
          replies: [
            entry("11", { creationDate: null }),
            entry("12", { creationDate: null }),
          ],
        }),
        source("t4c", 2, { creationDate: new Date("2026-10-02T09:00:00Z") }),
      ],
      { clock: { dateUtc: { byId: new Map(), otherwise: false } } },
    );
    const [root, ...replies] = entriesOf(built, "t2i");
    expect(root).toMatchObject({ at: "2026-10-01T09:12", age: 1 });
    for (const reply of replies) {
      expect(reply).toMatchObject({ at: null, age: null, day: null });
      expect(reply).not.toHaveProperty("tie");
      expect(reply).not.toHaveProperty("day_uncertain");
    }
    expect(built.threads[0].thread).toMatchObject({
      first_at: root.at,
      last_at: root.at,
    });
    expect(entriesOf(built, "t4c")[0].age).toBe(2);
  });

  it("ranks ages densely over every timed entry, ties at the minute on every host", () => {
    const at = (iso: string) => ({ creationDate: new Date(iso) });
    const sources = [
      source("t2p", 1, {
        ...at("2026-10-10T14:02:10Z"),
        replies: [
          entry("21", at("2026-10-10T14:02:50Z")),
          entry("22", { creationDate: null }),
        ],
      }),
      source("t4c", 2, at("2026-10-02T09:00:00Z")),
      source("t9z", 3, at("2026-10-11T07:00:00Z")),
    ];
    for (const host of ["PC", "OfficeOnline"] as const) {
      const built = model(sources, { clock: { host } });
      const [root, first, untimed] = entriesOf(built, "t2p");
      expect([root.age, first.age, untimed.age]).toEqual([2, 2, null]);
      expect(root.tie && first.tie).toBe(true);
      expect(untimed).not.toHaveProperty("tie");
      expect(entriesOf(built, "t4c")[0]).toMatchObject({ age: 1 });
      expect(entriesOf(built, "t4c")[0]).not.toHaveProperty("tie");
      expect(entriesOf(built, "t9z")[0].age).toBe(3);
    }
  });

  it("ranks the threads it does not send too", () => {
    const built = model([
      source("t1a", 1, { creationDate: new Date("2026-10-05T10:00:00Z") }),
      source(
        "t2b",
        2,
        { creationDate: new Date("2026-10-01T10:00:00Z") },
        null,
      ),
    ]);
    expect(entriesOf(built, "t1a")[0].age).toBe(2);
    expect(built.unplaced).toEqual({ open: 1, resolved: 0 });
  });

  it("marks a clock without a zone near midnight as an uncertain day, in user_tz", () => {
    const local = (iso: string) =>
      entriesOf(
        model([source("t1a", 1, { creationDate: new Date(iso) })], {
          clock: { dateUtc: { byId: new Map(), otherwise: false } },
        }),
        "t1a",
      )[0];
    expect(local("2026-10-10T21:30:00Z")).toMatchObject({
      at: "2026-10-10T23:30",
      day: "2026-10-10",
      day_uncertain: true,
    });
    expect(local("2026-10-10T23:15:00Z")).toMatchObject({
      at: "2026-10-11T01:15",
      day_uncertain: true,
    });
    expect(local("2026-10-10T12:00:00Z")).not.toHaveProperty("day_uncertain");
    const margin = WORD_COMMENT_DAY_UNCERTAIN_HOURS;
    expect(
      local(`2026-10-10T${String(22 - margin).padStart(2, "0")}:00:00Z`),
    ).toMatchObject({ day_uncertain: true });
    expect(
      local(`2026-10-10T${String(21 - margin).padStart(2, "0")}:59:00Z`),
    ).not.toHaveProperty("day_uncertain");
  });

  it("puts a UTC time on the user's calendar day, with no uncertainty", () => {
    const [root] = entriesOf(
      model([
        source("t1a", 1, { creationDate: new Date("2026-10-10T22:30:00Z") }),
      ]),
      "t1a",
    );
    expect(root).toMatchObject({ at: "2026-10-10T22:30Z", day: "2026-10-11" });
    expect(root).not.toHaveProperty("day_uncertain");
  });

  it("formats now to the minute in UTC", () => {
    expect(wordCommentUtcTime(NOW)).toBe("2026-10-12T08:30Z");
    expect(wordCommentUtcTime(NOW, true)).toBe("2026-10-12T08:30:45Z");
  });
});

describe("hints", () => {
  it("sets me from the principal's email and omits it otherwise", () => {
    const built = model([
      source("t1a", 1, {
        authorEmail: " Lena.Hoffmann@Contoso.test ",
        replies: [entry("11"), entry("12", { authorEmail: null })],
      }),
    ]);
    const [root, other, unknown] = entriesOf(built, "t1a");
    expect(root.me).toBe(true);
    expect(other).not.toHaveProperty("me");
    expect(unknown).not.toHaveProperty("me");
    const anonymous = model([source("t1a", 1, { authorEmail: null })], {
      people: { principalEmail: null },
    });
    expect(entriesOf(anonymous, "t1a")[0]).not.toHaveProperty("me");
  });

  it.each([
    ["the configured label", "Maya", "Erato AI: Vorschlag", true, true],
    ["a past label", "Maya", "  Erato: Vorschlag", true, true],
    [
      "the AI-author template",
      "Erato (AI) for Daniel Person",
      "Text",
      false,
      true,
    ],
    [
      "the German template",
      "Erato (KI) für Daniel Person",
      "Text",
      false,
      true,
    ],
    ["a bare Erato author", " erato ", "Text", false, true],
    ["a lookalike", "Eratosthenes", "Eratosthenes: Text", false, false],
    ["the label later in the text", "Maya", "See Erato AI: here", false, false],
  ])("recognises %s", (_case, author, content, label, likely) => {
    const [root] = entriesOf(
      model([source("t1a", 1, { authorName: author, content })]),
      "t1a",
    );
    expect(root.label === true).toBe(label);
    expect(root.likely_erato === true).toBe(likely);
  });

  it("recognises a configured AI-author template", () => {
    const [root] = entriesOf(
      model([source("t1a", 1, { authorName: "Assistent für Daniel Person" })], {
        people: {
          principalEmail: null,
          assistantAuthor: "Assistent für {user}",
        },
      }),
      "t1a",
    );
    expect(root.likely_erato).toBe(true);
  });

  it("marks replies by the root's author, by name and email", () => {
    const built = model([
      source("t1a", 1, {
        replies: [
          entry("11", {
            authorName: "Maya Krüger",
            authorEmail: "maya.kruger@contoso.test",
          }),
          entry("12", {
            authorName: "Maya Krüger",
            authorEmail: "other@contoso.test",
          }),
          entry("13"),
        ],
      }),
    ]);
    const [root, same, forged, other] = entriesOf(built, "t1a");
    expect(same.same_author_as_root).toBe(true);
    for (const e of [root, forged, other])
      expect(e).not.toHaveProperty("same_author_as_root");
  });

  it("orders threads by pos and keeps first_at and last_at from all entries", () => {
    const built = model([
      source("t9m", 2),
      source("t7k", 1, {
        creationDate: new Date("2026-10-03T11:02:00Z"),
        replies: [
          entry("71", { creationDate: new Date("2026-10-02T09:14:00Z") }),
        ],
      }),
    ]);
    expect(built.threads.map((t) => t.thread.id)).toEqual(["t7k", "t9m"]);
    expect(built.threads[0].thread).toMatchObject({
      first_at: "2026-10-02T09:14Z",
      last_at: "2026-10-03T11:02Z",
    });
    expect(built.threads[0].replies).toBe(1);
  });

  it("flags read-only threads, content matches and legacy files", () => {
    const sources = [
      {
        ...source("t1a", 1, { readOnly: "replies-repeated" }),
        matchedByContent: true,
      },
    ];
    const built = model(sources, {}, true);
    expect(built.threads[0].thread).toMatchObject({
      read_only: true,
      matched_by_content: true,
    });
    expect(envelope(built).envelope.legacy).toBe(true);
  });
});

describe("truncation", () => {
  it("cuts texts over 1,200 characters visibly", () => {
    const built = model([source("t1a", 1, { content: "x".repeat(1500) })]);
    const { envelope: sent } = envelope(built);
    const [root] = sent.threads[0].entries;
    expect(root.text).toHaveLength(1200);
    expect(root.text.endsWith("…")).toBe(true);
    expect(root.cut).toBe(true);
    expect(sent.coverage.cut).toEqual({ texts: 1, replies: 0 });
    expect(sent.coverage.complete).toBe(false);
  });

  it("keeps the comment and the last 8 replies and counts the rest", () => {
    const replies = Array.from({ length: 12 }, (_, i) => entry(`r${i + 1}`));
    const { envelope: sent } = envelope(model([source("t1a", 1, { replies })]));
    const [thread] = sent.threads;
    expect(thread.entries.map((e) => e.n)).toEqual([
      0, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(thread.omitted_replies).toBe(4);
    expect(sent.coverage.cut).toEqual({ texts: 0, replies: 4 });
    expect(sent.coverage.line).toContain("4 replies before the last 8");
  });

  it("drops nothing by age", () => {
    const old = source("t1a", 1, {
      creationDate: new Date("2001-01-01T00:00:00Z"),
    });
    const { envelope: sent } = envelope(model([old, source("t2b", 2)]));
    expect(sent.threads.map((t) => t.id)).toEqual(["t1a", "t2b"]);
  });
});

describe("coverage", () => {
  const sources = [
    source("t1a", 1, { resolved: true }, { vs: "before", away: 7, para: 5 }),
    source("t2b", 2, {}, { vs: "before", away: 2, para: 8, through: 10 }),
    source("t3c", 3, {}, { vs: "inside", away: 0, para: 12 }),
    source("t4d", 4, {}, { vs: "after", away: 6, para: 18 }),
    source("t5e", 5, {}, { vs: "after", away: 9, para: 21 }),
    source("t6f", 6, { resolved: true }, null),
  ];

  it("counts what was sent, listed and not shown, with the nearest commented paragraphs", () => {
    const built = model(sources);
    const input: Partial<WordCommentEnvelopeInput> = {
      full: ["t3c", "t2b"],
      essential: ["t3c"],
      selection: { para: [12, 12], caret: false },
    };
    const whole = envelope(built, input);
    const { envelope: sent } = envelope(built, {
      ...input,
      targetBytes: whole.bytes - 1,
    });
    expect(sent.threads.map((t) => t.id)).toEqual(["t3c"]);
    expect(sent.index.map((row) => row.id)).toEqual(["t2b"]);
    expect(sent.coverage).toEqual({
      threads_total: 6,
      open: 4,
      resolved: 2,
      sent_full: 1,
      sent_index_only: 1,
      not_shown: 4,
      cut: { texts: 0, replies: 0 },
      complete: false,
      line: "6 comment threads in the document (4 open, 2 resolved): 1 sent with their text, 1 listed without text, 4 not shown. 1 thread with no known paragraph. Nearest commented paragraph above the selection: 10; below: 18.",
    });
  });

  it("says complete only when every thread went out whole", () => {
    const all = sources.slice(0, 5);
    expect(envelope(model(all)).envelope.coverage.complete).toBe(true);
    expect(
      envelope(model(all), { cursor: "map:5" }).envelope.coverage.complete,
    ).toBe(false);
  });

  it("keeps names, comment text and emails out of the coverage line and the JSON", () => {
    const named = [
      source(
        "t1a",
        1,
        { content: "Bitte Zahlungsziel prüfen." },
        { vs: "before", away: 3 },
      ),
      source("t2b", 2, { content: "Quelle fehlt." }, { vs: "inside", away: 0 }),
    ];
    const { envelope: sent, json } = envelope(model(named), {
      full: ["t2b"],
      selection: { para: [4, 4], caret: false },
    });
    for (const secret of ["Maya", "Krüger", "Zahlungsziel", "Quelle", "@"])
      expect(sent.coverage.line).not.toContain(secret);
    expect(json).not.toContain("authorEmail");
    expect(json).not.toMatch(/[\w.]+@contoso\.test/);
  });

  it("names only the overlapping threads it sends", () => {
    const pair = [
      source("t1a", 1, {}, { overlaps: ["t2b", "t3c"] }),
      source("t2b", 2, {}, { overlaps: ["t1a"] }),
      source("t3c", 3, {}, { overlaps: ["t1a"] }),
    ];
    const { envelope: sent } = envelope(model(pair), { full: ["t1a", "t2b"] });
    expect(sent.threads[0].where.overlaps).toEqual(["t2b"]);
    const { envelope: alone } = envelope(model(pair), { full: ["t1a"] });
    expect(alone.threads[0].where).not.toHaveProperty("overlaps");
  });
});

describe("budgets", () => {
  const big = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      source(`t${(i + 100).toString(36)}`, i + 1, {
        content: `${"Langer Kommentartext ".repeat(55)}${i}`,
        replies: [entry(`${i}r`, { content: "Antwort ".repeat(100) })],
      }),
    );

  it("lets threads that are not essential give way to rows, then rows go, under the target", () => {
    const built = model(big(40));
    const refs = built.threads.map((t) => t.thread.id);
    const result = envelope(built, { full: refs, essential: refs.slice(0, 2) });
    const sent = result.envelope.threads.map((t) => t.id);
    expect(result.bytes).toBeLessThanOrEqual(WORD_COMMENT_ARG_TARGET_BYTES);
    expect(sent.slice(0, 2)).toEqual(refs.slice(0, 2));
    expect(sent.length).toBeLessThan(refs.length);
    expect(result.envelope.index.length).toBeGreaterThan(0);
    const { coverage } = result.envelope;
    expect(
      coverage.sent_full + coverage.sent_index_only + coverage.not_shown,
    ).toBe(40);
    expect(parseWordCommentEnvelope(result.json)).toEqual(result.envelope);
  });

  it("keeps essential threads past the target but never past the cap", () => {
    const built = model(big(60));
    const refs = built.threads.map((t) => t.thread.id);
    const some = envelope(built, {
      full: refs.slice(0, 14),
      essential: refs.slice(0, 12),
    });
    expect(some.bytes).toBeGreaterThan(WORD_COMMENT_ARG_TARGET_BYTES);
    expect(some.envelope.threads.map((t) => t.id)).toEqual(refs.slice(0, 12));
    const all = envelope(built, { full: refs, essential: refs });
    const sent = all.envelope.threads.length;
    expect(all.bytes).toBeLessThanOrEqual(WORD_COMMENT_ARG_MAX_BYTES);
    expect(sent).toBeLessThan(60);
    expect(
      all.envelope.coverage.not_shown + all.envelope.coverage.sent_index_only,
    ).toBe(60 - sent);
  });

  it("ignores refs it does not know", () => {
    const built = model([source("t1a", 1)]);
    const { envelope: sent } = envelope(built, { full: ["t1a", "tzz"] });
    expect(sent.threads.map((t) => t.id)).toEqual(["t1a"]);
    expect(sent.index).toEqual([]);
  });
});

describe("the ERMAIN-947 fixture end to end", () => {
  const HOSTS: readonly CommentHostFlavour[] = ["pc", "web"];

  async function selectionEnvelope(flavour: CommentHostFlavour) {
    const host = installWordCommentHost({ host: flavour });
    const rangeText = v3cRangeText(
      "T1P",
      flavour === "web" ? "web" : "desktop",
    );
    const start = rangeText.indexOf("alpha bravo");
    const ordinal = host.ordinalOf("T1P");
    const coordinates = {
      first: ordinal,
      last: ordinal,
      start,
      end: start + 11,
    };
    const result = await readWordComments({
      now: host.now,
      exact: () => [host.commentId("T1"), host.commentId("T5")],
    });
    if (!result.ok) throw new Error(result.error);
    const { refs, model: built } = wordCommentModelOf(result, {
      registry: createWordCommentRefRegistry("doc"),
      selection: coordinates,
      people: {
        principalEmail: "maya.kruger@contoso.test",
        label: "Erato AI:",
      },
      now: NOW,
      userTz: BERLIN,
    });
    const refOf = (key: string) =>
      refs.threads.find((t) => t.commentId === host.commentId(key))!.ref;
    const selected = built.threads
      .filter((t) => t.thread.where.vs === "inside")
      .map((t) => t.thread.id);
    return {
      refOf,
      built,
      ...buildWordCommentEnvelope({
        scope: "selection",
        model: built,
        now: NOW,
        userTz: BERLIN,
        full: selected,
        essential: selected,
        selection: wordCommentSelection(coordinates),
      }),
    };
  }

  it.each(HOSTS)(
    "sends the selection's thread and a text-free coverage line on %s",
    async (h) => {
      const { envelope: sent, json, refOf } = await selectionEnvelope(h);
      expect(sent.threads.map((t) => t.id)).toEqual([refOf("T1")]);
      const [t1] = sent.threads;
      expect(t1.where).toMatchObject({
        quote: "alpha bravo",
        vs: "inside",
        away: 0,
      });
      expect(t1.entries.map((e) => [e.n, e.by, e.me === true])).toEqual([
        [0, "Maya Krüger", true],
        [1, "Jonas Weber", false],
        [2, "Maya Krüger", true],
      ]);
      expect(t1.entries[2].same_author_as_root).toBe(true);
      expect(t1.entries.map((e) => e.at)).toEqual(
        h === "web"
          ? [
              "2026-09-03T08:15:30Z",
              "2026-09-03T09:20:11Z",
              "2026-09-04T07:00:45Z",
            ]
          : ["2026-09-03T08:15Z", "2026-09-03T09:20Z", "2026-09-04T07:00Z"],
      );
      expect(sent.coverage).toMatchObject({
        threads_total: 14,
        sent_full: 1,
        not_shown: 13,
      });
      expect(sent.coverage.line).toContain(
        "Nearest commented paragraph above the selection: none; below: 3.",
      );
      expect(json).not.toContain("authorEmail");
      expect(json).not.toContain("@contoso.test");
      expect(json).not.toContain("\u0005");
      expect(parseWordCommentEnvelope(json)).toEqual(sent);
    },
  );

  it("leaves the replies of a file without dateUtc untimed on pc, where Word dates them 1899", async () => {
    const host = installWordCommentHost({ host: "pc", legacy: true });
    const result = await readWordComments({ now: host.now });
    if (!result.ok) throw new Error(result.error);
    const { refs, model: built } = wordCommentModelOf(result, {
      registry: createWordCommentRefRegistry("doc"),
      selection: null,
      people,
      now: NOW,
      userTz: BERLIN,
    });
    const ref = refs.threads.find(
      (t) => t.commentId === host.commentId("T1"),
    )!.ref;
    const { thread } = built.threads.find((t) => t.thread.id === ref)!;
    const [root, ...replies] = thread.entries;
    expect(root).toMatchObject({ at: "2026-09-03T10:15", tz: "unknown" });
    expect(replies.map((e) => [e.at, e.age, e.day])).toEqual([
      [null, null, null],
      [null, null, null],
    ]);
    expect([thread.first_at, thread.last_at]).toEqual([root.at, root.at]);
  });

  it.each(HOSTS)(
    "times T5, which has no dateUtc, honestly on %s",
    async (h) => {
      const { built, refOf } = await selectionEnvelope(h);
      const [t5] = built.threads.find((t) => t.thread.id === refOf("T5"))!
        .thread.entries;
      expect(t5).toMatchObject(
        h === "web"
          ? { at: null, age: null, day: null }
          : { at: "2026-09-06T08:00", tz: "unknown", day: "2026-09-06" },
      );
    },
  );
});
