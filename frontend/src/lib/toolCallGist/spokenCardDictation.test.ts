import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";

import { messages as deMessages } from "@/locales/de/messages.json";

import data from "./fixtures/spokenCards/calls.json";
import {
  spokenApprovalFor,
  spokenApprovalPieces,
  spokenUtteranceSentences,
} from "./spokenCard";
import { spokenDifference } from "./spokenCardDifference";

import type { SpokenApproval, SpokenPiece } from "./spokenCard";
import type { DictatedTurn } from "./spokenDictation";
import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

/**
 * Layer 1 of design section 9 for a dictated text: each kind of card that
 * writes a long text, each relation of that text to what the user dictated,
 * each place the dictation can come from, in German and English.
 */

interface LabelText {
  path: string;
  text: string;
  chars: number;
  truncated?: boolean;
}
interface SetCall {
  id: string;
  tool_name: string;
  input: Record<string, unknown>;
  display: {
    title: string;
    server_name?: string | null;
    label: { change: { texts: LabelText[] } };
  };
}

const { calls } = data as unknown as { calls: SetCall[] };
const OPTIONS = {
  now: new Date("2026-11-17T09:00:00Z"),
  timeZone: "Europe/Berlin",
};

beforeAll(() => {
  i18n.load({ de: deMessages as unknown as Messages });
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

const callOf = (id: string): SetCall => {
  const call = calls.find((entry) => entry.id === id);
  if (!call) throw new Error(`no call ${id}`);
  return JSON.parse(JSON.stringify(call)) as SetCall;
};

/** The call with its long text set to `text`, in the label and the input. */
const withText = (call: SetCall, text: string): SetCall => {
  const copy = JSON.parse(JSON.stringify(call)) as SetCall;
  const [spoken] = copy.display.label.change.texts;
  spoken.text = text;
  spoken.chars = text.length;
  const keys = spoken.path.split("/").slice(1);
  let holder = copy.input;
  for (const key of keys.slice(0, -1))
    holder = holder[key] as Record<string, unknown>;
  holder[keys[keys.length - 1]] = text;
  return copy;
};

const approvalOf = (call: SetCall): SpokenApproval =>
  spokenApprovalFor("mcp_tool", {
    ...call,
    display: {
      ...call.display,
      label: call.display.label as unknown as ToolCallLabel,
    },
  });

const piecesOf = (
  call: SetCall,
  language: string,
  dictated?: readonly DictatedTurn[],
) =>
  inLanguage(language, () =>
    spokenApprovalPieces(approvalOf(call), { language, ...OPTIONS, dictated }),
  );

const textPiece = (pieces: readonly SpokenPiece[]) => {
  const piece = pieces.find((entry) => entry.role === "text");
  if (!piece) throw new Error("no text piece");
  return piece;
};

/** The cards that write a long text: one of each kind. */
const CARDS = {
  create: "create-01-task-long-description",
  update: "update-08-long-text",
  send: "send-01-mail-several-recipients",
} as const;

/** A sentence with a number, so each card's text has one to change. */
const DATE = " Rückmeldung bitte bis zum 12. Dezember.";
const baseOf = (id: string) =>
  `${callOf(id).display.label.change.texts[0].text}${DATE}`;

const sentencesOf = (text: string) => text.split(/(?<=\.) /);

/** How the text on the card relates to the one dictated. */
const RELATIONS = {
  identical: { card: (text: string) => text, says: "unchanged" },
  punctuation_and_case: {
    card: (text: string) =>
      text.toLowerCase().replaceAll(",", "").replaceAll(". ", ".\n"),
    says: "unchanged",
  },
  one_word_changed: {
    card: (text: string) => text.replace(" bis ", " ab "),
    says: "changed",
  },
  number_changed: {
    card: (text: string) => text.replace("12. Dezember", "13. Dezember"),
    says: "changed",
  },
  shortened: {
    card: (text: string) => text.replace(DATE, ""),
    says: "part",
  },
  shortened_inside: {
    card: (text: string) => {
      const sentences = sentencesOf(text);
      return [...sentences.slice(0, 1), ...sentences.slice(2)].join(" ");
    },
    says: "changed",
  },
  extended: {
    card: (text: string) => `${text} Mit freundlichen Grüßen, Daniel Person`,
    says: "extended",
  },
  reordered: {
    card: (text: string) => {
      const sentences = sentencesOf(text);
      return [sentences[1], sentences[0], ...sentences.slice(2)].join(" ");
    },
    says: "changed",
  },
  translated: {
    card: () =>
      "In the call with Ms Miller we agreed to settle the technical layout of line 4 by mid January. For that we need the current drawings of the conveyors, the list of interfaces to the existing controls and an estimate of the downtime. Please reply by 12 December.",
    says: "size",
  },
} as const;

type Says = (typeof RELATIONS)[keyof typeof RELATIONS]["says"];

const SAID: Record<"de" | "en", Record<Says, RegExp>> = {
  de: {
    unchanged: /^[\w ]+: der diktierte Text, unverändert übernommen\.$/,
    part: /^[\w ]+: ein Teil des diktierten Textes, wörtlich\.$/,
    extended: /^[\w ]+: der diktierte Text, wörtlich, mit Ergänzungen\.$/,
    changed: /^[\w ]+: der diktierte Text, an einigen Stellen geändert\.$/,
    size: /^[\w ]+: ein Text von etwa \d+ Wörtern, er steht auf dem Bildschirm\.$/,
  },
  en: {
    unchanged: /^[\w ]+: the dictated text, taken over unchanged\.$/,
    part: /^[\w ]+: part of the dictated text, word for word\.$/,
    extended: /^[\w ]+: the dictated text word for word, with additions\.$/,
    changed: /^[\w ]+: the dictated text, changed in places\.$/,
    size: /^[\w ]+: a text of about \d+ words, shown on screen\.$/,
  },
};

/** Where the words came from, as the chat holds them before the card. */
const ORIGINS: Record<
  string,
  { turns: (base: string) => DictatedTurn[]; dictated: boolean }
> = {
  dictated_in_the_last_turn: {
    turns: (base) => [{ passages: [`Schreib dazu folgenden Text: ${base}`] }],
    dictated: true,
  },
  dictated_in_an_earlier_turn: {
    turns: (base) => [
      { passages: ["Ja, mach das so, und häng es an den Datensatz."] },
      { passages: [base] },
    ],
    dictated: true,
  },
  // A typed message never lands in the record of dictated words.
  typed: { turns: () => [], dictated: false },
  not_from_the_user: {
    turns: () => [
      { passages: ["Fass das Gespräch von gestern für den Kunden zusammen."] },
    ],
    dictated: false,
  },
};

describe("a dictated text is named by where it came from", () => {
  for (const [kind, id] of Object.entries(CARDS)) {
    const base = baseOf(id);
    for (const [origin, { turns, dictated }] of Object.entries(ORIGINS)) {
      for (const [relation, { card, says }] of Object.entries(RELATIONS)) {
        for (const language of ["de", "en"] as const) {
          it(`${kind}, ${origin}, ${relation}, ${language}`, () => {
            const call = withText(callOf(id), card(base));
            const piece = textPiece(piecesOf(call, language, turns(base)));
            expect(piece.text).toMatch(
              SAID[language][dictated ? says : "size"],
            );
          });
        }
      }
    }
  }

  it("leaves every other piece as it was", () => {
    for (const id of Object.values(CARDS)) {
      const base = baseOf(id);
      const call = withText(callOf(id), base);
      const plain = piecesOf(call, "de");
      const named = piecesOf(call, "de", [{ passages: [base] }]);
      expect(named.map((piece) => piece.id)).toEqual(
        plain.map((piece) => piece.id),
      );
      expect(named.filter((piece) => piece.role !== "text")).toEqual(
        plain.filter((piece) => piece.role !== "text"),
      );
    }
  });

  it("keeps where the text came from beside the piece, instead of its size", () => {
    const base = baseOf(CARDS.create);
    const piece = textPiece(
      piecesOf(withText(callOf(CARDS.create), base), "de", [
        { passages: [base] },
      ]),
    );
    expect(piece.values).toEqual([
      { slot: "field", value: { kind: "text", text: "Description" } },
      { slot: "dictated", value: { kind: "text", text: "unchanged" } },
    ]);
  });

  it("a text the card holds only in part is named by its size: its rest is unknown", () => {
    const call = callOf("create-09-note-very-long");
    const [text] = call.display.label.change.texts;
    // Neither the label nor the input holds the whole text.
    text.truncated = true;
    delete (call.input.item as Record<string, unknown>).notetext;
    const piece = textPiece(piecesOf(call, "de", [{ passages: [text.text] }]));
    expect(piece.text).toMatch(SAID.de.size);
  });
});

describe("reading a dictated text on request", () => {
  const readOut = (
    relation: keyof typeof RELATIONS,
    language: "de" | "en",
  ): string[] => {
    const base = baseOf(CARDS.create);
    const pieces = piecesOf(
      withText(callOf(CARDS.create), RELATIONS[relation].card(base)),
      language,
      [{ passages: [base] }],
    );
    const index = pieces.findIndex((piece) => piece.role === "text");
    return inLanguage(language, () =>
      spokenUtteranceSentences({ type: "text", index }, pieces, {
        language,
        ...OPTIONS,
      }),
    );
  };

  it("reads an unchanged dictation as it is", () => {
    const [first] = readOut("identical", "de");
    expect(first).toMatch(/^Description: Im Gespräch mit Frau Müller/);
  });

  it("says first that a changed text differs, then reads the card's text", () => {
    const said = readOut("one_word_changed", "de");
    expect(said[0]).toBe(
      "Der Text auf der Karte weicht vom Diktat ab. Er lautet:",
    );
    expect(said[1]).toMatch(/^Description: Im Gespräch mit Frau Müller/);
    expect(said.join(" ")).toContain("Januar ab");
    expect(readOut("one_word_changed", "en")[0]).toBe(
      "The text on the card differs from what was dictated. It reads:",
    );
  });

  it("says first that the card holds only part, or more", () => {
    expect(readOut("shortened", "de")[0]).toBe(
      "Auf der Karte steht nur ein Teil des Diktats. Er lautet:",
    );
    expect(readOut("extended", "en")[0]).toBe(
      "The card holds more than what was dictated. It reads:",
    );
  });
});

describe("a corrected card whose text is dictated", () => {
  const OLD = baseOf(CARDS.create);

  const difference = (
    before: SetCall,
    after: SetCall,
    words: string,
    dictated: readonly DictatedTurn[],
    language = "de",
  ) => {
    const heard = piecesOf(before, language, dictated).map((piece) => piece.id);
    return inLanguage(language, () =>
      spokenDifference(
        { approval: approvalOf(before), heard, words },
        approvalOf(after),
        { language, ...OPTIONS, dictated },
      ),
    );
  };

  it("says the text changed, and that it is now the dictation word for word", () => {
    const dictated = [{ passages: [OLD] }];
    const before = withText(callOf(CARDS.create), OLD.replace(" bis ", " ab "));
    const after = withText(callOf(CARDS.create), OLD);
    const result = difference(
      before,
      after,
      "nimm meinen Text genau so",
      dictated,
    );
    expect(result.intro).toBe("changed");
    const texts = result.pieces.map((piece) => piece.text);
    expect(texts).toContain(
      "Außerdem ungefragt geändert: Description: der diktierte Text, unverändert übernommen.",
    );
  });

  it("a text the user dictates in the change request counts as dictated", () => {
    const spokenText =
      "Bitte stimmen Sie das technische Layout der Linie 4 bis Mitte Januar mit Frau Müller ab und bringen Sie die Zeichnungen der Fördertechnik mit.";
    const result = difference(
      withText(callOf(CARDS.create), OLD),
      withText(callOf(CARDS.create), spokenText),
      `Nimm als Beschreibung: ${spokenText}`,
      [],
    );
    expect(result.pieces.map((piece) => piece.text)).toContain(
      "Geändert: Description: der diktierte Text, unverändert übernommen.",
    );
  });

  it("an unchanged text stays unsaid, whatever its origin", () => {
    const dictated = [{ passages: [OLD] }];
    const before = withText(callOf(CARDS.create), OLD);
    const after = withText(callOf(CARDS.create), OLD);
    const result = difference(before, after, "passt so", dictated);
    expect(result.intro).toBe("same");
    expect(
      result.pieces.some((piece) => piece.text.includes("diktierte")),
    ).toBe(false);
  });

  it("a text changed away from the dictation is never called unchanged", () => {
    const dictated = [{ passages: [OLD] }];
    const before = withText(callOf(CARDS.create), OLD);
    const after = withText(callOf(CARDS.create), OLD.replace("12.", "14."));
    const texts = difference(before, after, "nimm den 14.", dictated, "en")
      .pieces.map((piece) => piece.text)
      .join(" ");
    expect(texts).toContain("the dictated text, changed in places");
    expect(texts).not.toContain("unchanged");
  });
});
