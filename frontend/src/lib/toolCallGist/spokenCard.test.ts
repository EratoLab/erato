import { writeFileSync } from "node:fs";

import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";

import { messages as deMessages } from "@/locales/de/messages.json";

import set from "./fixtures/spokenCardSet.json";
import { toolCallCardOf } from "./gist";
import { gistPlainLine } from "./gistLabels";
import {
  MAX_SPOKEN_DETAILS,
  sameSpokenKind,
  spokenApprovalPieces,
} from "./spokenCard";

import type { SpokenApproval, SpokenPiece } from "./spokenCard";
import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

interface SetCall {
  id: string;
  group: string;
  tool_name: string;
  server_id: string;
  input: unknown;
  display: {
    title: string;
    server_name?: string | null;
    label?: unknown;
  };
}

const calls = (set as { calls: SetCall[] }).calls;
const NOW = new Date("2026-11-17T09:00:00Z");
const ZONE = "Europe/Berlin";

const callOf = (id: string): SetCall => {
  const call = calls.find((entry) => entry.id === id);
  if (!call) throw new Error(`no call ${id}`);
  return call;
};

const approvalOf = (call: SetCall): SpokenApproval => ({
  type: "call",
  label: call.display.label as ToolCallLabel | undefined,
  input: call.input,
  toolTitle: call.display.title,
  server: call.display.server_name ?? undefined,
});

const pieces = (
  id: string,
  language = "de",
  position?: Parameters<typeof spokenApprovalPieces>[1]["position"],
): SpokenPiece[] =>
  spokenApprovalPieces(approvalOf(callOf(id)), {
    language,
    now: NOW,
    timeZone: ZONE,
    position,
  });

const spoken = (id: string, language = "de") =>
  pieces(id, language)
    .map((piece) => piece.text)
    .join(" ");

const roles = (id: string) => pieces(id).map((piece) => piece.role);

const QUEUE = ["queue-01-task", "queue-02-task", "queue-03-task"];

const queuePieces = (language: string): SpokenPiece[][] =>
  QUEUE.map((id, index) =>
    spokenApprovalPieces(approvalOf(callOf(id)), {
      language,
      now: NOW,
      timeZone: ZONE,
      position: {
        index,
        total: QUEUE.length,
        sameAsPrevious:
          index > 0 &&
          sameSpokenKind(
            approvalOf(callOf(QUEUE[index - 1])),
            approvalOf(callOf(id)),
          ),
      },
    }),
  );

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
    expect(task[2].pauseBeforeMs).toBeGreaterThan(0);
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
      spokenApprovalPieces({ type: "pointer" }, { language: "de", now: NOW }),
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

/**
 * Writes the set as heard, call by call beside the card's headline:
 * `SPOKEN_CARD_RENDER=/path/to/file.md pnpm vitest run spokenCard`.
 */
describe.runIf(Boolean(process.env.SPOKEN_CARD_RENDER))("rendered set", () => {
  const previous = i18n.locale;
  i18n.load("de", deMessages as unknown as Messages);
  afterEach(() => i18n.activate(previous));

  const headline = (call: SetCall, locale: string): string => {
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
    const sections: string[] = [];
    const say = (said: SpokenPiece[]) =>
      said
        .map(
          (piece) =>
            `${piece.mustSay ? "**" : ""}[${piece.role}]${piece.mustSay ? "**" : ""} ${piece.text}`,
        )
        .join("<br>");
    let group = "";
    for (const call of calls) {
      if (call.group === "queue") continue;
      if (call.group !== group) {
        group = call.group;
        sections.push(`\n## ${group}\n`);
        sections.push(
          "| Call | On screen | Spoken, German | Spoken, English |",
        );
        sections.push("|---|---|---|---|");
      }
      sections.push(
        `| \`${call.id}\` | ${headline(call, "de")}<br>_${headline(call, "en")}_ | ${say(pieces(call.id, "de"))} | ${say(pieces(call.id, "en"))} |`,
      );
    }
    sections.push("\n## queue of three\n");
    sections.push("| Call | On screen | Spoken, German | Spoken, English |");
    sections.push("|---|---|---|---|");
    const german = queuePieces("de");
    const english = queuePieces("en");
    QUEUE.forEach((id, index) => {
      sections.push(
        `| \`${id}\` | ${headline(callOf(id), "de")}<br>_${headline(callOf(id), "en")}_ | ${say(german[index])} | ${say(english[index])} |`,
      );
    });
    writeFileSync(
      process.env.SPOKEN_CARD_RENDER as string,
      `${sections.join("\n")}\n`,
    );
  });
});
