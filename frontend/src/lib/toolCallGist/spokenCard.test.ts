import { writeFileSync } from "node:fs";

import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";

import { messages as deMessages } from "@/locales/de/messages.json";
import { messages as esMessages } from "@/locales/es/messages.json";
import { messages as frMessages } from "@/locales/fr/messages.json";
import { messages as plMessages } from "@/locales/pl/messages.json";

import { effectDisplayName } from "./cardLayout";
import { changeLayout } from "./change";
import { changeNoteLabel } from "./changeLabels";
import data from "./fixtures/spokenCards/calls.json";
import expectedPieces from "./fixtures/spokenCards/expected.json";
import voiceApprovals from "./fixtures/spokenCards/voiceApprovals.json";
import { toolCallCardOf } from "./gist";
import { gistPlainLine } from "./gistLabels";
import {
  MAX_READ_WORDS,
  MAX_SPOKEN_DETAILS,
  MAX_VOICE_ITEMS,
  sameSpokenKind,
  spokenApprovalFor,
  spokenApprovalPieces,
  spokenUtteranceSentences,
  voiceApprovable,
  voiceApprovalOffered,
} from "./spokenCard";
import {
  spokenCardFlow,
  spokenCardStep,
  voiceDecisionGate,
} from "./spokenCardFlow";
import { spokenWordsFor } from "./spokenCardWords";
import { earValue } from "./spokenValues";

import type { SpokenApproval, SpokenFacts, SpokenPiece } from "./spokenCard";
import type { SpokenCardEvent } from "./spokenCardFlow";
import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

/** A call shape of the set, labelled by the backend. */
interface SetCall {
  id: string;
  tool_name: string;
  server_id: string;
  input: unknown;
  display: {
    title: string;
    server_name?: string | null;
    label?: unknown;
  };
}

/** A scenario of design section 9: its kind of card and what the card holds. */
interface Scenario {
  id: string;
  kind: string[];
  holds: string[];
  approval_kind?: string;
  /** `consecutive_stops`: each call stops the turn on its own, one after another. */
  shape?: string;
  calls: string[];
}

const { calls, scenarios } = data as unknown as {
  calls: SetCall[];
  scenarios: Scenario[];
};
const expected = expectedPieces as unknown as Partial<
  Record<string, Record<string, SpokenPiece[][]>>
>;
const NOW = new Date("2026-11-17T09:00:00Z");

i18n.load({
  de: deMessages as unknown as Messages,
  fr: frMessages as unknown as Messages,
  es: esMessages as unknown as Messages,
  pl: plMessages as unknown as Messages,
});

/** Composes in `language` with its catalog active, as the app does. */
const inLanguage = <T>(language: string, compose: () => T): T => {
  const previous = i18n.locale;
  i18n.activate(language);
  try {
    return compose();
  } finally {
    i18n.activate(previous);
  }
};
const ZONE = "Europe/Berlin";

const callOf = (id: string): SetCall => {
  const call = calls.find((entry) => entry.id === id);
  if (!call) throw new Error(`no call ${id}`);
  return call;
};

// The set's labels carry the spoken vocabulary; most tests here are
// about composing, with the card's own names. `spokenNames.test.ts` covers
// the vocabulary.
const approvalOf = (
  call: SetCall,
  approvalKind = "mcp_tool",
  vocabulary = false,
): SpokenApproval => {
  const { spoken_names: _, ...label } = (call.display.label ?? {}) as Record<
    string,
    unknown
  >;
  return spokenApprovalFor(approvalKind, {
    ...call,
    display: {
      ...call.display,
      label: (vocabulary ? call.display.label : call.display.label && label) as
        | ToolCallLabel
        | undefined,
    },
  });
};

/** A piece without its source values, for comparing the words alone. */
const said = ({ role, text, mustSay }: SpokenPiece) => ({
  role,
  text,
  mustSay,
});

const pieces = (
  id: string,
  language = "de",
  position?: Parameters<typeof spokenApprovalPieces>[1]["position"],
) =>
  inLanguage(language, () =>
    spokenApprovalPieces(approvalOf(callOf(id)), {
      language,
      now: NOW,
      timeZone: ZONE,
      position,
    }),
  ).map(said);

const spoken = (id: string, language = "de") =>
  pieces(id, language)
    .map((piece) => piece.text)
    .join(" ");

const roles = (id: string) => pieces(id).map((piece) => piece.role);

/** Every card of a scenario as the voice says it, one after another. */
const scenarioPieces = (
  scenario: Scenario,
  language: string,
): SpokenPiece[][] => {
  const approvals =
    scenario.calls.length > 0
      ? scenario.calls.map((id) =>
          approvalOf(callOf(id), scenario.approval_kind, true),
        )
      : [
          spokenApprovalFor(scenario.approval_kind ?? "mcp_tool", {
            tool_name: scenario.id,
            input: null,
          }),
        ];
  const together = scenario.shape !== "consecutive_stops";
  return inLanguage(language, () =>
    approvals.map((approval, index) =>
      spokenApprovalPieces(approval, {
        language,
        now: NOW,
        timeZone: ZONE,
        position:
          together && approvals.length > 1
            ? {
                index,
                total: approvals.length,
                sameAsPrevious:
                  index > 0 && sameSpokenKind(approvals[index - 1], approval),
              }
            : undefined,
      }),
    ),
  );
};

const QUEUE = scenarios.find(
  (scenario) => scenario.id === "queue-01-three-task-children",
) as Scenario;
const queuePieces = (language: string) =>
  scenarioPieces(QUEUE, language).map((card) => card.map(said));

describe("spoken approval card", () => {
  it("says a create in the fixed order, from the card's data", () => {
    expect(pieces("create-01-task-long-description")).toEqual([
      {
        role: "what",
        text: "Ich möchte in Dynamics 365 eine Aufgabe anlegen:",
        mustSay: false,
      },
      {
        role: "item",
        text: "Technisches Layout abstimmen.",
        mustSay: false,
      },
      {
        role: "detail",
        text: "Regardingobjectid: Line 4 Retrofit.",
        mustSay: false,
      },
      {
        role: "detail",
        text: "Scheduled end: 15. Januar 2030.",
        mustSay: false,
      },
      { role: "detail", text: "Priority code: 2.", mustSay: false },
      {
        role: "text",
        text: "Description: ein Text von etwa 70 Wörtern, er steht auf dem Bildschirm.",
        mustSay: false,
      },
      {
        role: "request",
        text: "Bitte auf dem Bildschirm bestätigen.",
        mustSay: false,
      },
    ]);
    expect(spoken("create-01-task-long-description", "en")).toBe(
      "I'd like to create a task in Dynamics 365: Technisches Layout abstimmen. Regardingobjectid: Line 4 Retrofit. Scheduled end: 15 January 2030. Priority code: 2. Description: a text of about 70 words, shown on screen. Please confirm on screen.",
    );
  });

  it("reads three details at most and counts the rest", () => {
    const create = pieces("create-05-task-many-fields");
    expect(create.filter((piece) => piece.role === "detail")).toHaveLength(
      MAX_SPOKEN_DETAILS,
    );
    expect(create.find((piece) => piece.role === "more")?.text).toBe(
      "Dazu kommen fünf weitere Felder, sie stehen auf dem Bildschirm.",
    );
    // The card's first three: a named linked record first, then in the
    // call's order.
    expect(
      create.filter((p) => p.role === "detail").map((p) => p.text),
    ).toEqual([
      "Regardingobjectid: Ersatzteil-Rahmenvertrag.",
      "Scheduled end: 22. Januar 2030.",
      "Priority code: 2.",
    ]);
    expect(spoken("update-06-many-fields")).toContain(
      "Dazu kommen vier weitere Felder",
    );
  });

  it("says a loss first, never drops it, and marks it as one to say", () => {
    const update = pieces("update-04-emptied-fields");
    expect(
      update.map((piece) => [piece.role, piece.text, piece.mustSay]),
    ).toEqual([
      [
        "what",
        "Ich möchte in Dynamics 365 den Datensatz Line 4 Retrofit ändern.",
        false,
      ],
      ["detail", "Das Feld Telephone 1 wird geleert.", true],
      ["detail", "Das Feld Description wird geleert.", true],
      ["detail", "Probability: von 10 auf 50 Prozent.", false],
      ["request", "Bitte auf dem Bildschirm bestätigen.", false],
    ]);
  });

  it("says old and new values for the ear, coded values by their label", () => {
    expect(spoken("update-01-date-and-probability")).toBe(
      "Ich möchte in Dynamics 365 den Datensatz Line 4 Retrofit ändern. Estimated close date: vom 1. Dezember 2026 auf den 15. Januar 2030. Probability: von 10 auf 60 Prozent. Bitte auf dem Bildschirm bestätigen.",
    );
    expect(spoken("update-02-coded-value")).toContain(
      "Risk level: von Low auf High.",
    );
    expect(spoken("update-03-lookup", "en")).toContain(
      "Parent contact: from Anna Müller to Ben Schmidt.",
    );
  });

  it("never says a machine ID, and says when a record was not read", () => {
    for (const call of calls) {
      for (const language of ["de", "en"]) {
        const text = spokenApprovalPieces(approvalOf(call), {
          language,
          now: NOW,
          timeZone: ZONE,
        })
          .map((piece) => piece.text)
          .join(" ");
        expect(text, call.id).not.toMatch(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        );
        expect(text, call.id).not.toContain("1aB2cD3eF4");
      }
    }
    expect(spoken("update-05-record-nobody-read")).toBe(
      "Ich möchte in Dynamics 365 einen Datensatz ändern, den ich in diesem Chat nicht gelesen habe. Risk level wird auf Medium gesetzt. Bitte auf dem Bildschirm bestätigen.",
    );
    expect(spoken("delete-03-record-nobody-read", "en")).toContain(
      "I'd like to delete a record in Dynamics 365 that I haven't read in this chat.",
    );
    expect(spoken("create-06-task-unread-regarding")).toContain(
      "Regardingobjectid: ein Datensatz, den ich in diesem Chat nicht gelesen habe.",
    );
  });

  it("names a long text with its size and never reads it", () => {
    const note = spoken("create-09-note-very-long");
    expect(note).toContain(
      "Note text: ein Text von etwa 170 Wörtern, er steht auf dem Bildschirm.",
    );
    expect(note).not.toContain("Teilnehmer");
    // A short one is read.
    expect(spoken("create-07-phonecall")).toContain(
      "Description: Kurz klären, ob zwei Tage Stillstand reichen.",
    );
  });

  it("says a delete with its consequence, a pause before the request", () => {
    const task = pieces("delete-01-task-created-earlier");
    expect(task.map((piece) => piece.text)).toEqual([
      "Ich möchte in Dynamics 365 die Aufgabe Technisches Layout abstimmen löschen.",
      "Ob sie sich wiederherstellen lässt, ist nicht bekannt.",
      "Bitte auf dem Bildschirm bestätigen.",
    ]);
    expect(task.map((piece) => piece.mustSay)).toEqual([true, true, false]);
    expect(
      spokenApprovalPieces(
        approvalOf(callOf("delete-01-task-created-earlier")),
        {
          language: "de",
          now: NOW,
        },
      )[2].pauseBeforeMs,
    ).toBeGreaterThan(0);
    expect(spoken("delete-09-single-page")).toBe(
      "Ich möchte in Notion die Seite Kickoff Line 4 löschen. Sie lässt sich wiederherstellen. Bitte auf dem Bildschirm bestätigen.",
    );
    expect(spoken("delete-06-batch-pages")).toBe(
      "Ich möchte in Notion zwölf Seiten, darunter Kickoff Line 4, Wochenbericht KW 44 und Wochenbericht KW 45, löschen. Sie lassen sich wiederherstellen. Bitte auf dem Bildschirm bestätigen.",
    );
  });

  it("names recipients and counts the rest, with those outside", () => {
    const send = pieces("send-01-mail-several-recipients");
    expect(
      send.map((piece) => [piece.role, piece.text, piece.mustSay]),
    ).toEqual([
      [
        "what",
        "Ich möchte in Outlook eine E-Mail an Anna Mueller und drei weitere senden:",
        false,
      ],
      ["item", "Betreff: Zusammenfassung Werksbesuch Linie 4.", false],
      ["outside", "Zwei der Empfänger sind außerhalb der Firma.", true],
      [
        "text",
        "Body: ein Text von etwa 50 Wörtern, er steht auf dem Bildschirm.",
        false,
      ],
      ["request", "Bitte auf dem Bildschirm bestätigen.", false],
    ]);
    expect(spoken("create-04-email-two-contacts")).toContain(
      "eine E-Mail an zwei Empfänger anlegen:",
    );
    expect(spoken("share-01-file-outside", "en")).toContain(
      "The recipient is outside the organisation.",
    );
  });

  it("never reads a statement", () => {
    const run = spoken("run-01-sql");
    expect(run).not.toContain("UPDATE");
    expect(run).toBe(
      "Ich möchte in Data warehouse eine SQL-Abfrage ausführen. Sie steht auf dem Bildschirm. Wie viele Datensätze das betrifft, ist nicht bekannt. Bitte auf dem Bildschirm bestätigen.",
    );
  });

  it("gives a call without a verb the tool's title and the server", () => {
    expect(spoken("read-12-sql-select-into")).toBe(
      "Ich möchte in Dynamics 365 das Tool read query verwenden. Bitte auf dem Bildschirm bestätigen.",
    );
    expect(spoken("read-12-sql-select-into", "en")).toBe(
      "I'd like to use the tool read query in Dynamics 365. Please confirm on screen.",
    );
  });

  it("says a change an app prepared from its own title and summary", () => {
    const label = {
      action: "update",
      object_kind: "document",
      source: "own_mapping",
    } as ToolCallLabel;
    const changeOf = (decideOnScreen: boolean) =>
      spokenApprovalFor("client_tool", {
        tool_name: "apply_document_plan",
        input: { submission_call_id: "call-plan", draft_id: "d-1" },
        display: {
          title: "Change “Vertrag.docx”",
          description: "Updates 2 of 9 sections: § 3, § 5",
          label,
        },
        chained: { decide_on_screen: decideOnScreen },
      });
    const change = changeOf(false);
    expect(
      spokenApprovalPieces(change, { language: "en", now: NOW }).map(
        (piece) => [piece.role, piece.text, piece.mustSay],
      ),
    ).toEqual([
      ["what", "Change “Vertrag.docx”.", false],
      ["detail", "Updates 2 of 9 sections: § 3, § 5.", true],
      ["request", "Please confirm on screen.", false],
    ]);
    expect(voiceApprovalOffered(change)).toBe(true);
    // A card that needs a tick on screen is never approved by voice.
    expect(voiceApprovalOffered(changeOf(true))).toBe(false);
    expect(sameSpokenKind(change, change)).toBe(false);
  });

  it("points to the screen for other cards and other languages", () => {
    expect(
      spokenApprovalPieces(
        { type: "pointer" },
        { language: "en", now: NOW },
      ).map(said),
    ).toEqual([
      {
        role: "pointer",
        text: "A decision is waiting on screen.",
        mustSay: false,
      },
    ]);
    for (const language of ["fr", "es", "pl"]) {
      expect(
        pieces("update-01-date-and-probability", language).map(
          (piece) => piece.role,
        ),
      ).toEqual(["pointer"]);
    }
  });

  it("reads a queue one at a time, the count first, shorter from the second", () => {
    const [first, second, third] = queuePieces("de");
    expect(first.map((piece) => piece.text).slice(0, 3)).toEqual([
      "Dafür brauche ich drei Freigaben.",
      "Die erste: Ich möchte in Dynamics 365 eine Aufgabe anlegen:",
      "Zeichnungen anfordern.",
    ]);
    expect(second.map((piece) => piece.text)).toEqual([
      "Die zweite: eine Aufgabe, Angebot nachfassen.",
      "Bezug: Line 4 Retrofit.",
      "Fälligkeitsdatum: 20. Januar 2030.",
      "Bitte auf dem Bildschirm bestätigen.",
    ]);
    expect(third[0].text).toBe("Die dritte: eine Aufgabe, Schulung planen.");
    expect(queuePieces("en")[1][0].text).toBe(
      "The second one: a task, Angebot nachfassen.",
    );
  });

  it("uses no form of address", () => {
    for (const call of calls) {
      const text = spoken(call.id);
      expect(text, call.id).not.toMatch(
        /\b(du|dich|dir|dein\w*|Ihnen|Ihr\w*)\b/,
      );
      // "Sie" only opens a sentence, as "it" or "they".
      expect(text, call.id).not.toMatch(/[^.:]\s+Sie\b/);
    }
  });

  it("keeps every piece within what the voice endpoint takes", () => {
    for (const call of calls) {
      for (const language of ["de", "en"]) {
        const said = pieces(call.id, language);
        expect(said.length, call.id).toBeLessThanOrEqual(16);
        for (const piece of said)
          expect(piece.text.length, call.id).toBeLessThanOrEqual(400);
      }
    }
    expect(roles("update-08-long-text")).toEqual(["what", "text", "request"]);
  });
});

describe("findings of the review of 2026-11-17", () => {
  const previous = i18n.locale;
  afterEach(() => i18n.activate(previous));
  // The sentences come from the catalog of the language shown.
  const words = (language: string, now = NOW) => {
    i18n.activate(language);
    return spokenWordsFor(language, { now, timeZone: ZONE });
  };
  const facts = { action: "update" } as SpokenFacts;
  const set = (field: string, written: string, language = "de") =>
    words(language).detail(
      { type: "set", field, value: earValue(written), loss: false },
      { action: "create" } as SpokenFacts,
    );

  it("1.3: an item that exists is never named from a field the call typed", () => {
    expect(
      pieces("delete-07-file-permanent").map((piece) => piece.text),
    ).toEqual([
      "Ich möchte in Google Drive eine Datei löschen, deren Kennung auf dem Bildschirm steht.",
      "File name laut Aufruf: Angebot Linie 4 v3.docx.",
      "Das lässt sich nicht rückgängig machen.",
      "Bitte auf dem Bildschirm bestätigen.",
    ]);
    // Another typed name, the same ID: the item said stays the same.
    const call = JSON.parse(
      JSON.stringify(callOf("delete-07-file-permanent")),
    ) as SetCall;
    const label = call.display.label as {
      change: { effects: { values: { text: string }[] }[] };
    };
    label.change.effects[0].values[0].text = "Gehaltsliste 2026.xlsx";
    const said = inLanguage("de", () =>
      spokenApprovalPieces(approvalOf(call), { language: "de", now: NOW }),
    ).map((piece) => piece.text);
    expect(said[0]).toBe(
      "Ich möchte in Google Drive eine Datei löschen, deren Kennung auf dem Bildschirm steht.",
    );
    expect(said[1]).toBe("File name laut Aufruf: Gehaltsliste 2026.xlsx.");
    expect(spoken("archive-01-note")).toContain(
      "eine Notiz archivieren, deren Kennung auf dem Bildschirm steht",
    );
    // Something new is still called by its title.
    expect(spoken("upload-01-file")).toContain(
      "Zeichnungen-Foerdertechnik.pdf",
    );
  });

  it("1.4: digits that are not amounts are said as written, decimals whole", () => {
    expect(set("Postcode", "01067")).toBe("Postcode: 01067.");
    expect(set("Phone", "0891234500")).toBe("Phone: 0891234500.");
    expect(set("Account", "12345678901")).toBe("Account: 12345678901.");
    expect(set("Share", "0.0005")).toBe("Share: 0,0005.");
    expect(set("Value", "12345.6789")).toBe("Value: 12.345,6789.");
    expect(set("Value", "12345.6789", "en")).toBe("Value: 12,345.6789.");
    expect(set("Amount", "185000")).toBe("Amount: 185.000.");
  });

  it("1.5: the year is left out only for the coming eleven months, and said on both sides of a change across years", () => {
    const late = new Date("2026-12-30T10:00:00Z");
    const change = (from: string, to: string, language = "de") =>
      words(language, late).detail(
        {
          type: "changed",
          field: "Estimated close date",
          from: earValue(from),
          to: earValue(to),
          loss: false,
        },
        facts,
      );
    expect(change("2026-12-01", "2026-01-15")).toBe(
      "Estimated close date: vom 1. Dezember 2026 auf den 15. Januar 2026.",
    );
    // Staging test 2026-11-19: across New Year, both dates say their year.
    expect(change("2026-12-31", "2027-01-15")).toBe(
      "Estimated close date: vom 31. Dezember 2026 auf den 15. Januar 2027.",
    );
    expect(change("2027-01-16", "2026-12-31", "en")).toBe(
      "Estimated close date: from 16 January 2027 to 31 December 2026.",
    );
    expect(change("2027-01-16", "2027-01-20")).toBe(
      "Estimated close date: vom 16. Januar auf den 20. Januar.",
    );
    expect(change("2027-11-01", "2027-12-15", "en")).toBe(
      "Estimated close date: from 1 November to 15 December 2027.",
    );
  });

  it("1.6: a card too long for the voice is cut by rule, never left silent", () => {
    const title = pieces("create-13-long-title");
    expect(title[1].text.length).toBeLessThanOrEqual(400);
    expect(title[1].text).toMatch(/… gekürzt\.$/);
    const emptied = pieces("update-11-fifteen-emptied");
    expect(emptied.length).toBeLessThanOrEqual(16);
    expect(emptied.find((piece) => piece.role === "detail")).toEqual({
      role: "detail",
      text: "Dabei werden 15 Felder geleert.",
      mustSay: true,
    });
    expect(
      pieces("update-11-fifteen-emptied", "en").find(
        (piece) => piece.role === "detail",
      )?.text,
    ).toBe("15 fields will be emptied.");
  });

  it("question 2: the pointer sentence comes from the catalogs", () => {
    const previous = i18n.locale;
    try {
      for (const [language, catalog, sentence] of [
        ["fr", frMessages, "Une validation attend à l'écran."],
        ["es", esMessages, "Hay una aprobación pendiente en la pantalla."],
        ["pl", plMessages, "Na ekranie czeka prośba o zatwierdzenie."],
        ["de", deMessages, "Auf dem Bildschirm wartet eine Entscheidung."],
      ] as const) {
        void catalog;
        i18n.activate(language);
        expect(
          spokenApprovalPieces({ type: "pointer" }, { language, now: NOW })[0]
            .text,
        ).toBe(sentence);
        if (language !== "de") {
          expect(pieces("create-01-task-long-description", language)).toEqual([
            { role: "pointer", text: sentence, mustSay: false },
          ]);
        }
      }
      // A catalog's wording is the one said.
      i18n.load("fr", {
        ...(frMessages as unknown as Messages),
        "spokenCard.pointer": "Une décision attend.",
      });
      i18n.activate("fr");
      expect(pieces("create-01-task-long-description", "fr")[0].text).toBe(
        "Une décision attend.",
      );
    } finally {
      i18n.load("fr", frMessages as unknown as Messages);
      i18n.activate(previous);
    }
  });
});

describe("findings of the review of the base (2026-11-17)", () => {
  /** A copy of a call of the set whose change description `edit` adjusts. */
  const edited = (
    id: string,
    edit: (change: {
      effects: Record<string, unknown>[];
      counts: Record<string, number>;
    }) => void,
  ): SetCall => {
    const call = JSON.parse(JSON.stringify(callOf(id))) as SetCall;
    edit((call.display.label as { change: Parameters<typeof edit>[0] }).change);
    return call;
  };
  const say = (call: SetCall, language = "de") =>
    inLanguage(language, () =>
      spokenApprovalPieces(approvalOf(call), {
        language,
        now: NOW,
        timeZone: ZONE,
      }),
    ).map((piece) => piece.text);
  const detail = (
    language: string,
    entry: Parameters<ReturnType<typeof spokenWordsFor>["detail"]>[0],
    action = "update",
  ) =>
    inLanguage(language, () =>
      spokenWordsFor(language, { now: NOW, timeZone: ZONE }).detail(entry, {
        action,
      } as SpokenFacts),
    );

  it("1.4: a list is said with its entries, and the tool's word is hedged", () => {
    expect(pieces("create-14-list-entries").map((p) => p.text)).toContain(
      "Tags: Retrofit, Linie 4, Service und ein weiterer Eintrag.",
    );
    expect(spoken("create-14-list-entries", "en")).toContain(
      "Tags: Retrofit, Linie 4, Service and one more.",
    );
    expect(spoken("update-13-list-only-adds")).toContain(
      "Zu Labels kommen laut Tool Retrofit und Service dazu.",
    );
    expect(spoken("update-13-list-only-adds", "en")).toContain(
      "Retrofit and Service will be added to Labels, the tool says.",
    );
    const removed = {
      type: "list_removed" as const,
      field: "Tags",
      values: [
        { kind: "text" as const, text: "Alt" },
        { kind: "text" as const, text: "Veraltet" },
      ],
      omitted: 0,
      loss: true as const,
    };
    expect(detail("de", removed)).toBe(
      "Aus Tags werden laut Tool Alt und Veraltet entfernt.",
    );
    expect(detail("en", removed)).toBe(
      "Alt and Veraltet will be removed from Tags, the tool says.",
    );
  });

  it("1.5: an unread record as the old or the new value reads as a sentence", () => {
    const unread = { kind: "unread" as const };
    const anna = { kind: "text" as const, text: "Anna" };
    expect(
      detail("de", {
        type: "changed",
        field: "Owner",
        from: unread,
        to: anna,
        loss: false,
      }),
    ).toBe(
      "Owner: von einem Datensatz, den ich in diesem Chat nicht gelesen habe, auf Anna.",
    );
    expect(
      detail("de", { type: "set", field: "Owner", value: unread, loss: false }),
    ).toBe(
      "Owner wird auf einen Datensatz, den ich in diesem Chat nicht gelesen habe, gesetzt.",
    );
    expect(
      detail("en", {
        type: "changed",
        field: "Owner",
        from: unread,
        to: anna,
        loss: false,
      }),
    ).toBe("Owner: from a record I haven't read in this chat to Anna.");
    expect(
      inLanguage("de", () =>
        spokenWordsFor("de", { now: NOW }).consequence(["restore_unknown"], {
          count: 1,
          kind: "other",
          statement: "sql",
        } as SpokenFacts),
      ),
    ).toBe("Ob sich das wiederherstellen lässt, ist nicht bekannt.");
  });

  it("1.6: the German voice calls a tool a Tool, as the card does", () => {
    for (const call of calls)
      expect(spoken(call.id), call.id).not.toMatch(/Werkzeug/);
    expect(spoken("read-12-sql-select-into")).toContain(
      "das Tool read query verwenden",
    );
  });

  it("1.8: the name a call typed beside an ID stays the first detail", () => {
    const call = edited("delete-07-file-permanent", (change) => {
      change.effects.unshift(
        ...["Mode", "Notify", "Role"].map((name) => ({
          path: `/${name.toLowerCase()}`,
          name,
          raw_name: name.toLowerCase(),
          effect: "set",
          values: [{ text: "ja" }],
        })),
      );
      change.counts.set += 3;
    });
    expect(say(call).slice(0, 3)).toEqual([
      "Ich möchte in Google Drive eine Datei löschen, deren Kennung auf dem Bildschirm steht.",
      "File name laut Aufruf: Angebot Linie 4 v3.docx.",
      "Mode: ja.",
    ]);
  });

  it("1.2: values the label could not keep are counted with the rest", () => {
    const call = edited("update-06-many-fields", (change) => {
      change.counts.set += 5;
    });
    expect(spoken("update-06-many-fields")).toContain(
      "Dazu kommen vier weitere Felder",
    );
    expect(say(call)).toContain(
      "Dazu kommen neun weitere Felder, sie stehen auf dem Bildschirm.",
    );
  });
});

describe("one ranking with the card", () => {
  /** The card's first view, in order: losses, unreadable values, then the values. */
  const cardFields = (call: SetCall, lossesCounted = false): string[] => {
    const card = toolCallCardOf(
      call.display.label as ToolCallLabel | undefined,
      call.input,
    );
    const change = card.kind === "gist" ? card.gist.change : undefined;
    if (!change || change.batch) return [];
    const layout = changeLayout(change);
    return [
      // Many losses are said as one counted piece.
      ...(lossesCounted
        ? []
        : [...layout.emptied, ...layout.lists, ...layout.removedFromLists]),
      ...layout.unreadable,
      ...layout.firstRows,
      ...layout.collapsed,
    ]
      .filter((effect) => effect.effect !== "unchanged")
      .map((effect) => {
        const name = effectDisplayName(effect);
        const suffix = ` (${effect.rawName})`;
        return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
      });
  };
  const fieldsOf = (said: SpokenPiece[], roles: SpokenPiece["role"][]) =>
    said.flatMap((piece) =>
      roles.includes(piece.role)
        ? (piece.values ?? []).flatMap((source) =>
            source.slot === "field" && source.value.kind === "text"
              ? [source.value.text]
              : [],
          )
        : [],
    );

  it("says the card's first details, in the card's order", () => {
    for (const call of calls) {
      const said = inLanguage("de", () =>
        spokenApprovalPieces(approvalOf(call), {
          language: "de",
          now: NOW,
          timeZone: ZONE,
        }),
      );
      const card = cardFields(
        call,
        said.some(
          (piece) =>
            piece.role === "detail" &&
            piece.values?.every((source) => source.slot === "count"),
        ),
      );
      if (card.length === 0) continue;
      const details = fieldsOf(said, ["detail"]);
      // What the voice leaves out before its last detail is only what it
      // says another way: a long text, or the field that names the item.
      const elsewhere = new Set(fieldsOf(said, ["text"]));
      const lastSaid = card.indexOf(details.at(-1) ?? "");
      const skipped = card
        .slice(0, Math.max(lastSaid, 0))
        .filter((field) => !details.includes(field) && !elsewhere.has(field));
      expect(
        skipped.length,
        `${call.id}: ${skipped.join(", ")}`,
      ).toBeLessThanOrEqual(1);
      const positions = details.map((field) => card.indexOf(field));
      expect(
        positions.every((at) => at >= 0),
        call.id,
      ).toBe(true);
      expect(
        positions.every(
          (at, index) => index === 0 || at > positions[index - 1],
        ),
        `${call.id}: ${details.join(", ")} / ${card.join(", ")}`,
      ).toBe(true);
    }
    expect(
      pieces("create-02-appointment")
        .filter((piece) => piece.role === "detail")
        .map((piece) => piece.text),
    ).toEqual([
      "Regardingobjectid: Line 4 Retrofit.",
      "Location: Werk Augsburg.",
      "Scheduled start: 20. Januar 2030 um 10:30 Uhr.",
    ]);
  });

  it("always says a value the card shows as unreadable, never counts it", () => {
    expect(pieces("upsert-01-company").map((piece) => piece.text)).toEqual([
      "Ich möchte in CRM den Datensatz Muster Maschinenbau AG anlegen oder aktualisieren.",
      "Company: Der Wert steht auf dem Bildschirm.",
      "Bitte auf dem Bildschirm bestätigen.",
    ]);
  });

  it("hedges a list where the card cannot tell whether it is replaced", () => {
    const list = pieces("update-12-list-replace-unknown");
    expect(list[1]).toEqual({
      role: "detail",
      text: "Die Liste Tags bekommt Retrofit und Linie 4. Ob das die Liste ersetzt oder ergänzt, ist nicht bekannt.",
      mustSay: true,
    });
    expect(spoken("update-12-list-replace-unknown", "en")).toContain(
      "The list Tags gets Retrofit and Linie 4. Whether that replaces the list or adds to it is not known.",
    );
  });

  describe("ERMAIN-1240: a destructive mark is said by who made it, where it adds something", () => {
    /** `id` with its notes and completeness set as the backend would. */
    const marked = (
      id: string,
      notes: string[],
      edit: (change: Record<string, unknown>) => void = () => {},
    ) => {
      const call = JSON.parse(JSON.stringify(callOf(id))) as SetCall;
      const change = (call.display.label as { change: Record<string, unknown> })
        .change;
      change.notes = [
        ...((change.notes as string[] | undefined) ?? []),
        ...notes,
      ];
      edit(change);
      return (
        language: string,
        amount: "full" | "short" = "full",
        wording: "precise" | "natural" = "precise",
      ) =>
        inLanguage(language, () =>
          spokenApprovalPieces(approvalOf(call), {
            language,
            now: NOW,
            timeZone: ZONE,
            amount,
            shortDetails: 1,
            wording,
          }),
        ).map((piece) => piece.text);
    };
    const ORGANISATION = {
      de: "Ihre Organisation hat dieses Tool als destruktiv gekennzeichnet.",
      en: "Your organisation has marked this tool as destructive.",
    };
    const TOOL = {
      de: "Das Tool kennzeichnet dies als destruktiv.",
      en: "The tool marks this as destructive.",
    };

    it.each(["de", "en"] as const)(
      "%s: an update the voice says in full does not add the mark",
      (language) => {
        for (const notes of [
          ["operator_marked_destructive"],
          ["marked_destructive"],
          ["marked_destructive", "operator_marked_destructive"],
        ]) {
          const texts = marked(
            "update-01-date-and-probability",
            notes,
          )(language);
          expect(texts).not.toContain(ORGANISATION[language]);
          expect(texts).not.toContain(TOOL[language]);
        }
        const created = marked("create-10-account", [
          "operator_marked_destructive",
        ])(language);
        expect(created).not.toContain(ORGANISATION[language]);
      },
    );

    it.each(["de", "en"] as const)(
      "%s: where the voice says only part of the write, the mark stays",
      (language) => {
        for (const id of [
          // "Dazu kommen vier weitere Felder …"
          "update-06-many-fields",
          "create-08-opportunity-amounts",
          // Five pages, some named.
          "create-11-batch-rows",
          // Whether the list is replaced is not known.
          "update-12-list-replace-unknown",
          // "Dabei werden 15 Felder geleert."
          "update-11-fifteen-emptied",
          // A record nobody read in the chat.
          "update-05-record-nobody-read",
        ])
          expect(
            marked(id, ["operator_marked_destructive"])(language),
            id,
          ).toContain(ORGANISATION[language]);
      },
    );

    it.each(["de", "en"] as const)(
      "%s: where the voice summarises a value instead of saying it, the mark stays",
      (language) => {
        for (const id of [
          // A long text said only by its length.
          "update-08-long-text",
          "create-01-task-long-description",
          "create-09-note-very-long",
          // A cut title.
          "create-13-long-title",
          // List entries counted.
          "create-14-list-entries",
          // Recipients counted, and a text by its length.
          "create-04-email-two-contacts",
          // A referenced record nobody read.
          "create-06-task-unread-regarding",
          // The record named only by "its ID is on screen".
          "update-13-list-only-adds",
        ]) {
          const card = marked(id, ["operator_marked_destructive"]);
          for (const amount of ["full", "short"] as const)
            for (const wording of ["precise", "natural"] as const)
              expect(
                card(language, amount, wording),
                `${id} ${amount} ${wording}`,
              ).toContain(ORGANISATION[language]);
        }
      },
    );

    it.each(["de", "en"] as const)(
      "%s: where the voice says each value in full, the mark is not added, in either wording",
      (language) => {
        for (const id of [
          "update-01-date-and-probability",
          "update-02-coded-value",
          "update-10-contact-two-fields",
          "create-10-account",
        ])
          for (const wording of ["precise", "natural"] as const)
            expect(
              marked(id, ["operator_marked_destructive"])(
                language,
                "full",
                wording,
              ),
              `${id} ${wording}`,
            ).not.toContain(ORGANISATION[language]);
      },
    );

    it.each(["de", "en"] as const)(
      "%s: a short reading that holds a detail back says the mark",
      (language) => {
        const update = marked("update-01-date-and-probability", [
          "operator_marked_destructive",
        ]);
        expect(update(language, "short")).toContain(ORGANISATION[language]);
        expect(update(language, "full")).not.toContain(ORGANISATION[language]);
      },
    );

    it.each(["de", "en"] as const)(
      "%s: where the voice cannot say everything, it says who marked the tool",
      (language) => {
        const incomplete = (change: Record<string, unknown>) => {
          change.complete = false;
        };
        expect(
          marked(
            "update-01-date-and-probability",
            ["operator_marked_destructive", "marked_destructive"],
            incomplete,
          )(language),
        ).toContain(ORGANISATION[language]);
        expect(
          marked(
            "update-01-date-and-probability",
            ["marked_destructive"],
            incomplete,
          )(language),
        ).toContain(TOOL[language]);
        const unreadable = marked(
          "update-01-date-and-probability",
          ["operator_marked_destructive"],
          (change) => {
            (change.effects as Record<string, unknown>[])[0].effect =
              "unreadable";
          },
        )(language);
        expect(unreadable).toContain(ORGANISATION[language]);
        expect(unreadable).not.toContain(TOOL[language]);
      },
    );

    it("a call that is no create or update keeps the mark, by who made it", () => {
      expect(
        marked("send-02-slack-message", ["operator_marked_destructive"])("de"),
      ).toContain(ORGANISATION.de);
    });
  });

  it("says that a tool marks a call destructive in the card's own words", () => {
    for (const language of ["de", "en"]) {
      inLanguage(language, () => {
        expect(
          spokenWordsFor(language, { now: NOW }).consequence(["destructive"], {
            count: 1,
            kind: "other",
          } as SpokenFacts),
        ).toBe(changeNoteLabel("marked_destructive"));
      });
    }
  });
});

/** The order the design fixes; a later piece never comes before an earlier one. */
const ROLE_ORDER = [
  "count",
  "what",
  "item",
  "outside",
  "detail",
  "more",
  "text",
  "consequence",
  "request",
];

const CONSEQUENCE_KINDS = ["delete", "run"];

describe("every scenario of the set", () => {
  const languages = ["de", "en"];

  it.each(scenarios.map((scenario) => [scenario.id, scenario] as const))(
    "%s",
    (_id, scenario) => {
      for (const language of languages) {
        const cards = scenarioPieces(scenario, language);
        expect(cards, `${scenario.id} ${language}`).toEqual(
          expected[scenario.id]?.[language],
        );
        cards.forEach((card, index) => {
          const where = `${scenario.id} ${language} #${index}`;
          const order = card.map((piece) => piece.role);
          if (order[0] === "pointer") {
            expect(order, where).toEqual(["pointer"]);
            return;
          }
          // The design's order, and nothing said twice.
          const ranks = order.map((role) => ROLE_ORDER.indexOf(role));
          expect(
            ranks.every((rank) => rank >= 0),
            where,
          ).toBe(true);
          expect(
            ranks.every((rank, at) => at === 0 || rank >= ranks[at - 1]),
            where,
          ).toBe(true);
          const texts = card.map((piece) => piece.text);
          expect(new Set(texts).size, where).toBe(texts.length);
          expect(order.at(-1), where).toBe("request");
          // Only approvals asked together are counted first.
          expect(order.includes("count"), where).toBe(
            index === 0 &&
              cards.length > 1 &&
              scenario.shape !== "consecutive_stops",
          );
          // Every card fits what the voice endpoint takes.
          expect(card.length, where).toBeLessThanOrEqual(16);
          expect(
            texts.reduce((sum, piece) => sum + piece.length, 0),
            where,
          ).toBeLessThanOrEqual(2000);
          for (const piece of texts)
            expect(piece.length, where).toBeLessThanOrEqual(400);
          // The consequence is said, and before the request to decide.
          const consequence = order.indexOf("consequence");
          if (
            scenario.kind.some((kind) => CONSEQUENCE_KINDS.includes(kind)) ||
            scenario.holds.includes("permanent_delete")
          ) {
            expect(consequence, where).toBeGreaterThan(-1);
          }
          if (consequence !== -1) {
            expect(consequence, where).toBeLessThan(order.indexOf("request"));
            expect(card[consequence].mustSay, where).toBe(true);
          }
          // Every value a piece says is kept beside its text.
          for (const piece of card) expect(piece.values, where).toBeDefined();
        });
        // What the scenario holds shows in what is said, on some card of it.
        const all = cards.flat();
        const roles = all.map((piece) => piece.role);
        const said = all.map((piece) => piece.text).join(" ");
        const where = `${scenario.id} ${language}`;
        const counted = (piece: SpokenPiece) =>
          piece.role === "more" ||
          (piece.role === "detail" &&
            piece.mustSay &&
            piece.values?.every((source) => source.slot === "count") === true);
        if (scenario.holds.includes("many_fields"))
          expect(all.some(counted), where).toBe(true);
        if (scenario.holds.includes("short_fields"))
          expect(roles, where).not.toContain("more");
        if (scenario.holds.includes("long_text"))
          expect(
            all.some(
              (piece) =>
                piece.role === "text" &&
                piece.values?.some(
                  (source) =>
                    source.slot === "words" &&
                    source.value.kind === "number" &&
                    source.value.value > MAX_READ_WORDS,
                ),
            ),
            where,
          ).toBe(true);
        if (scenario.holds.includes("loss"))
          expect(
            all.some((piece) => piece.role === "detail" && piece.mustSay),
            where,
          ).toBe(true);
        if (scenario.holds.includes("outside_recipients"))
          expect(
            all.find((piece) => piece.role === "outside")?.mustSay,
            where,
          ).toBe(true);
        if (scenario.holds.includes("unread_record"))
          expect(said, where).toMatch(
            language === "de" ? /nicht gelesen/ : /haven't read/,
          );
        if (scenario.holds.includes("permanent_delete"))
          expect(said, where).toMatch(
            language === "de" ? /nicht rückgängig/ : /cannot be undone/,
          );
      }
      for (const language of ["fr", "es", "pl"]) {
        for (const card of scenarioPieces(scenario, language))
          expect(card.map((piece) => piece.role)).toEqual(["pointer"]);
      }
    },
  );

  it("keeps the source values of a piece beside its words", () => {
    const [card] = scenarioPieces(
      scenarios.find(
        (scenario) => scenario.id === "update-01-date-and-probability",
      ) as Scenario,
      "de",
    );
    expect(card[0].values).toEqual([
      { slot: "server", value: { kind: "text", text: "Dynamics 365" } },
      { slot: "name", value: { kind: "text", text: "Line 4 Retrofit" } },
    ]);
    expect(card[1].values).toEqual([
      {
        slot: "field",
        // The operator's glossary names it; the voice says its word.
        value: { kind: "text", text: "Estimated close date" },
      },
      { slot: "from", value: { kind: "date", year: 2026, month: 12, day: 1 } },
      { slot: "to", value: { kind: "date", year: 2030, month: 1, day: 15 } },
    ]);
  });

  it("writes the expected pieces when asked", () => {
    if (!process.env.SPOKEN_CARD_EXPECT_WRITE) return;
    const all = Object.fromEntries(
      scenarios.map((scenario) => [
        scenario.id,
        Object.fromEntries(
          languages.map((language) => [
            language,
            scenarioPieces(scenario, language),
          ]),
        ),
      ]),
    );
    writeFileSync(
      "src/lib/toolCallGist/fixtures/spokenCards/expected.json",
      `${JSON.stringify(all, null, 2)}\n`,
    );
  });
});

/**
 * Writes the set as heard, scenario by scenario beside the card's headline:
 * `SPOKEN_CARD_RENDER=/path/to/file.md pnpm vitest run spokenCard`.
 */
describe.runIf(Boolean(process.env.SPOKEN_CARD_RENDER))("rendered set", () => {
  const previous = i18n.locale;
  i18n.load("de", deMessages as unknown as Messages);
  afterEach(() => i18n.activate(previous));

  const headline = (call: SetCall | undefined, locale: string): string => {
    if (!call) return "(no call: the card is drawn by its own component)";
    i18n.activate(locale);
    const card = toolCallCardOf(
      call.display.label as ToolCallLabel | undefined,
      call.input,
    );
    return card.kind === "gist"
      ? gistPlainLine(card.gist, card.gist.items[0], "ask")
      : `(${card.kind}) ${call.display.title}`;
  };

  it("writes the file", () => {
    const say = (cards: SpokenPiece[][]) =>
      cards
        .map((card) =>
          card
            .map(
              (piece) =>
                `${piece.mustSay ? "**" : ""}[${piece.role}]${piece.mustSay ? "**" : ""} ${piece.text}`,
            )
            .join("<br>"),
        )
        .join("<br>―<br>");
    const lines = [
      "| Scenario | Kind / holds | On screen | Spoken, German | Spoken, English |",
      "|---|---|---|---|---|",
    ];
    for (const scenario of scenarios) {
      const members = scenario.calls.map(callOf);
      const screen = (members.length > 0 ? members : [undefined])
        .map((call) => `${headline(call, "de")}<br>_${headline(call, "en")}_`)
        .join("<br>―<br>");
      lines.push(
        `| \`${scenario.id}\` | ${scenario.kind.join(", ")}<br>_${scenario.holds.join(", ") || "–"}_ | ${screen} | ${say(scenarioPieces(scenario, "de"))} | ${say(scenarioPieces(scenario, "en"))} |`,
      );
    }
    writeFileSync(
      process.env.SPOKEN_CARD_RENDER as string,
      `${lines.join("\n")}\n`,
    );
  });
});

describe("what the voice says besides the pieces", () => {
  const card = () =>
    inLanguage("de", () =>
      spokenApprovalPieces(approvalOf(callOf("update-08-long-text")), {
        language: "de",
        now: NOW,
      }),
    );
  const say = (
    language: string,
    utterance: Parameters<typeof spokenUtteranceSentences>[0],
    pieces = card(),
  ) =>
    inLanguage(language, () =>
      spokenUtteranceSentences(utterance, pieces, { language, now: NOW }),
    );

  it("counts the rest and says when nothing is left, in German and English", () => {
    expect(say("de", { type: "count", count: 1 })).toEqual([
      "Noch eine Sache:",
    ]);
    expect(say("de", { type: "count", count: 3 })).toEqual([
      "Noch drei Dinge:",
    ]);
    expect(say("en", { type: "count", count: 1 })).toEqual(["One more thing:"]);
    expect(say("en", { type: "count", count: 2 })).toEqual([
      "Two more things:",
    ]);
    expect(say("de", { type: "nothing_left" })).toEqual(["Das war alles."]);
    expect(say("en", { type: "nothing_left" })).toEqual([
      "That was everything.",
    ]);
  });

  it("says what is done on screen for now, and what it did not understand", () => {
    expect(
      say("de", {
        type: "notice",
        notice: { kind: "decide_on_screen", decision: "approve" },
      }),
    ).toEqual(["Zustimmen geht im Moment nur auf dem Bildschirm."]);
    expect(
      say("en", {
        type: "notice",
        notice: { kind: "decide_on_screen", decision: "reject" },
      }),
    ).toEqual(["For now, declining is done on screen."]);
    expect(
      say("de", {
        type: "notice",
        notice: { kind: "change_on_screen", reason: "card" },
      }),
    ).toEqual([
      "Diese Karte lässt sich nicht per Sprache ändern. Bitte auf dem Bildschirm entscheiden.",
    ]);
    expect(
      say("de", {
        type: "notice",
        notice: { kind: "unclear", hasText: true },
      })[0],
    ).toContain("Text vorlesen");
    expect(
      say("en", {
        type: "notice",
        notice: { kind: "unclear", hasText: false },
      })[0],
    ).not.toContain("read the text");
    for (const kind of [
      "new_request_on_screen",
      "no_text",
      "unavailable",
    ] as const)
      for (const language of ["de", "en"])
        expect(
          say(language, { type: "notice", notice: { kind } })[0].length,
        ).toBeGreaterThan(10);
  });

  it("reads a long text after its field, in passages the voice takes", () => {
    const pieces = card();
    const index = pieces.findIndex((piece) => piece.readOut);
    const read = say("de", { type: "text", index }, pieces);
    expect(read[0]).toMatch(/^[^:]+: /);
    expect(read.join(" ")).toContain(
      pieces[index].readOut?.text.split(" ").slice(0, 5).join(" ") ?? "-",
    );
    for (const passage of read) expect(passage.length).toBeLessThan(301 + 40);
  });

  it("points to the screen for a text longer than one request, or held only in part", () => {
    const pieces = card();
    const index = pieces.findIndex((piece) => piece.readOut);
    const long = pieces.map((piece, at) =>
      at === index
        ? {
            ...piece,
            readOut: {
              text: "Ein ziemlich langer Satz über die Linie vier. ".repeat(80),
              cut: false,
            },
          }
        : piece,
    );
    const read = say("de", { type: "text", index }, long);
    expect(read.at(-1)).toBe("Der Rest des Textes steht auf dem Bildschirm.");
    expect(read.length).toBeLessThan(17);
    expect(read.join("").length).toBeLessThan(2001);
    for (const passage of read) expect(passage.length).toBeLessThan(401);

    const held = pieces.map((piece, at) =>
      at === index
        ? { ...piece, readOut: { text: "Nur der Anfang.", cut: true } }
        : piece,
    );
    expect(say("en", { type: "text", index }, held).at(-1)).toBe(
      "The rest of the text is on screen.",
    );
  });
});

describe("ERMAIN-1259: a card approved by voice names the phrase", () => {
  const request = (id: string, language: string, voiceApproval: boolean) =>
    inLanguage(language, () =>
      spokenApprovalPieces(approvalOf(callOf(id)), {
        language,
        now: NOW,
        timeZone: ZONE,
        voiceApproval,
      }),
    ).find((piece) => piece.role === "request")?.text;

  it("says the phrase as the card's last sentence, in German and English", () => {
    expect(request("update-01-date-and-probability", "de", true)).toBe(
      "Zum Ausführen bitte „Ich bestätige“ sagen.",
    );
    expect(request("update-01-date-and-probability", "en", true)).toBe(
      "Say “I confirm” to go ahead.",
    );
    expect(request("update-01-date-and-probability", "de", false)).toBe(
      "Bitte auf dem Bildschirm bestätigen.",
    );
  });

  it("decides from the label as the backend does, for every call of the set", () => {
    for (const call of calls) {
      const label = call.display.label as ToolCallLabel | undefined;
      expect(voiceApprovable(label), call.id).toBe(
        (voiceApprovals as Record<string, boolean>)[call.id],
      );
    }
    expect(Object.keys(voiceApprovals)).toHaveLength(calls.length);
  });

  /**
   * The listener skips every piece the first time it plays ("weiter"), then
   * lets the voice go on; the request is heard in the end.
   */
  const skippedThenHeard = (pieces: SpokenPiece[]) => {
    let flow = spokenCardStep(pieces, spokenCardFlow(pieces), {
      type: "start",
    });
    const skipped = new Set<number>();
    for (let step = 0; step < 50 && !flow.closed; step += 1) {
      const playing = flow.playing;
      if (playing?.type !== "piece") break;
      const event: SpokenCardEvent =
        pieces[playing.index].role !== "request" && !skipped.has(playing.index)
          ? { type: "skip" }
          : { type: "finished" };
      if (event.type === "skip") skipped.add(playing.index);
      flow = spokenCardStep(pieces, flow, event);
    }
    return flow;
  };

  it.each([
    ["update-01-date-and-probability", "what", "de"],
    ["update-01-date-and-probability", "what", "en"],
    ["create-03-contact", "item", "de"],
    ["create-03-contact", "item", "en"],
  ] as const)(
    "%s: the %s skipped is said again before the phrase can count (%s)",
    (id, role, language) => {
      const card = (voiceApproval: boolean) =>
        inLanguage(language, () =>
          spokenApprovalPieces(approvalOf(callOf(id)), {
            language,
            now: NOW,
            timeZone: ZONE,
            voiceApproval,
          }),
        );
      const pieces = card(true);
      const at = pieces.findIndex((piece) => piece.role === role);
      expect(at).not.toBe(-1);
      const flow = skippedThenHeard(pieces);
      expect(voiceDecisionGate(pieces, flow).ready).toBe(true);
      expect(flow.heard[at]).toBe(true);
      const plain = card(false);
      expect(plain.every((piece) => !piece.mustSay)).toBe(true);
      expect(skippedThenHeard(plain).heard[at]).toBe(false);
    },
  );

  it.each(["de", "en"])(
    "says every voice decision line in %s, none ending with the phrase",
    (language) => {
      const kinds = [
        "say_phrase",
        "say_phrase_again",
        "say_again",
        "phrase_on_screen",
        "declined",
        "decline_on_screen",
        "confirm_on_screen",
        "decision_failed",
      ] as const;
      const lines = inLanguage(language, () => {
        const words = spokenWordsFor(language, { now: NOW });
        return [
          words.request(true),
          ...kinds.map((kind) => words.notice({ kind })),
        ];
      });
      expect(new Set(lines).size).toBe(lines.length);
      for (const line of lines) {
        expect(line.length).toBeGreaterThan(0);
        expect(line).not.toMatch(/(ich bestätige|i confirm)\W*$/i);
      }
    },
  );

  it("asks for the phrase only where the label allows it and the voice can say the call", () => {
    const offered = (id: string) =>
      voiceApprovalOffered(approvalOf(callOf(id)));
    expect(offered("update-01-date-and-probability")).toBe(true);
    expect(offered("read-01-search")).toBe(true);
    expect(offered("read-03-sql-several-filters")).toBe(false);
    expect(offered("run-01-sql")).toBe(false);
    expect(offered("create-12-hidden-characters")).toBe(false);
    expect(voiceApprovalOffered({ type: "pointer" })).toBe(false);
    expect(request("run-01-sql", "de", true)).toBe(
      "Bitte auf dem Bildschirm bestätigen.",
    );
    const update = approvalOf(callOf("update-01-date-and-probability"));
    if (update.type !== "call" || !update.label) throw new Error("a label");
    const batch = (total: number) =>
      voiceApprovable({
        ...update.label,
        change: {
          ...update.label?.change,
          batch: { ...update.label?.change?.batch, total },
        },
      } as ToolCallLabel);
    expect(batch(MAX_VOICE_ITEMS)).toBe(true);
    expect(batch(MAX_VOICE_ITEMS + 1)).toBe(false);
  });
});
