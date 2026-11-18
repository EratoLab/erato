import { describe, expect, it } from "vitest";

import {
  dictatedPassages,
  userTurnOf,
  dictationKey,
  dictationOf,
} from "./spokenDictation";

import type { DictationRelation, UserTurn } from "./spokenDictation";

const GERMAN =
  "Hallo Frau Müller, danke für das Gespräch heute. Wie besprochen schicken wir Ihnen bis zum 15. Januar das Angebot für den Umbau der Linie 4. Die Stillstandszeit schätzen wir auf drei Tage. Viele Grüße";
const ENGLISH =
  "Hello Ms Miller, thank you for the call today. As agreed we will send you the offer for the retrofit of line 4 by 15 January. We estimate the downtime at three days. Best regards";

/** A turn the user dictated whole, or with typed words between its passages. */
const turn = (...passages: string[]): UserTurn => ({
  text: passages.join(" "),
  passages,
  whole: passages.length === 1,
});
/** A message the user typed. */
const typed = (text: string): UserTurn => ({
  text,
  passages: [],
  whole: false,
});

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
    card: (text) => `„${text.replace(" ", " \u2013 ")}“`,
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
    // Most of it is not the user's: it is named by its size.
    expected: undefined,
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

  it("compares with the latest dictation, not one the user corrected since", () => {
    const corrected = GERMAN.replace("15.", "16.");
    // The card still holds the first version, word for word.
    expect(dictationOf(GERMAN, [turn(corrected), turn(GERMAN)])).toBe(
      "changed",
    );
    expect(
      dictationOf(GERMAN, [
        turn(`Nein, schreib: ${corrected}`),
        turn(`Schreib: ${GERMAN}`),
      ]),
    ).toBe("changed");
    // A later message about something else leaves the earlier one.
    expect(
      dictationOf(GERMAN, [
        turn(
          "Danach noch eine Aufgabe: Reifen wechseln lassen, Werkstatt anrufen, Termin eintragen.",
        ),
        typed("Ja, genau so."),
        turn(GERMAN),
      ]),
    ).toBe("unchanged");
  });

  it("a later message that may correct the text, dictated or typed, leaves it unnamed", () => {
    for (const later of [
      typed("Nein, 16. Mai"),
      turn("Nicht Müller, sondern Möller"),
      typed("Statt drei Tagen bitte vier"),
    ]) {
      expect(dictationOf(GERMAN, [later, turn(GERMAN)]), later.text).toBe(
        undefined,
      );
    }
  });

  it("a heavy rewrite of an earlier dictation leaves the card unnamed rather than unchanged", () => {
    const sentences = GERMAN.split(/(?<=\.) /);
    const rewrite = [
      sentences[0],
      "Das Angebot kommt erst im Februar, weil die Zeichnungen fehlen.",
      sentences[3],
    ].join(" ");
    expect(dictationOf(GERMAN, [turn(rewrite), turn(GERMAN)])).toBeUndefined();
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
    expect(dictationOf(GERMAN, [turn(`Bitte notiere: ${GERMAN}`)])).toBe(
      "unchanged",
    );
    expect(dictationOf(GERMAN, [turn(`Okay, schreib Anna: ${GERMAN}`)])).toBe(
      "unchanged",
    );
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

  it("a clause before a colon that is not an instruction is part of the dictation", () => {
    const text =
      "Der Kunde Maier bekommt ab Januar 15 Prozent Rabatt auf alle Lizenzen.";
    for (const clause of [
      "Hinweis für Anna, nicht für Max:",
      "Liebe Frau Maier, anbei die Punkte für morgen:",
      "Das gilt ausdrücklich nicht, bitte ignorieren:",
      "Anna:",
      "Note:",
    ]) {
      expect(dictationOf(text, [turn(`${clause} ${text}`)]), clause).toBe(
        "part",
      );
    }
  });

  it("a long text that only quotes the dictation is named by its size", () => {
    const said =
      "Schreib eine Mail an Herrn Maier und sag ihm: Wir verschieben das Treffen auf nächsten Dienstag um zehn.";
    const mail = `Sehr geehrter Herr Maier, ich hoffe, es geht Ihnen gut und die Woche hat gut angefangen. Ich melde mich wegen unseres geplanten Treffens zur Abstimmung der nächsten Projektphase. Wir verschieben das Treffen auf nächsten Dienstag um zehn. Der Grund ist, dass einige Unterlagen aus der Konstruktion noch nicht vollständig vorliegen und wir die Zeit nutzen möchten, um Ihnen eine vollständige Übersicht vorzulegen. Bitte geben Sie mir kurz Bescheid, ob der neue Termin für Sie passt, oder schlagen Sie gern eine Alternative vor. Für Rückfragen stehe ich Ihnen jederzeit zur Verfügung. Mit freundlichen Grüßen`;
    expect(dictationOf(mail, [turn(said)])).toBeUndefined();
  });

  it("typed words in the dictated message make the dictation only a part", () => {
    const dictated =
      "Wir kommen am Freitag mit dem ganzen Team zur Feier und bringen Salat mit.";
    const sent = `${dictated} Aber nicht Anna, sie ist krank.`;
    const withTyped = userTurnOf(sent, [dictated]);
    expect(withTyped).toEqual({
      text: sent,
      passages: [dictated],
      whole: false,
    });
    expect(dictationOf(dictated, [withTyped])).toBe("part");
    const spoken = userTurnOf(dictated, [dictated]);
    expect(spoken).toEqual({
      text: dictated,
      passages: [dictated],
      whole: true,
    });
    expect(dictationOf(dictated, [spoken])).toBe("unchanged");
  });

  it("compares words: case, edge punctuation and spacing only", () => {
    expect(dictationKey("  „Hallo“,   WELT!\n")).toBe("hallo welt");
    // Signs that change a value stay.
    expect(dictationKey("20 % und -5 € (+3)")).toBe("20 % und -5 € +3");
    expect(dictationKey("1.000")).not.toBe(dictationKey("1000"));
    expect(dictationKey("3,5")).not.toBe(dictationKey("3.5"));
    expect(dictationKey("E-Mail")).not.toBe(dictationKey("E Mail"));
    expect(dictationKey("Straße")).not.toBe(dictationKey("Strasse"));
    expect(dictationKey("ab\u00adgestimmt")).toBe(dictationKey("abgestimmt"));
    // The repo's list of invisible characters, marks for the text's direction too.
    expect(dictationKey("Mai\u200eer")).toBe("maier");
  });

  it("never drops a sign or a character that carries a value", () => {
    for (const [a, b] of [
      ["Temperatur \u20135 Grad", "Temperatur 5 Grad"],
      ["Temperatur \u20145 Grad", "Temperatur 5 Grad"],
      ["Temperatur \u22125 Grad", "Temperatur 5 Grad"],
      ["Temperatur -5 Grad", "Temperatur 5 Grad"],
      ["Fläche 10\u00b2 Meter", "Fläche 102 Meter"],
      ["\u00bd Liter", "1/2 Liter"],
      ["\uff11\uff15 Stück", "15 Stück"],
    ]) {
      expect(dictationKey(a), a).not.toBe(dictationKey(b));
    }
    // A dash between words is punctuation.
    expect(dictationKey("Montag \u2013 Dienstag")).toBe(
      dictationKey("Montag Dienstag"),
    );
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
  "10\u00b2",
  "102",
  "\u20135",
  "-5",
  "\u22125",
];
const NOISE = [",", ".", "!", "?", "…", ";", "\u2013", "„", "“", "(", ")"];

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

/** Clauses before a colon: instructions to the assistant, or part of the text. */
const INSTRUCTIONS = [
  ["Schreib", "dem", "Kunden:"],
  ["Nein,", "schreib:"],
  ["Bitte", "notiere:"],
  ["Write", "to", "them:"],
];
const CONTENT_OPENERS = ["Hinweis", "Anna,", "Liebe", "Nicht", "Achtung,"];
/** Words no generated text shares with the others. */
const UNRELATED = [
  "Reifen",
  "Werkstatt",
  "anrufen",
  "morgen",
  "Garten",
  "Blumen",
  "Katze",
  "Brot",
  "kaufen",
];

interface Dictation {
  lead: Words;
  instruction: boolean;
  content: Words;
  related: boolean;
  /** A short correction the user typed: what it asks for is not known here. */
  typed?: boolean;
}

const leadOf = (
  random: ReturnType<typeof generator>,
): Pick<Dictation, "lead" | "instruction"> => {
  switch (random.int(3)) {
    case 0:
      return { lead: [], instruction: false };
    case 1:
      return { lead: random.pick(INSTRUCTIONS), instruction: true };
    default: {
      const words = [
        random.pick(CONTENT_OPENERS),
        ...Array.from({ length: random.int(4) }, () => random.pick(VOCABULARY)),
      ];
      words[words.length - 1] = `${words[words.length - 1]}:`;
      return { lead: words, instruction: false };
    }
  }
};

const changed = (
  words: Words,
  count: number,
  random: ReturnType<typeof generator>,
): Words => {
  let result = words;
  for (let change = 0; change < count; change++) {
    result = random.pick(REAL_CHANGES)(result, random);
  }
  return result;
};

describe("'unchanged' is never said over a difference (generated)", () => {
  it("holds for every generated chat and card", () => {
    const random = generator(20_261_118);
    const counts: Partial<Record<string, number>> = {};
    for (let run = 0; run < 4_000; run++) {
      const base = Array.from({ length: 8 + random.int(50) }, () =>
        random.pick(VOCABULARY),
      );
      // The chat's dictations, oldest first: the text, perhaps a correction
      // of it, perhaps something else said later.
      const dictations: Dictation[] = [
        { ...leadOf(random), content: base, related: true },
      ];
      if (random.int(2) === 0) {
        dictations.push({
          ...leadOf(random),
          content: changed(base, 1 + random.int(3), random),
          related: true,
        });
      }
      if (random.int(3) === 0) {
        dictations.push({
          lead: [],
          instruction: false,
          content: Array.from({ length: 8 + random.int(12) }, () =>
            random.pick(UNRELATED),
          ),
          related: false,
        });
      }
      if (random.int(3) === 0) {
        dictations.push({
          lead: [],
          instruction: false,
          content: ["Ja,", "genau", "so."],
          related: false,
        });
      }
      if (random.int(4) === 0) {
        dictations.push({
          lead: [],
          instruction: false,
          content: ["Nein,", random.pick(["16.", "4", "1000", "20 %"])],
          related: true,
          typed: true,
        });
      }
      const source = random.pick(
        dictations.filter((entry) => entry.related && entry.typed !== true),
      );
      const changes = random.int(3);
      const card = noise(changed(source.content, changes, random), random).join(
        random.pick([" ", "  ", "\n"]),
      );
      const turns = [...dictations]
        .reverse()
        .map((entry) =>
          entry.typed === true
            ? typed(entry.content.join(" "))
            : turn([...entry.lead, ...entry.content].join(" ")),
        );
      const relation = dictationOf(card, turns);
      counts[relation ?? "none"] = (counts[relation ?? "none"] ?? 0) + 1;

      // What the user last asked for: their latest dictation of this text,
      // without an instruction before it.
      const latest = dictations
        .filter((entry) => entry.related)
        .at(-1) as Dictation;
      const asked = latest.instruction
        ? latest.content
        : [...latest.lead, ...latest.content];
      const same =
        latest.typed !== true &&
        dictationKey(card) === dictationKey(asked.join(" "));
      const story = `${turns.map((entry) => entry.text).join("\n")}\n→ ${card}`;
      if (relation === "unchanged") expect(same, story).toBe(true);
      if (same && changes === 0 && source === latest) {
        expect(relation, story).toBe("unchanged");
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

  it("a word lengthened by typing is no longer as heard", () => {
    expect(
      dictatedPassages("Wir zahlen den vereinbarten Betrag von 150 Euro.", [
        "Wir zahlen den vereinbarten Betrag von 15",
      ]),
    ).toEqual([]);
    expect(
      dictatedPassages("Wir zahlen den Betrag von 15 Euro.", [
        "Wir zahlen den Betrag von 15",
      ]),
    ).toEqual(["Wir zahlen den Betrag von 15"]);
  });

  it("a typed message has no dictated words", () => {
    expect(dictatedPassages("Leg eine Aufgabe an.", [])).toEqual([]);
  });
});
