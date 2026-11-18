import { describe, expect, it } from "vitest";

import { dictatedPassages, dictationKey, dictationOf } from "./spokenDictation";

import type { DictatedTurn, DictationRelation } from "./spokenDictation";

const GERMAN =
  "Hallo Frau Müller, danke für das Gespräch heute. Wie besprochen schicken wir Ihnen bis zum 15. Januar das Angebot für den Umbau der Linie 4. Die Stillstandszeit schätzen wir auf drei Tage. Viele Grüße";
const ENGLISH =
  "Hello Ms Miller, thank you for the call today. As agreed we will send you the offer for the retrofit of line 4 by 15 January. We estimate the downtime at three days. Best regards";

const turn = (...passages: string[]): DictatedTurn => ({ passages });

/** How a model can hand back the text the user dictated, in both languages. */
const RELATIONS: Record<
  string,
  {
    card: (text: string, language: "de" | "en") => string;
    expected: DictationRelation | undefined;
  }
> = {
  identical: { card: (text) => text, expected: "unchanged" },
  punctuation_and_case: {
    card: (text) =>
      `  ${text.toLowerCase().replaceAll(",", "").replaceAll(". ", ".\n\n")}.`,
    expected: "unchanged",
  },
  quotes_and_dashes: {
    card: (text) => `„${text.replace(" ", " – ")}“`,
    expected: "unchanged",
  },
  one_word_changed: {
    card: (text, language) =>
      language === "de"
        ? text.replace("heute", "gestern")
        : text.replace("today", "yesterday"),
    expected: "changed",
  },
  number_changed: {
    card: (text) => text.replace("15", "16"),
    expected: "changed",
  },
  number_written_out: {
    card: (text) => text.replace(" 4", " vier"),
    expected: "changed",
  },
  name_changed: {
    card: (text, language) =>
      language === "de"
        ? text.replace("Müller", "Möller")
        : text.replace("Miller", "Millar"),
    expected: "changed",
  },
  word_dropped_inside: {
    card: (text, language) =>
      language === "de"
        ? text.replace("Wie besprochen ", "")
        : text.replace("As agreed ", ""),
    expected: "changed",
  },
  end_dropped: {
    card: (text, language) =>
      language === "de"
        ? text.replace(" Viele Grüße", "")
        : text.replace(" Best regards", ""),
    expected: "part",
  },
  start_dropped: {
    card: (text, language) =>
      language === "de"
        ? text.replace("Hallo Frau Müller, ", "")
        : text.replace("Hello Ms Miller, ", ""),
    expected: "part",
  },
  greeting_added: {
    card: (text, language) =>
      language === "de"
        ? `${text}, Daniel Person, Vertrieb`
        : `${text}, Daniel Person, Sales`,
    expected: "extended",
  },
  quoted_in_a_longer_text: {
    card: (text, language) =>
      language === "de"
        ? `Zusammenfassung des Anrufs vom Dienstag. Der Kunde hat nach dem Termin gefragt und wir haben folgende Antwort geschickt: ${text} Offen bleibt die Frage nach der Schulung für das Personal der Instandhaltung.`
        : `Summary of Tuesday's call. The customer asked about the date and we sent this answer: ${text} Still open is the training for the maintenance staff.`,
    expected: "extended",
  },
  paragraph_inserted: {
    card: (text, language) =>
      language === "de"
        ? text.replace(
            "Die Stillstandszeit",
            "Die Zeichnungen kommen bis Ende November. Die Stillstandszeit",
          )
        : text.replace(
            "We estimate",
            "The drawings arrive by the end of November. We estimate",
          ),
    expected: "changed",
  },
  sentences_reordered: {
    card: (text) => {
      const sentences = text.split(/(?<=\.) /);
      return [sentences[1], sentences[0], ...sentences.slice(2)].join(" ");
    },
    expected: "changed",
  },
  two_words_swapped: {
    card: (text, language) =>
      language === "de"
        ? text.replace("drei Tage", "Tage drei")
        : text.replace("three days", "days three"),
    expected: "changed",
  },
  rewritten: {
    card: (_, language) =>
      language === "de"
        ? "Sehr geehrte Frau Müller, vielen Dank für Ihre Zeit. Unser Angebot erhalten Sie Mitte Januar, rechnen Sie mit einem Stillstand von etwa drei Tagen. Mit freundlichen Grüßen"
        : "Dear Ms Miller, many thanks for your time. You will get our offer in mid January; please plan for about three days of downtime. Kind regards",
    expected: undefined,
  },
  translated: {
    card: (_, language) => (language === "de" ? ENGLISH : GERMAN),
    expected: undefined,
  },
};

const BASES = { de: GERMAN, en: ENGLISH } as const;
const LEAD_INS = {
  de: "Schreib Frau Müller:",
  en: "Write to Ms Miller:",
} as const;

describe("a card's text against what the user dictated", () => {
  for (const language of ["de", "en"] as const) {
    const base = BASES[language];
    for (const [name, { card, expected }] of Object.entries(RELATIONS)) {
      it(`${language}: ${name} is ${expected ?? "not called dictated"}`, () => {
        const text = card(base, language);
        // The dictation as said, with what to do before the text.
        expect(dictationOf(text, [turn(`${LEAD_INS[language]} ${base}`)])).toBe(
          expected,
        );
      });
    }
  }

  it("finds the dictation in an earlier turn, not only the last one", () => {
    const turns = [turn("Ja, genau so. Und setz Anna in Kopie."), turn(GERMAN)];
    expect(dictationOf(GERMAN, turns)).toBe("unchanged");
  });

  it("prefers the turn the text is word for word", () => {
    const changed = GERMAN.replace("heute", "gestern");
    expect(dictationOf(GERMAN, [turn(changed), turn(GERMAN)])).toBe(
      "unchanged",
    );
  });

  it("a text nobody dictated is not called dictated", () => {
    expect(dictationOf(GERMAN, [])).toBeUndefined();
    expect(
      dictationOf(GERMAN, [turn("Leg bitte eine Aufgabe für Frau Müller an.")]),
    ).toBeUndefined();
  });

  it("a short dictation inside a long text is chance, not the dictation", () => {
    expect(
      dictationOf(`${GERMAN} Danke.`, [turn("bis zum 15. Januar")]),
    ).toBeUndefined();
  });

  it("words before the text count as an instruction only as a short clause ending in a colon", () => {
    expect(dictationOf(GERMAN, [turn(`Notiere: ${GERMAN}`)])).toBe("unchanged");
    // Without the colon, the words may be part of the text.
    expect(dictationOf(GERMAN, [turn(`Notiere ${GERMAN}`)])).toBe("part");
    // A sentence before it may have been part of the text.
    expect(
      dictationOf(GERMAN, [
        turn(`Wir hatten ein Gespräch. Notiere: ${GERMAN}`),
      ]),
    ).toBe("part");
    // Words after the text may have been part of it.
    expect(
      dictationOf(GERMAN, [turn(`Notiere: ${GERMAN}. Und schick sie ab.`)]),
    ).toBe("part");
  });

  it("compares words: case, edge punctuation and spacing only", () => {
    expect(dictationKey("  „Hallo“,   WELT!\n")).toBe("hallo welt");
    // Signs that change a value stay.
    expect(dictationKey("20 % und -5 € (+3)")).toBe("20 % und -5 € +3");
    expect(dictationKey("1.000")).not.toBe(dictationKey("1000"));
    expect(dictationKey("3,5")).not.toBe(dictationKey("3.5"));
    expect(dictationKey("E-Mail")).not.toBe(dictationKey("E Mail"));
    expect(dictationKey("Straße")).not.toBe(dictationKey("Strasse"));
    expect(dictationKey("ab­gestimmt")).toBe(dictationKey("abgestimmt"));
  });
});

/** A small seeded generator, so a failure can be run again. */
const generator = (seed: number) => {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
  return {
    next,
    int: (below: number) => Math.floor(next() * below),
    pick: <T>(values: readonly T[]): T =>
      values[Math.floor(next() * values.length)],
  };
};

const VOCABULARY = [
  "wir",
  "Sie",
  "sie",
  "Angebot",
  "Termin",
  "Linie",
  "4",
  "5",
  "15.",
  "16.",
  "Januar",
  "Februar",
  "Müller",
  "Möller",
  "Schmidt",
  "nicht",
  "doch",
  "schicken",
  "prüfen",
  "Stillstand",
  "drei",
  "vier",
  "Tage",
  "Euro",
  "20 %",
  "the",
  "offer",
  "not",
  "line",
  "1.000",
  "1000",
  "E-Mail",
  "und",
  "oder",
];
const NOISE = [",", ".", "!", "?", "…", ";", "–", "„", "“", "(", ")"];

type Words = string[];

const noise = (words: Words, random: ReturnType<typeof generator>): Words =>
  words.map((word) => {
    switch (random.int(5)) {
      case 0:
        return word.toLowerCase();
      case 1:
        return word.toUpperCase() === word.toLowerCase()
          ? word
          : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      case 2:
        return `${word}${random.pick(NOISE)}`;
      case 3:
        return `${random.pick(["„", "(", "“"])}${word}`;
      default:
        return word;
    }
  });

/** A change to the words that a listener must hear as one. */
const REAL_CHANGES: ((
  words: Words,
  random: ReturnType<typeof generator>,
) => Words)[] = [
  (words, random) => {
    const at = random.int(words.length);
    const other = VOCABULARY.filter(
      (word) => dictationKey(word) !== dictationKey(words[at]),
    );
    return words.map((word, index) =>
      index === at ? random.pick(other) : word,
    );
  },
  (words, random) =>
    words.filter((_, index) => index !== random.int(words.length)),
  (words, random) => {
    const at = random.int(words.length + 1);
    return [...words.slice(0, at), random.pick(VOCABULARY), ...words.slice(at)];
  },
  (words, random) => {
    const swappable = words
      .map((_, index) => index)
      .filter(
        (index) =>
          index + 1 < words.length &&
          dictationKey(words[index]) !== dictationKey(words[index + 1]),
      );
    if (swappable.length === 0) return [...words, "doch"];
    const at = random.pick(swappable);
    const swapped = [...words];
    [swapped[at], swapped[at + 1]] = [swapped[at + 1], swapped[at]];
    return swapped;
  },
];

describe("'unchanged' is never said over a difference (generated)", () => {
  it("holds for every generated dictation and card", () => {
    const random = generator(20_261_118);
    const counts: Partial<Record<string, number>> = {};
    for (let run = 0; run < 3_000; run++) {
      const content = Array.from({ length: 8 + random.int(50) }, () =>
        random.pick(VOCABULARY),
      );
      const leadIn = random.int(2) === 0 ? ["Schreib", "dem", "Kunden:"] : [];
      const dictated = [...leadIn, ...content].join(" ");
      const changes = random.int(3);
      let words = content;
      for (let change = 0; change < changes; change++) {
        words = random.pick(REAL_CHANGES)(words, random);
      }
      const card = noise(words, random).join(random.pick([" ", "  ", "\n"]));
      const relation = dictationOf(card, [turn(dictated)]);
      counts[relation ?? "none"] = (counts[relation ?? "none"] ?? 0) + 1;
      const same = dictationKey(card) === dictationKey(content.join(" "));
      if (relation === "unchanged") {
        expect(same, `${dictated}\n→ ${card}`).toBe(true);
      }
      if (same && changes === 0) {
        expect(relation, `${dictated}\n→ ${card}`).toBe("unchanged");
      }
    }
    // The generator reaches every answer, so the check above is not empty.
    expect(Object.keys(counts).sort()).toEqual([
      "changed",
      "extended",
      "none",
      "part",
      "unchanged",
    ]);
  });
});

describe("which words of a sent message were dictated", () => {
  it("a message sent as heard is dictated whole", () => {
    expect(
      dictatedPassages("Schreib dem Kunden: Hallo zusammen.", [
        "Schreib dem Kunden:",
        "Hallo zusammen.",
      ]),
    ).toEqual(["Schreib dem Kunden: Hallo zusammen."]);
  });

  it("typed words split the dictation, and are not part of it", () => {
    expect(
      dictatedPassages("Notiz für Anna: Termin am Montag verschoben.", [
        "Termin am Montag verschoben.",
      ]),
    ).toEqual(["Termin am Montag verschoben."]);
    expect(
      dictatedPassages("Erster Teil, getippt, zweiter Teil", [
        "Erster Teil,",
        "zweiter Teil",
      ]),
    ).toEqual(["Erster Teil,", "zweiter Teil"]);
  });

  it("a transcript edited before sending is no longer dictated", () => {
    expect(
      dictatedPassages("Termin am Dienstag verschoben.", [
        "Termin am Montag verschoben.",
      ]),
    ).toEqual([]);
  });

  it("a typed message has no dictated words", () => {
    expect(dictatedPassages("Leg eine Aufgabe an.", [])).toEqual([]);
  });
});
