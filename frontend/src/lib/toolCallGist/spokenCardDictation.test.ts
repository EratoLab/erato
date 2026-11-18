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
import type { UserTurn } from "./spokenDictation";
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

// The set's labels carry the spoken vocabulary; these tests are about the
// dictation, with the card's own names. `spokenNames.test.ts` covers the
// vocabulary.
const callOf = (id: string): SetCall => {
  const call = calls.find((entry) => entry.id === id);
  if (!call) throw new Error(`no call ${id}`);
  const copy = JSON.parse(JSON.stringify(call)) as SetCall;
  delete (copy.display.label as unknown as Record<string, unknown>)
    .spoken_names;
  return copy;
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
  dictated?: readonly UserTurn[],
) =>
  inLanguage(language, () =>
    spokenApprovalPieces(approvalOf(call), {
      language,
      ...OPTIONS,
      userTurns: dictated,
    }),
  );

const textPiece = (pieces: readonly SpokenPiece[]) => {
  const piece = pieces.find((entry) => entry.role === "text");
  if (!piece) throw new Error("no text piece");
  return piece;
};

/** A message the user dictated whole. */
const said = (text: string): UserTurn => ({
  text,
  passages: [text],
  whole: true,
});

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
    unchanged: /^[\w ]+: the text exactly as dictated\.$/,
    part: /^[\w ]+: part of the dictated text, word for word\.$/,
    extended: /^[\w ]+: the dictated text word for word, with additions\.$/,
    changed: /^[\w ]+: the dictated text, changed in places\.$/,
    size: /^[\w ]+: a text of about \d+ words, shown on screen\.$/,
  },
};

/** Where the words came from, as the chat holds them before the card. */
const ORIGINS: Record<
  string,
  {
    turns: (base: string) => UserTurn[];
    /** `latest`: dictated in the user's last message; `earlier`: something came after. */
    dictated: "latest" | "earlier" | false;
  }
> = {
  dictated_in_the_last_turn: {
    turns: (base) => [said(`Schreib dazu folgenden Text: ${base}`)],
    dictated: "latest",
  },
  dictated_in_an_earlier_turn: {
    turns: (base) => [said("Ja, genau so."), said(base)],
    dictated: "earlier",
  },
  // A typed message never lands in the record of dictated words.
  typed: {
    turns: (base) => [{ text: base, passages: [], whole: false }],
    dictated: false,
  },
  not_from_the_user: {
    turns: () => [
      said("Fass das Gespräch von gestern für den Kunden zusammen."),
    ],
    dictated: false,
  },
};

/**
 * What the voice says: after anything said since the dictation, only a
 * change is told; a word-for-word claim falls back to the size.
 */
const expectedSaid = (dictated: "latest" | "earlier" | false, says: Says) =>
  !dictated || (dictated === "earlier" && says !== "changed") ? "size" : says;

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
              SAID[language][expectedSaid(dictated, says)],
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
      const named = piecesOf(call, "de", [said(base)]);
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
      piecesOf(withText(callOf(CARDS.create), base), "de", [said(base)]),
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
    const piece = textPiece(piecesOf(call, "de", [said(text.text)]));
    expect(piece.text).toMatch(SAID.de.size);
  });
});

describe("what the user said last decides", () => {
  const BASE = baseOf(CARDS.create);
  const CORRECTED = BASE.replace("12. Dezember", "16. Dezember");

  it("a card holding a dictation the user corrected since is not unchanged", () => {
    for (const language of ["de", "en"] as const) {
      const piece = textPiece(
        piecesOf(withText(callOf(CARDS.create), BASE), language, [
          said(`Schreib: ${CORRECTED}`),
          said(`Schreib: ${BASE}`),
        ]),
      );
      expect(piece.text).toMatch(SAID[language].changed);
    }
  });

  it("nor after a spoken change request that corrected it", () => {
    const before = withText(
      callOf(CARDS.create),
      BASE.replace(" bis ", " ab "),
    );
    const after = withText(callOf(CARDS.create), BASE);
    const dictated = [said(`Schreib: ${BASE}`)];
    const heard = piecesOf(before, "de", dictated).map((piece) => piece.id);
    const result = inLanguage("de", () =>
      spokenDifference(
        {
          approval: approvalOf(before),
          heard,
          words: `Nein, schreib: ${CORRECTED}`,
        },
        approvalOf(after),
        { language: "de", ...OPTIONS, userTurns: dictated },
      ),
    );
    const spoken = result.pieces.map((piece) => piece.text).join(" ");
    expect(spoken).toContain("der diktierte Text, an einigen Stellen geändert");
    expect(spoken).not.toContain("unverändert");
  });

  it("a long text that only quotes the dictation is named by its size", () => {
    const quoted = "Wir verschieben das Treffen auf nächsten Dienstag um zehn.";
    const mail = `Sehr geehrter Herr Maier, ich hoffe, es geht Ihnen gut. Ich melde mich wegen unseres geplanten Treffens zur nächsten Projektphase. ${quoted} Einige Unterlagen aus der Konstruktion liegen noch nicht vollständig vor, und wir möchten Ihnen eine vollständige Übersicht vorlegen. Bitte geben Sie mir Bescheid, ob der Termin passt. Mit freundlichen Grüßen`;
    const piece = textPiece(
      piecesOf(withText(callOf(CARDS.send), mail), "de", [
        said(`Schreib Herrn Maier und sag ihm: ${quoted}`),
      ]),
    );
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
      [said(base)],
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
    dictated: readonly UserTurn[],
    language = "de",
  ) => {
    const heard = piecesOf(before, language, dictated).map((piece) => piece.id);
    return inLanguage(language, () =>
      spokenDifference(
        { approval: approvalOf(before), heard, words },
        approvalOf(after),
        { language, ...OPTIONS, userTurns: dictated },
      ),
    );
  };

  it("after a change request, an earlier dictation is not claimed word for word", () => {
    const dictated = [said(OLD)];
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
    // The request is the user's latest turn: the text is still told as
    // changed, named by its size.
    expect(texts.join(" ")).toMatch(
      /geändert: Description: ein Text von etwa \d+ Wörtern/,
    );
    expect(texts.join(" ")).not.toContain("unverändert");
  });

  it("a text the user dictates in the change request counts as dictated", () => {
    const spokenText =
      "Bitte stimmen Sie das technische Layout der Linie 4 bis Mitte Januar mit Frau Müller ab und bringen Sie die Zeichnungen der Fördertechnik mit.";
    const result = difference(
      withText(callOf(CARDS.create), OLD),
      withText(callOf(CARDS.create), spokenText),
      `Nein, schreib: ${spokenText}`,
      [],
    );
    expect(result.pieces.map((piece) => piece.text)).toContain(
      "Geändert: Description: der diktierte Text, unverändert übernommen.",
    );
  });

  it("an unchanged text stays unsaid, whatever its origin", () => {
    const dictated = [said(OLD)];
    const before = withText(callOf(CARDS.create), OLD);
    const after = withText(callOf(CARDS.create), OLD);
    const result = difference(before, after, "passt so", dictated);
    expect(result.intro).toBe("same");
    expect(
      result.pieces.some((piece) => piece.text.includes("diktierte")),
    ).toBe(false);
  });

  it("a text changed away from the dictation is never called unchanged", () => {
    const dictated = [said(OLD)];
    const before = withText(callOf(CARDS.create), OLD);
    const after = withText(callOf(CARDS.create), OLD.replace("12.", "14."));
    const texts = difference(before, after, "nimm den 14.", dictated, "en")
      .pieces.map((piece) => piece.text)
      .join(" ");
    // Changed from the earlier dictation: saying so claims no sameness.
    expect(texts).toContain("the dictated text, changed in places");
    expect(texts).not.toContain("exactly as dictated");
  });
});
