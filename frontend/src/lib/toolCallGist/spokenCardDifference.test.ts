import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";

import { messages as deMessages } from "@/locales/de/messages.json";

import data from "./fixtures/spokenCards/calls.json";
import { spokenApprovalFor, spokenApprovalPieces } from "./spokenCard";
import { spokenDifference } from "./spokenCardDifference";
import { spokenCardFlow, spokenCardStep } from "./spokenCardFlow";

import type { SpokenApproval, SpokenPiece } from "./spokenCard";
import type { WithdrawnCard } from "./spokenCardDifference";
import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

/**
 * Layer 1 of design section 9 for change requests: the corrected card as the
 * voice says it, for each kind of card, each kind of difference, asked for
 * or not.
 */

interface LabelValue {
  path?: string;
  text: string;
  resolved?: string;
  machine_id?: boolean;
}
interface Label {
  object_kind: string;
  items: {
    id?: { values: LabelValue[] };
    title?: { values: LabelValue[] };
    after?: { values: LabelValue[] };
    fields?: { name: string; values?: LabelValue[] }[];
  }[];
  change: {
    effects?: { raw_name: string; values?: LabelValue[] }[];
    texts?: { raw_name: string; text: string }[];
    notes?: string[];
  };
}
interface SetCall {
  id: string;
  tool_name: string;
  input: Record<string, unknown>;
  display: { title: string; server_name?: string | null; label: Label };
}

const { calls } = data as unknown as { calls: SetCall[] };
const OPTIONS = {
  now: new Date("2026-11-17T09:00:00Z"),
  timeZone: "Europe/Berlin",
};

const callOf = (id: string): SetCall => {
  const call = calls.find((entry) => entry.id === id);
  if (!call) throw new Error(`no call ${id}`);
  return JSON.parse(JSON.stringify(call)) as SetCall;
};

const approvalOf = (call: SetCall): SpokenApproval =>
  spokenApprovalFor("mcp_tool", {
    ...call,
    display: {
      ...call.display,
      label: call.display.label as unknown as ToolCallLabel,
    },
  });

const inLanguage = <T>(language: string, compose: () => T): T => {
  const previous = i18n.locale;
  i18n.activate(language);
  try {
    return compose();
  } finally {
    i18n.activate(previous);
  }
};

const piecesOf = (call: SetCall, language = "en") =>
  inLanguage(language, () =>
    spokenApprovalPieces(approvalOf(call), { language, ...OPTIONS }),
  );

const withdrawn = (
  call: SetCall,
  words: string,
  heard: readonly string[] = piecesOf(call).map((piece) => piece.id),
): WithdrawnCard => ({ approval: approvalOf(call), heard, words });

const difference = (previous: WithdrawnCard, next: SetCall, language = "en") =>
  inLanguage(language, () =>
    spokenDifference(previous, approvalOf(next), { language, ...OPTIONS }),
  );

const textsOf = (pieces: readonly SpokenPiece[]) =>
  pieces.map((piece) => piece.text);

// What a model changes, written into the label as the backend would.

/** A field the call writes, set to `text` in the input and the label. */
const setField =
  (field: string, text: string) =>
  (call: SetCall): void => {
    const { label } = call.display;
    // A label without a change description has none.
    const change = label.change as Label["change"] | undefined;
    for (const effect of change?.effects ?? [])
      if (effect.raw_name === field) effect.values = [{ text }];
    for (const item of label.items)
      for (const entry of item.fields ?? [])
        if (entry.name === field)
          entry.values = entry.values?.map((value) => ({ ...value, text }));
    const item = call.input.item as Record<string, unknown> | undefined;
    if (item && field in item) item[field] = text;
  };

/** A long text the call writes, with a sentence added. */
const addToText =
  (field: string, sentence: string) =>
  (call: SetCall): void => {
    const { label } = call.display;
    for (const text of label.change.texts ?? [])
      if (text.raw_name === field) text.text = `${text.text} ${sentence}`;
    for (const item of label.items)
      for (const value of item.after?.values ?? [])
        value.text = `${value.text} ${sentence}`;
    const holder = (call.input.item ?? call.input) as Record<string, string>;
    holder[field] = `${holder[field]} ${sentence}`;
  };

const setTitle =
  (text: string) =>
  (call: SetCall): void => {
    for (const item of call.display.label.items)
      for (const value of item.title?.values ?? []) value.text = text;
    const holder = (call.input.item ?? call.input) as Record<string, string>;
    if ("subject" in holder) holder.subject = text;
  };

/** Another record: the item the call acts on. */
const otherRecord =
  (name: string) =>
  (call: SetCall): void => {
    for (const item of call.display.label.items)
      for (const value of item.id?.values ?? []) {
        value.text = "5f0c2a10-0000-4000-8000-00000000ffff";
        value.resolved = name;
      }
    call.input.recordId = "5f0c2a10-0000-4000-8000-00000000ffff";
  };

const otherKind =
  (kind: string) =>
  (call: SetCall): void => {
    call.display.label.object_kind = kind;
  };

const otherServer =
  (server: string) =>
  (call: SetCall): void => {
    call.display.server_name = server;
  };

const withNotes =
  (...notes: string[]) =>
  (call: SetCall): void => {
    call.display.label.change.notes = notes;
  };

interface Change {
  apply: (call: SetCall) => void;
  /** What a user says to ask for it. */
  mention: string;
  /** What the tool says about it, which no words of the user ask for. */
  unaskable?: true;
}

type What = "one field" | "several" | "the item" | "a long text" | "nothing";
type Kind = "create" | "update" | "delete" | "send";

/** Each kind's base call and how each kind of difference is made on it. */
const KINDS: Record<
  Kind,
  { base: string; item: string; changes: Partial<Record<What, Change[]>> }
> = {
  create: {
    base: "create-01-task-long-description",
    item: "Technisches Layout abstimmen",
    changes: {
      "one field": [
        {
          apply: setField("scheduledend", "2030-01-22"),
          mention: "nimm den 22.",
        },
      ],
      several: [
        {
          apply: setField("scheduledend", "2030-01-22"),
          mention: "nimm den 22.",
        },
        { apply: setField("prioritycode", "3"), mention: "Priorität 3" },
      ],
      "the item": [{ apply: otherKind("event"), mention: "als Termin" }],
      "a long text": [
        {
          apply: addToText("description", "Das Angebot gilt bis Freitag."),
          mention: "schreib dazu, dass es bis Freitag gilt",
        },
      ],
      nothing: [],
    },
  },
  update: {
    base: "update-01-date-and-probability",
    item: "Line 4 Retrofit",
    changes: {
      "one field": [
        {
          apply: setField("closeprobability", "75"),
          mention: "nimm 75 Prozent",
        },
      ],
      several: [
        {
          apply: setField("closeprobability", "75"),
          mention: "nimm 75 Prozent",
        },
        {
          apply: setField("estimatedclosedate", "2030-02-28"),
          mention: "und den 28. Februar",
        },
      ],
      "the item": [
        {
          apply: otherRecord("Rahmenvertrag Schmidt"),
          mention: "nicht Line 4, Schmidt",
        },
      ],
      nothing: [],
    },
  },
  delete: {
    base: "delete-01-task-created-earlier",
    item: "Technisches Layout abstimmen",
    changes: {
      "one field": [
        {
          apply: withNotes("marked_destructive", "tool_says_permanent"),
          mention: "permanent",
          unaskable: true,
        },
      ],
      "the item": [
        {
          apply: otherRecord("Angebot nachfassen"),
          mention: "die andere Aufgabe",
        },
      ],
      nothing: [],
    },
  },
  send: {
    base: "send-01-mail-several-recipients",
    item: "Zusammenfassung Werksbesuch Linie 4",
    changes: {
      "one field": [
        {
          apply: setTitle("Summary of the plant visit"),
          mention: "Betreff: summary of the plant visit",
        },
      ],
      several: [
        {
          apply: setTitle("Summary of the plant visit"),
          mention: "Betreff: summary of the plant visit",
        },
        {
          apply: addToText("body", "Das Angebot gilt bis Freitag."),
          mention: "und dass es bis Freitag gilt",
        },
      ],
      "the item": [{ apply: otherServer("Gmail"), mention: "über Gmail" }],
      "a long text": [
        {
          apply: addToText("body", "Das Angebot gilt bis Freitag."),
          mention: "schreib dazu, dass es bis Freitag gilt",
        },
      ],
      nothing: [],
    },
  },
};

const ASKED = /^Changed: /;
const UNASKED = /^Also changed, without being asked: /;

const combinations = (Object.keys(KINDS) as Kind[]).flatMap((kind) =>
  (Object.entries(KINDS[kind].changes) as [What, Change[]][]).flatMap(
    ([what, changes]) =>
      (what === "nothing" ? [false] : [true, false]).map((asked) => ({
        kind,
        what,
        changes,
        asked,
      })),
  ),
);

/**
 * A reading played through by a listener who skips every piece: what must be
 * said comes back until it was heard to its end. Returns what had been heard
 * when the request to decide started.
 */
const skipThrough = (pieces: readonly SpokenPiece[]) => {
  let flow = spokenCardStep(pieces, spokenCardFlow(pieces), { type: "start" });
  const skipped = new Set<number>();
  for (let turn = 0; turn < 60 && flow.playing; turn++) {
    const { playing } = flow;
    if (playing.type !== "piece") break;
    if (pieces[playing.index].role === "request") return flow.heard;
    const again = skipped.has(playing.index);
    skipped.add(playing.index);
    flow = spokenCardStep(pieces, flow, {
      type: again ? "finished" : "skip",
    });
  }
  return null;
};

describe("a corrected card is said as the difference to the withdrawn one", () => {
  it("covers every kind with every difference it can have, asked and not", () => {
    for (const kind of Object.keys(KINDS) as Kind[])
      for (const what of ["the item", "nothing", "one field"] as const)
        expect(
          combinations.some(
            (entry) => entry.kind === kind && entry.what === what,
          ),
          `${kind} ${what}`,
        ).toBe(true);
    expect(combinations.length).toBeGreaterThanOrEqual(30);
  });

  it.each(combinations)(
    "$kind, $what, asked: $asked",
    ({ kind, what, changes, asked }) => {
      const { base, item } = KINDS[kind];
      const before = callOf(base);
      const after = callOf(base);
      for (const change of changes) change.apply(after);
      const words = asked
        ? changes.map((change) => change.mention).join(", ")
        : "bitte anders";
      const result = difference(withdrawn(before, words), after);
      const { pieces } = result;
      const texts = textsOf(pieces);

      // The item first, never skippable; the request last; nothing twice.
      expect(pieces[0].role).toBe("what");
      expect(pieces[0].mustSay).toBe(true);
      expect(pieces.at(-1)?.role).toBe("request");
      expect(new Set(pieces.map((piece) => piece.id)).size).toBe(pieces.length);
      expect(new Set(texts).size).toBe(texts.length);
      expect(pieces.length).toBeLessThanOrEqual(16);

      if (what === "the item") {
        expect(result.intro).toBe("other_item");
        expect(texts[0]).toMatch(
          /^Careful, the new card is about something different: /,
        );
        // Said in full, as any new card.
        expect(texts.slice(1)).toEqual(textsOf(piecesOf(after)).slice(1));
        return;
      }
      if (kind === "update" || kind === "delete")
        expect(texts[0]).toContain(item);
      else if (!(kind === "send" && what !== "a long text"))
        expect(texts[1]).toContain(item);

      const differences = pieces.filter(
        (piece) => ASKED.test(piece.text) || UNASKED.test(piece.text),
      );
      if (what === "nothing") {
        expect(result.intro).toBe("same");
        expect(texts[0]).toMatch(/^The new card is the same as before: /);
        expect(texts).toContain(
          "Nothing was changed. Try saying the change a different way.",
        );
        expect(differences).toEqual([]);
        return;
      }
      expect(result.intro).toBe("changed");
      expect(texts[0]).toMatch(/^The new version: /);
      expect(differences).toHaveLength(changes.length);
      for (const piece of differences) {
        expect(piece.mustSay).toBe(true);
        expect(piece.text).toMatch(
          asked && !changes.some((change) => change.unaskable)
            ? ASKED
            : UNASKED,
        );
      }
      expect(texts).toContain("Everything else is as before.");
      // Nothing of the withdrawn card that stayed the same is said again.
      for (const old of piecesOf(before))
        if (old.role === "detail" || old.role === "text")
          expect(texts).not.toContain(old.text);

      // Skipping through, every difference is still heard before the request.
      const heard = skipThrough(pieces);
      expect(heard).not.toBeNull();
      for (const piece of differences)
        expect(heard?.[pieces.indexOf(piece)]).toBe(true);
    },
  );

  it("marks only what the words do not name as not asked for", () => {
    const before = callOf("update-01-date-and-probability");
    const after = callOf("update-01-date-and-probability");
    setField("closeprobability", "75")(after);
    setField("estimatedclosedate", "2030-02-28")(after);
    const texts = textsOf(
      difference(withdrawn(before, "nimm 75 Prozent"), after).pieces,
    );
    expect(texts.filter((text) => ASKED.test(text))).toEqual([
      "Changed: Probability: from 10 to 75 percent.",
    ]);
    const unasked = texts.filter((text) => UNASKED.test(text));
    expect(unasked).toHaveLength(1);
    expect(unasked[0]).toContain("28 February 2030");
    // Asked first, then what was not asked for.
    expect(texts.findIndex((text) => ASKED.test(text))).toBeLessThan(
      texts.findIndex((text) => UNASKED.test(text)),
    );
  });

  it("says a field the new card leaves out", () => {
    const before = callOf("create-02-appointment");
    const after = callOf("create-02-appointment");
    const { label } = after.display;
    label.change.effects = label.change.effects?.filter(
      (effect) => effect.raw_name !== "location",
    );
    for (const entry of label.items)
      entry.fields = entry.fields?.filter((field) => field.name !== "location");
    expect(
      textsOf(difference(withdrawn(before, "ohne Location"), after).pieces),
    ).toContain("Changed: Location is no longer part of it.");
    expect(
      textsOf(difference(withdrawn(before, "bitte anders"), after).pieces),
    ).toContain(
      "Also changed, without being asked: Location is no longer part of it.",
    );
  });

  it("names the recipients when they changed", () => {
    const before = callOf("send-01-mail-several-recipients");
    const after = callOf("send-01-mail-several-recipients");
    const label = after.display.label as unknown as {
      change: {
        recipients: {
          total: number;
          groups: { values: string[]; count: number }[];
        };
      };
      items: { target: { values: unknown[] } }[];
    };
    label.change.recipients.groups[0].values = [
      "anna.mueller@beispiel-industrie.de",
    ];
    label.change.recipients.groups[0].count = 1;
    label.change.recipients.total = 3;
    label.items[0].target.values = label.items[0].target.values.slice(0, 1);
    expect(
      textsOf(difference(withdrawn(before, "ohne Ben"), after).pieces),
    ).toContain("Changed: Now to: Anna Mueller.");
  });

  it("a loss nobody heard on the withdrawn card is said, though unchanged", () => {
    const before = callOf("update-04-emptied-fields");
    const after = callOf("update-04-emptied-fields");
    setField("closeprobability", "60")(after);
    const losses = piecesOf(after).filter(
      (piece) => piece.mustSay && piece.role === "detail",
    );
    expect(losses.length).toBeGreaterThan(0);
    const notHeard = piecesOf(before)
      .filter((piece) => !piece.mustSay || piece.role === "what")
      .map((piece) => piece.id);
    const texts = textsOf(
      difference(withdrawn(before, "nimm 60", notHeard), after).pieces,
    );
    for (const loss of losses) expect(texts).toContain(loss.text);
    // Heard ones are not said again.
    const heard = textsOf(
      difference(withdrawn(before, "nimm 60"), after).pieces,
    );
    for (const loss of losses) expect(heard).not.toContain(loss.text);
  });

  it("the consequence of a delete is always said", () => {
    const before = callOf("delete-07-file-permanent");
    const consequence = piecesOf(before).find(
      (piece) => piece.role === "consequence",
    );
    expect(
      textsOf(
        difference(withdrawn(before, "bitte anders"), callOf(before.id)).pieces,
      ),
    ).toContain(consequence?.text);
  });

  it("a withdrawn card the user did not hear is said in full", () => {
    const before = callOf("update-01-date-and-probability");
    const after = callOf("update-01-date-and-probability");
    setField("closeprobability", "75")(after);
    const result = difference(withdrawn(before, "nimm 75", []), after);
    expect(result.intro).toBe("reread");
    expect(result.pieces[0].text).toMatch(/^The card was changed: /);
    expect(textsOf(result.pieces).slice(1)).toEqual(
      textsOf(piecesOf(after)).slice(1),
    );
  });

  it("a card nobody could describe is said in full, or as unchanged", () => {
    const before = callOf("generic-02-sync-remote-page");
    const after = callOf("generic-02-sync-remote-page");
    after.input.mode = "keep_remote";
    expect(difference(withdrawn(before, "x"), after).intro).toBe("reread");
    expect(difference(withdrawn(before, "x"), callOf(before.id)).intro).toBe(
      "same",
    );
  });

  it("a language with the pointer only says the pointer", () => {
    const before = callOf("update-01-date-and-probability");
    const result = difference(withdrawn(before, "x"), callOf(before.id), "fr");
    expect(result.pieces.map((piece) => piece.role)).toEqual(["pointer"]);
  });

  describe("in German", () => {
    beforeAll(() => {
      i18n.load({ de: deMessages as unknown as Messages });
    });

    it("says the change asked for, and marks one nobody asked for", () => {
      const before = callOf("create-02-appointment");
      const after = callOf("create-02-appointment");
      setField("scheduledstart", "2030-01-22T10:30:00")(after);
      setField("location", "Werk Bremen")(after);
      expect(
        textsOf(
          difference(withdrawn(before, "nimm den 22."), after, "de").pieces,
        ),
      ).toEqual([
        "Die neue Fassung: Ich möchte in Dynamics 365 einen Termin anlegen:",
        "Begehung Linie 4.",
        "Geändert: Scheduled start: 22. Januar 2030 um 10:30 Uhr.",
        "Außerdem ungefragt geändert: Location: Werk Bremen.",
        "Alles andere ist wie eben.",
        "Bitte auf dem Bildschirm bestätigen.",
      ]);
    });

    it("the same card again says so, and what can be done", () => {
      const before = callOf("update-01-date-and-probability");
      expect(
        textsOf(
          difference(withdrawn(before, "nimm 75"), callOf(before.id), "de")
            .pieces,
        ),
      ).toEqual([
        "Die neue Karte ist genau wie eben: Ich möchte in Dynamics 365 den Datensatz Line 4 Retrofit ändern.",
        "Geändert wurde nichts. Am besten die Änderung mit anderen Worten noch einmal sagen.",
        "Bitte auf dem Bildschirm bestätigen.",
      ]);
    });
  });
});

// Review of PR #1592: what the sentences of a card leave out still counts.

/** Sets a value in the call's arguments at a JSON pointer. */
const setInput = (call: SetCall, pointer: string, value: unknown): void => {
  const keys = pointer.split("/").slice(1);
  let holder = call.input;
  for (const key of keys.slice(0, -1))
    holder = holder[key] as Record<string, unknown>;
  holder[keys[keys.length - 1]] = value;
};

const REST = "Everything else is as before.";
const ELSEWHERE = "Something else is different too; it's on screen.";
const UNREADABLE =
  "The card changed in details I can't read out; they're on screen.";

describe("a corrected card the sentences alone would call the same", () => {
  it("another record by ID is another item, also under the same name", () => {
    for (const id of [
      "update-05-record-nobody-read",
      "update-01-date-and-probability",
    ]) {
      const before = callOf(id);
      const after = callOf(id);
      for (const item of after.display.label.items)
        for (const value of item.id?.values ?? [])
          value.text = "5f0c2a10-0000-4000-8000-00000000ffff";
      after.input.recordId = "5f0c2a10-0000-4000-8000-00000000ffff";
      const result = difference(withdrawn(before, "den anderen"), after);
      expect(result.intro, id).toBe("other_item");
    }
  });

  it("a changed statement is said, even when only its condition changed", () => {
    const before = callOf("run-01-sql");
    const after = callOf("run-01-sql");
    const query =
      "UPDATE opportunities SET stage = 'lost' WHERE stage = 'open'";
    (
      after.display.label.change as unknown as { opaque: { text: string }[] }
    ).opaque[0].text = query;
    after.input.query = query;
    const texts = textsOf(difference(withdrawn(before, "x"), after).pieces);
    expect(texts).toContain(
      "Also changed, without being asked: The query is different now; it's on screen.",
    );
    expect(texts).toContain(REST);
  });

  it("an outside address that changed is said in full when the name stays", () => {
    const before = callOf("share-01-file-outside");
    const after = callOf("share-01-file-outside");
    const recipients = (
      after.display.label.change as unknown as {
        recipients: { groups: { values: string[] }[]; outside: string[] };
      }
    ).recipients;
    recipients.groups[0].values = ["planer@konkurrenz.example"];
    recipients.outside = ["planer@konkurrenz.example"];
    after.input.emailAddress = "planer@konkurrenz.example";
    const result = difference(withdrawn(before, "x"), after);
    expect(result.intro).toBe("changed");
    expect(textsOf(result.pieces).join(" ")).toContain("Planer");
    expect(textsOf(result.pieces)).toContain(REST);
  });

  it("a recipient moved from To to Cc is said per group", () => {
    const before = callOf("send-01-mail-several-recipients");
    const after = callOf("send-01-mail-several-recipients");
    const groups = (
      after.display.label.change as unknown as {
        recipients: { groups: { values: string[]; count: number }[] };
      }
    ).recipients.groups;
    groups[0].values = ["anna.mueller@beispiel-industrie.de"];
    groups[1].values = [
      "ben.schmidt@beispiel-industrie.de",
      ...groups[1].values,
    ];
    after.input.to = groups[0].values;
    after.input.cc = groups[1].values;
    const texts = textsOf(
      difference(withdrawn(before, "Ben in Kopie"), after).pieces,
    );
    expect(texts).toContain("Changed: Now to: Anna Mueller.");
    expect(texts).toContain(
      "Changed: Now in copy: Ben Schmidt, Kollege and Einkauf.",
    );
    expect(texts).toContain(REST);
  });

  it("changed rows of a batch are counted", () => {
    const before = callOf("create-11-batch-rows");
    const after = callOf("create-11-batch-rows");
    const rows = (
      after.display.label.change as unknown as {
        batch: { rows: { effects: { values: { text: string }[] }[] }[] };
      }
    ).batch.rows;
    rows[2].effects[0].values = [
      { text: "Name: Schulung absagen, Status: Erledigt" },
    ];
    setInput(after, "/pages/2/properties/Status", "Erledigt");
    const texts = textsOf(difference(withdrawn(before, "x"), after).pieces);
    expect(texts).toContain(
      "Also changed, without being asked: One row is different now; it's on screen.",
    );
  });

  it("a value that differs past the words a card says is a difference", () => {
    const base =
      "Bitte die Zeichnungen der Fördertechnik bis Freitag an Frau Müller schicken und dann";
    const before = callOf("create-02-appointment");
    setField("location", `${base} anrufen`)(before);
    const after = callOf("create-02-appointment");
    setField("location", `${base} vorbeibringen`)(after);
    const result = difference(withdrawn(before, "x"), after);
    expect(result.intro).toBe("changed");
    expect(
      result.pieces.filter((piece) => UNASKED.test(piece.text)),
    ).toHaveLength(1);
  });

  it("a label without a change description compares every field", () => {
    const before = callOf("create-02-appointment");
    const after = callOf("create-02-appointment");
    for (const call of [before, after])
      delete (call.display.label as { change?: unknown }).change;
    setField("scheduledend", "2030-01-20T13:00:00")(after);
    const result = difference(withdrawn(before, "x"), after);
    expect(result.intro).toBe("changed");
    expect(textsOf(result.pieces)).toContain(REST);
  });

  it("arguments that differ where the card says nothing are never the same", () => {
    const before = callOf("share-01-file-outside");
    const after = callOf("share-01-file-outside");
    after.input.sendNotificationEmail = false;
    // The label was not told: only the arguments differ.
    const texts = textsOf(difference(withdrawn(before, "x"), after).pieces);
    expect(texts).toContain(UNREADABLE);
    expect(texts).not.toContain(REST);
  });
});

describe("whatever differs in the arguments is told", () => {
  /** Every leaf of an argument, as a JSON pointer. */
  const leaves = (value: unknown, at = ""): string[] =>
    typeof value === "object" && value !== null
      ? Object.entries(value).flatMap(([key, inner]) =>
          leaves(inner, `${at}/${key}`),
        )
      : [at];
  const mutated = (value: unknown): unknown =>
    typeof value === "string"
      ? `${value} x`
      : typeof value === "number"
        ? value + 1
        : typeof value === "boolean"
          ? !value
          : "x";
  const readOf = (pointer: string, input: unknown): unknown =>
    pointer
      .split("/")
      .slice(1)
      .reduce<unknown>(
        (holder, key) => (holder as Record<string, unknown>)[key],
        input,
      );

  const described = calls.filter(
    (call) =>
      approvalOf(call).type === "call" &&
      !call.id.startsWith("generic-") &&
      !call.id.startsWith("read-"),
  );

  it.each(described.map((call) => call.id))(
    "%s: a change of any argument alone is never the same",
    (id) => {
      for (const pointer of leaves(callOf(id).input)) {
        const before = callOf(id);
        const after = callOf(id);
        setInput(after, pointer, mutated(readOf(pointer, after.input)));
        const result = difference(withdrawn(before, "x"), after);
        const texts = textsOf(result.pieces);
        expect(result.intro, pointer).not.toBe("same");
        // The label did not change: only a text the card reads from the
        // arguments can say it; otherwise the voice says it cannot.
        const said = texts.filter(
          (text) => ASKED.test(text) || UNASKED.test(text),
        );
        if (said.length === 0) expect(texts, pointer).toContain(UNREADABLE);
        if (texts.includes(REST))
          expect(said.length, pointer).toBeGreaterThan(0);
      }
    },
  );

  it("a said difference beside one nobody can say is followed by 'something else'", () => {
    const before = callOf("create-02-appointment");
    const after = callOf("create-02-appointment");
    setField("location", "Werk Bremen")(after);
    setInput(after, "/item/regardingobjectid/relatedTable", "account");
    const texts = textsOf(difference(withdrawn(before, "x"), after).pieces);
    expect(texts).toContain(ELSEWHERE);
    expect(texts).not.toContain(REST);
    // With only the said difference, the rest is as before.
    const said = callOf("create-02-appointment");
    setField("location", "Werk Bremen")(said);
    expect(textsOf(difference(withdrawn(before, "x"), said).pieces)).toContain(
      REST,
    );
  });
});

describe("what counts as asked for", () => {
  it("a month said with another day does not ask for a date on that month", () => {
    const before = callOf("create-02-appointment");
    const after = callOf("create-02-appointment");
    setField("scheduledstart", "2030-01-22T10:30:00")(after);
    setField("scheduledend", "2030-01-29T11:30:00")(after);
    const texts = textsOf(
      difference(withdrawn(before, "nimm den 22. Januar"), after).pieces,
    );
    expect(texts.filter((text) => ASKED.test(text))).toHaveLength(1);
    expect(texts.filter((text) => ASKED.test(text))[0]).toContain("22 January");
    expect(texts.filter((text) => UNASKED.test(text))[0]).toContain(
      "29 January",
    );
  });

  it("a day with another month asks for nothing", () => {
    const before = callOf("create-02-appointment");
    const after = callOf("create-02-appointment");
    setField("scheduledstart", "2030-01-22T10:30:00")(after);
    expect(
      textsOf(
        difference(withdrawn(before, "nimm den 22. Februar"), after).pieces,
      ).some((text) => ASKED.test(text)),
    ).toBe(false);
  });

  it("the old value of something replaced asks for nothing; of something removed it does", () => {
    const before = callOf("create-02-appointment");
    const moved = callOf("create-02-appointment");
    setField("scheduledstart", "2030-01-22T10:30:00")(moved);
    setField("location", "Werk Bremen")(moved);
    const texts = textsOf(
      difference(withdrawn(before, "nicht in Augsburg, nimm den 22."), moved)
        .pieces,
    );
    expect(texts.find((text) => text.includes("Werk Bremen"))).toMatch(UNASKED);
    const removed = callOf("create-02-appointment");
    const { label } = removed.display;
    label.change.effects = label.change.effects?.filter(
      (effect) => effect.raw_name !== "location",
    );
    for (const entry of label.items)
      entry.fields = entry.fields?.filter((field) => field.name !== "location");
    delete (removed.input.item as Record<string, unknown>).location;
    expect(
      textsOf(difference(withdrawn(before, "ohne Augsburg"), removed).pieces),
    ).toContain("Changed: Location is no longer part of it.");
  });

  it("past the differences said one by one, the rest is counted as unasked", () => {
    const before = callOf("update-06-many-fields");
    const after = callOf("update-06-many-fields");
    const { label } = after.display;
    for (const effect of label.change.effects ?? [])
      effect.values = (effect.values ?? []).map((value) => ({
        ...value,
        text: /^\d+$/.test(value.text)
          ? String(Number(value.text) + 4)
          : `${value.text} neu`,
      }));
    label.change.effects?.push(
      ...["a", "b", "c", "d"].map((name) => ({
        path: `/item/extra_${name}`,
        name: `Extra ${name}`,
        raw_name: `extra_${name}`,
        effect: "set",
        values: [{ text: `Wert ${name}` }],
      })),
    );
    const texts = textsOf(difference(withdrawn(before, "x"), after).pieces);
    const counted = texts.filter((text) =>
      /more fields changed without being asked/.test(text),
    );
    expect(counted).toHaveLength(1);
    expect(texts.filter((text) => UNASKED.test(text))).toHaveLength(7);
  });
});
