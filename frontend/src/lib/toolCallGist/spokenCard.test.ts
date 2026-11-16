import { writeFileSync } from "node:fs";

import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";

import { messages as deMessages } from "@/locales/de/messages.json";

import data from "./fixtures/spokenCards/calls.json";
import expectedPieces from "./fixtures/spokenCards/expected.json";
import { toolCallCardOf } from "./gist";
import { gistPlainLine } from "./gistLabels";
import {
  MAX_READ_WORDS,
  MAX_SPOKEN_DETAILS,
  sameSpokenKind,
  spokenApprovalFor,
  spokenApprovalPieces,
} from "./spokenCard";

import type { SpokenApproval, SpokenPiece } from "./spokenCard";
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
const ZONE = "Europe/Berlin";

const callOf = (id: string): SetCall => {
  const call = calls.find((entry) => entry.id === id);
  if (!call) throw new Error(`no call ${id}`);
  return call;
};

const approvalOf = (call: SetCall, approvalKind = "mcp_tool"): SpokenApproval =>
  spokenApprovalFor(approvalKind, {
    ...call,
    display: {
      ...call.display,
      label: call.display.label as ToolCallLabel | undefined,
    },
  });

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
  spokenApprovalPieces(approvalOf(callOf(id)), {
    language,
    now: NOW,
    timeZone: ZONE,
    position,
  }).map(said);

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
          approvalOf(callOf(id), scenario.approval_kind),
        )
      : [
          spokenApprovalFor(scenario.approval_kind ?? "mcp_tool", {
            tool_name: scenario.id,
            input: null,
          }),
        ];
  return approvals.map((approval, index) =>
    spokenApprovalPieces(approval, {
      language,
      now: NOW,
      timeZone: ZONE,
      position:
        approvals.length > 1
          ? {
              index,
              total: approvals.length,
              sameAsPrevious:
                index > 0 && sameSpokenKind(approvals[index - 1], approval),
            }
          : undefined,
    }),
  );
};

const QUEUE = scenarios.find(
  (scenario) => scenario.id === "queue-01-three-tasks",
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
        text: "Scheduled end: 15. Januar 2030.",
        mustSay: false,
      },
      { role: "detail", text: "Priority code: 2.", mustSay: false },
      {
        role: "detail",
        text: "Regardingobjectid: Line 4 Retrofit.",
        mustSay: false,
      },
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
      "I'd like to create a task in Dynamics 365: Technisches Layout abstimmen. Scheduled end: 15 January 2030. Priority code: 2. Regardingobjectid: Line 4 Retrofit. Description: a text of about 70 words, shown on screen. Please confirm on screen.",
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
    // A date before a number before a linked record before free text.
    expect(
      create.filter((p) => p.role === "detail").map((p) => p.text),
    ).toEqual([
      "Scheduled end: 22. Januar 2030.",
      "Priority code: 2.",
      "Percentcomplete: 0 Prozent.",
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
      "Ich möchte in Dynamics 365 den Datensatz Line 4 Retrofit ändern. Estimated close date: vom 1. Dezember auf den 15. Januar 2030. Probability: von 10 auf 60 Prozent. Bitte auf dem Bildschirm bestätigen.",
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
    expect(spoken("delete-07-file-permanent")).toBe(
      "Ich möchte in Google Drive die Datei Angebot Linie 4 v3.docx löschen. Das lässt sich nicht rückgängig machen. Bitte auf dem Bildschirm bestätigen.",
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
    expect(spoken("read-02-query")).toBe(
      "Ich möchte in Dynamics 365 das Werkzeug read query verwenden. Bitte auf dem Bildschirm bestätigen.",
    );
    expect(spoken("read-01-search", "en")).toBe(
      "I'd like to use the tool search in Dynamics 365. Please confirm on screen.",
    );
  });

  it("points to the screen for other cards and other languages", () => {
    expect(
      spokenApprovalPieces(
        { type: "pointer" },
        { language: "de", now: NOW },
      ).map(said),
    ).toEqual([
      {
        role: "pointer",
        text: "Auf dem Bildschirm wartet eine Entscheidung.",
        mustSay: false,
      },
    ]);
    expect(pieces("create-01-task-long-description", "fr")).toEqual([
      {
        role: "pointer",
        text: "Une validation attend à l'écran.",
        mustSay: false,
      },
    ]);
    expect(pieces("update-01-date-and-probability", "pl")[0].text).toBe(
      "Na ekranie czeka prośba o zatwierdzenie.",
    );
    expect(pieces("delete-01-task-created-earlier", "es")[0].text).toBe(
      "Hay una aprobación pendiente en la pantalla.",
    );
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
      "Scheduled end: 20. Januar 2030.",
      "Regardingobjectid: Line 4 Retrofit.",
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
          expect(order.includes("count"), where).toBe(
            index === 0 && cards.length > 1,
          );
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
          // What the card holds shows in what is said.
          if (scenario.holds.includes("many_fields"))
            expect(order, where).toContain("more");
          if (scenario.holds.includes("short_fields"))
            expect(order, where).not.toContain("more");
          if (scenario.holds.includes("long_text")) {
            expect(
              card.some(
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
          }
          if (scenario.holds.includes("loss"))
            expect(
              card.some((piece) => piece.role === "detail" && piece.mustSay),
              where,
            ).toBe(true);
          if (scenario.holds.includes("outside_recipients"))
            expect(
              card.find((piece) => piece.role === "outside")?.mustSay,
              where,
            ).toBe(true);
          if (scenario.holds.includes("unread_record"))
            expect(texts.join(" "), where).toMatch(
              language === "de" ? /nicht gelesen/ : /haven't read/,
            );
          if (scenario.holds.includes("permanent_delete"))
            expect(texts.join(" "), where).toMatch(
              language === "de" ? /nicht rückgängig/ : /cannot be undone/,
            );
          // Every value a piece says is kept beside its text.
          for (const piece of card) expect(piece.values, where).toBeDefined();
        });
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
      { slot: "field", value: { kind: "text", text: "Estimated close date" } },
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
