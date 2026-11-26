import { writeFileSync } from "node:fs";

import { i18n } from "@lingui/core";
import { describe, expect, it } from "vitest";

import { messages as deMessages } from "@/locales/de/messages.json";

import data from "./fixtures/spokenCards/calls.json";
import variantCases from "./fixtures/spokenSentenceVariants.json";
import {
  sameSpokenKind,
  spokenApprovalFor,
  spokenApprovalPieces,
  spokenUtteranceSentences,
} from "./spokenCard";
import { spokenCardFlow, spokenCardStep } from "./spokenCardFlow";
import {
  fillVariant,
  naturalVariant,
  usableVariant,
  variantProblem,
} from "./spokenSentences";

import type { SpokenApproval, SpokenOptions, SpokenPiece } from "./spokenCard";
import type { SpokenCardFlow } from "./spokenCardFlow";
import type { SentenceSet } from "./spokenSentences";
import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

interface SetCall {
  id: string;
  tool_name: string;
  input: unknown;
  display: { title: string; server_name?: string | null; label?: unknown };
}
interface Scenario {
  id: string;
  approval_kind?: string;
  shape?: string;
  calls: string[];
}

const { calls, scenarios } = data as unknown as {
  calls: SetCall[];
  scenarios: Scenario[];
};
const NOW = new Date("2026-11-17T09:00:00Z");
const ZONE = "Europe/Berlin";
const LANGUAGES = ["de", "en"];

i18n.load({ de: deMessages as unknown as Messages });

const inLanguage = <T>(language: string, compose: () => T): T => {
  const previous = i18n.locale;
  i18n.activate(language);
  try {
    return compose();
  } finally {
    i18n.activate(previous);
  }
};

const approvalOf = (call: SetCall, kind = "mcp_tool"): SpokenApproval =>
  spokenApprovalFor(kind, {
    tool_name: call.tool_name,
    input: call.input,
    display: {
      title: call.display.title,
      server_name: call.display.server_name,
      label: call.display.label as ToolCallLabel | undefined,
    },
  });

type Style = Pick<SpokenOptions, "amount" | "shortDetails" | "wording"> & {
  /** A deployment's own sentence variants, per language. */
  deployment?: Record<string, SentenceSet>;
};

/** Sentences a deployment might write, with every slot as the check wants. */
const DEPLOYMENT: Record<string, SentenceSet> = {
  de: {
    changed: "{field} geht {from} {to}.",
    set: "{field} lautet {value}.",
    updated: "{field} wird {value} gesetzt.",
  },
  en: {
    changed: "{field} goes {from} {to}.",
    set: "{field} reads {value}.",
    updated: "{field} will be set {value}.",
  },
};

/** The four combinations the listening set is written for. */
const LISTENED = [
  "precise, full",
  "precise, short",
  "natural, full",
  "natural, short",
];
const STYLES: Record<string, Style> = {
  "precise, full": { amount: "full", wording: "precise" },
  "precise, short": { amount: "short", shortDetails: 1, wording: "precise" },
  "natural, full": { amount: "full", wording: "natural" },
  "natural, short": { amount: "short", shortDetails: 1, wording: "natural" },
  "precise, short 0": { amount: "short", shortDetails: 0, wording: "precise" },
  "natural, short 2": { amount: "short", shortDetails: 2, wording: "natural" },
  "precise, short 3": { amount: "short", shortDetails: 3, wording: "precise" },
  "natural, short 99": {
    amount: "short",
    shortDetails: 99,
    wording: "natural",
  },
  "deployment, full": {
    amount: "full",
    wording: "natural",
    deployment: DEPLOYMENT,
  },
  "deployment, short": {
    amount: "short",
    shortDetails: 1,
    wording: "natural",
    deployment: DEPLOYMENT,
  },
};
const SHORT = Object.keys(STYLES).filter(
  (name) => STYLES[name].amount === "short",
);

const cardsOf = (scenario: Scenario, language: string, style: Style) => {
  const approvals =
    scenario.calls.length > 0
      ? scenario.calls.map((id) =>
          approvalOf(
            calls.find((call) => call.id === id) as SetCall,
            scenario.approval_kind,
          ),
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
        amount: style.amount,
        shortDetails: style.shortDetails,
        wording: style.wording,
        sentences: style.deployment?.[language],
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

const all = scenarios.flatMap((scenario) =>
  LANGUAGES.flatMap((language) => {
    const styled = Object.fromEntries(
      Object.entries(STYLES).map(([name, style]) => [
        name,
        cardsOf(scenario, language, style),
      ]),
    );
    return styled["precise, full"].map((_, index) => ({
      where: `${scenario.id} ${language} #${index}`,
      scenario: scenario.id,
      language,
      cards: Object.fromEntries(
        Object.entries(styled).map(([name, cards]) => [name, cards[index]]),
      ),
    }));
  }),
);

/** What a reading says from its start to its end, without any request. */
const reading = (pieces: SpokenPiece[], language: string): string[] => {
  let flow: SpokenCardFlow = spokenCardStep(pieces, spokenCardFlow(pieces), {
    type: "start",
  });
  const said: string[] = [];
  for (let guard = 0; flow.playing !== null && guard < 50; guard += 1) {
    said.push(
      ...inLanguage(language, () =>
        spokenUtteranceSentences(flow.playing!, pieces, {
          language,
          now: NOW,
        }),
      ),
    );
    flow = spokenCardStep(pieces, flow, { type: "finished" });
  }
  return said;
};

describe("every combination of the two settings, over the whole card set", () => {
  it("has the same pieces: ids, roles, order, must-say and values", () => {
    for (const { where, cards } of all) {
      const shape = (pieces: SpokenPiece[]) =>
        pieces.map(({ id, role, mustSay, values, readOut }) => ({
          id,
          role,
          mustSay,
          values,
          readOut,
        }));
      const precise = shape(cards["precise, full"]);
      for (const [name, pieces] of Object.entries(cards))
        expect(shape(pieces), `${where} ${name}`).toEqual(precise);
    }
  });

  it("says must-say pieces, the item and the request in their precise words and never holds them back", () => {
    for (const { where, cards } of all) {
      const precise = cards["precise, full"];
      for (const [name, pieces] of Object.entries(cards)) {
        pieces.forEach((piece, index) => {
          if (
            piece.mustSay ||
            ["item", "request", "consequence", "outside", "count"].includes(
              piece.role,
            )
          ) {
            expect(piece.text, `${where} ${name} ${piece.id}`).toBe(
              precise[index].text,
            );
            expect(piece.held, `${where} ${name} ${piece.id}`).toBeUndefined();
          }
        });
      }
    }
  });

  it("holds nothing back in a full reading, and the precise one is today's card", () => {
    for (const { where, cards } of all) {
      for (const name of ["precise, full", "natural, full", "deployment, full"])
        expect(
          cards[name].filter((piece) => piece.held !== undefined),
          `${where} ${name}`,
        ).toEqual([]);
    }
  });

  it("in a short reading says how much it holds back, and the rest says it", () => {
    let shortened = 0;
    for (const { where, language, cards } of all) {
      for (const name of SHORT) {
        const pieces = cards[name];
        const held = pieces.filter((piece) => piece.held !== undefined);
        const said = reading(pieces, language);
        // No held piece is said in the reading itself.
        for (const piece of held) expect(said, where).not.toContain(piece.text);
        if (held.length === 0) continue;
        shortened += 1;
        // A sentence says how many, before the consequence and the request.
        const announced = said.filter(
          (sentence) => !pieces.some((piece) => piece.text === sentence),
        );
        expect(announced.length, `${where} ${name}: ${said.join(" | ")}`).toBe(
          1,
        );
        // Asking for the rest says every held piece.
        let flow: SpokenCardFlow = spokenCardFlow(pieces);
        flow = spokenCardStep(pieces, flow, { type: "start" });
        while (flow.playing !== null)
          flow = spokenCardStep(pieces, flow, { type: "finished" });
        flow = spokenCardStep(pieces, flow, { type: "rest" });
        const rest: number[] = [];
        for (let guard = 0; flow.playing !== null && guard < 50; guard += 1) {
          if (flow.playing.type === "piece") rest.push(flow.playing.index);
          flow = spokenCardStep(pieces, flow, { type: "finished" });
        }
        for (const piece of held)
          expect(rest, `${where} ${name} ${piece.id}`).toContain(
            pieces.indexOf(piece),
          );
      }
    }
    expect(shortened).toBeGreaterThan(100);
  });

  it("never holds back what tells the listener the card is not what they may expect", () => {
    let kept = 0;
    for (const { where, cards } of all) {
      const precise = cards["precise, full"];
      for (const name of SHORT)
        cards[name].forEach((piece, index) => {
          const unnamed = piece.values?.some(
            (source) =>
              source.value.kind === "unread" || source.value.kind === "id",
          );
          // An addition taken on the tool's word.
          const toolsWord = /laut Tool|the tool says/.test(precise[index].text);
          if (!unnamed && !toolsWord) return;
          kept += 1;
          expect(piece.held, `${where} ${name} ${piece.id}`).toBeUndefined();
        });
    }
    expect(kept).toBeGreaterThan(20);
  });

  it("names held-back conditions without 'further' when it says none of them", () => {
    let checked = 0;
    for (const { where, language, cards } of all) {
      for (const name of SHORT) {
        const pieces = cards[name];
        const conditions = pieces.filter((piece) => piece.held === "condition");
        if (conditions.length === 0) continue;
        const saysOne = pieces.some(
          (piece) =>
            piece.role === "detail" &&
            piece.held === undefined &&
            piece.values?.some((source) => source.slot === "field"),
        );
        if (saysOne) continue;
        checked += 1;
        const said = reading(pieces, language);
        expect(said[0], `${where} ${name}`).not.toMatch(/:$/);
        expect(said.join(" "), `${where} ${name}`).not.toMatch(
          /weitere Bedingung|more condition/,
        );
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("words only details naturally, with the same values; the opening stays precise", () => {
    let natural = 0;
    for (const { where, cards } of all) {
      for (const name of ["natural, full", "deployment, full"])
        cards[name].forEach((piece, index) => {
          const precise = cards["precise, full"][index];
          if (piece.text === precise.text) return;
          natural += 1;
          expect(piece.role, `${where} ${name} ${piece.id}`).toBe("detail");
          expect(piece.mustSay, where).toBe(false);
        });
    }
    expect(natural).toBeGreaterThan(50);
  });

  it("never glues words, doubles a space or doubles punctuation, in any wording", () => {
    let checked = 0;
    for (const { where, cards } of all) {
      for (const [name, pieces] of Object.entries(cards))
        for (const piece of pieces) {
          const at = `${where} ${name} ${piece.id}: ${piece.text}`;
          expect(piece.text, at).not.toMatch(/\s{2}|^\s|\s$/);
          expect(piece.text, at).not.toMatch(/\s[.,:;!?]/);
          expect(piece.text, at).not.toMatch(
            /[,:;!?][.,:;!?]|\.[,:;!?]|\.\.(?!\.)/,
          );
          // Every word the piece says stands on its own: nothing glued to it.
          for (const source of piece.values ?? []) {
            if (source.value.kind !== "text" || source.value.text.length === 0)
              continue;
            const word = source.value.text.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            );
            if (!piece.text.includes(source.value.text)) continue;
            checked += 1;
            expect(piece.text, `${at} [${source.slot}]`).toMatch(
              new RegExp(`(^|[\\s"'„“(«‹])${word}($|[\\s.,:;!?"'“)»›])`, "u"),
            );
          }
        }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("says every value of a natural detail with its direction, whatever the deployment wrote", () => {
    // Sentences that pass the slot check but read the change backwards or
    // deny it: the value still says which is old and which is new.
    const attacks: Record<string, SentenceSet> = {
      de: {
        changed: "{field}: jetzt {from}, bisher {to}.",
        updated: "{field} ist nicht mehr {value}.",
      },
      en: {
        changed: "{field}: now {from}, previously {to}.",
        updated: "{field} is no longer {value}.",
      },
    };
    const said = (id: string, language: string, sentences?: SentenceSet) =>
      cardsOf(
        scenarios.find((scenario) => scenario.id === id) as Scenario,
        language,
        {
          amount: "full",
          wording: "natural",
          deployment: sentences && { [language]: sentences },
        },
      )
        .flat()
        .map((piece) => piece.text)
        .join(" ");
    expect(said("update-02-coded-value", "en", attacks.en)).toContain(
      "Risk level: now from Low, previously to High.",
    );
    expect(said("update-02-coded-value", "de", attacks.de)).toContain(
      "Risk level: jetzt von Low, bisher auf High.",
    );
    expect(said("update-05-record-nobody-read", "en", attacks.en)).toMatch(
      /is no longer to /,
    );
    // An opening variant is not taken: the verb is the card's action.
    const opening = (sentences: SentenceSet) =>
      cardsOf(
        scenarios.find(
          (scenario) => scenario.id === "update-02-coded-value",
        ) as Scenario,
        "en",
        { amount: "full", wording: "natural", deployment: { en: sentences } },
      )[0][0].text;
    expect(
      opening({
        "what.update":
          "Next up: deleting {thing} {destination} {source}{clause}",
      }),
    ).toBe(opening({}));
    expect(opening({})).toMatch(/^I'd like to change/);
  });

  it("writes the listening set when asked", () => {
    const out = process.env.SPOKEN_CARD_STYLE_RENDER;
    if (!out) return;
    const lines = [
      "| Scenario | " +
        LISTENED.flatMap((name) => [
          `${name}, German`,
          `${name}, English`,
        ]).join(" | ") +
        " |",
      `|---|${LISTENED.flatMap(() => ["---", "---"]).join("|")}|`,
    ];
    for (const scenario of scenarios) {
      const cells = LISTENED.flatMap((name) =>
        LANGUAGES.map((language) =>
          all
            .filter(
              (entry) =>
                entry.scenario === scenario.id && entry.language === language,
            )
            .map(({ cards }) =>
              reading(cards[name], language)
                .map((sentence) => sentence.replaceAll("|", "\\|"))
                .join("<br>"),
            )
            .join("<br>―<br>"),
        ),
      );
      lines.push(`| \`${scenario.id}\` | ${cells.join(" | ")} |`);
    }
    writeFileSync(out, `${lines.join("\n")}\n`);
  });
});

describe("sentence variants", () => {
  it("follow the cases the backend checks too", () => {
    const { cases } = variantCases as {
      cases: {
        key: string;
        template: string;
        for_one_field: boolean;
        usable: boolean;
      }[];
    };
    expect(cases.length).toBeGreaterThan(20);
    for (const { key, template, for_one_field, usable } of cases)
      expect(
        usableVariant(key, template, for_one_field),
        `${key} ${JSON.stringify(template)}: ${variantProblem(key, template, for_one_field)}`,
      ).toBe(usable);
  });

  it("fall back from one field's own, to the deployment's, to the built-in one", () => {
    expect(naturalVariant("de", "changed", undefined)).toBe(
      "{field} ändert sich {from} {to}.",
    );
    expect(
      naturalVariant("de", "changed", { changed: "{field} geht {from} {to}." }),
    ).toBe("{field} geht {from} {to}.");
    // A broken deployment variant is not used.
    expect(
      naturalVariant("de", "changed", { changed: "{field} {to} {from}" }),
    ).toBe("{field} ändert sich {from} {to}.");
    expect(
      naturalVariant(
        "de",
        "changed",
        undefined,
        "Der Abschluss verschiebt sich {from} {to}.",
      ),
    ).toBe("Der Abschluss verschiebt sich {from} {to}.");
    // Where the precise sentence is natural already, there is no built-in.
    expect(naturalVariant("de", "set", undefined)).toBeUndefined();
    expect(naturalVariant("en", "updated", undefined)).toBeUndefined();
    expect(naturalVariant("fr", "changed", undefined)).toBeUndefined();
    expect(
      fillVariant("{field} ändert sich {from} {to}.", {
        field: "Priorität",
        from: "",
        to: "auf Hoch",
      }),
    ).toBe("Priorität ändert sich auf Hoch.");
  });
});

describe("the sentence that says how much a short reading holds back", () => {
  const shortCard = () =>
    cardsOf(
      scenarios.find(
        (scenario) => scenario.id === "update-06-many-fields",
      ) as Scenario,
      "de",
      STYLES["precise, short"],
    )[0];
  const atHeld = (pieces: SpokenPiece[]) => {
    let flow: SpokenCardFlow = spokenCardStep(pieces, spokenCardFlow(pieces), {
      type: "start",
    });
    for (let guard = 0; flow.playing?.type !== "held" && guard < 20; guard += 1)
      flow = spokenCardStep(pieces, flow, { type: "finished" });
    expect(flow.playing?.type).toBe("held");
    return flow;
  };

  it("is said again on 'again' while it plays, not the detail before it", () => {
    const pieces = shortCard();
    const flow = atHeld(pieces);
    const again = spokenCardStep(pieces, flow, { type: "repeat" });
    expect(again.playing).toEqual(flow.playing);
    expect(again.released).toBe(false);
  });

  it("never holds back a read's condition on a record nobody read", () => {
    const call = JSON.parse(
      JSON.stringify(
        calls.find((entry) => entry.id === "read-11-sql-related-record"),
      ),
    ) as SetCall;
    const label = call.display.label as {
      read: { query: { conditions: { values: { resolved?: string }[] }[] } };
    };
    delete label.read.query.conditions[0].values[0].resolved;
    for (const language of LANGUAGES)
      for (const shortDetails of [0, 1, 2, 3]) {
        const pieces = inLanguage(language, () =>
          spokenApprovalPieces(approvalOf(call), {
            language,
            now: NOW,
            amount: "short",
            shortDetails,
          }),
        );
        const unread = pieces.filter((piece) =>
          piece.values?.some((source) => source.value.kind === "unread"),
        );
        expect(unread, `${language} ${shortDetails}`).toHaveLength(1);
        expect(unread[0].held, `${language} ${shortDetails}`).toBeUndefined();
      }
  });

  it("never holds back a value the card cannot name", () => {
    for (const shortDetails of [0, 1, 2, 3]) {
      const pieces = cardsOf(
        scenarios.find(
          (scenario) => scenario.id === "create-06-task-unread-regarding",
        ) as Scenario,
        "de",
        { amount: "short", shortDetails, wording: "precise" },
      )[0];
      const unread = pieces.filter((piece) =>
        piece.values?.some((source) => source.value.kind === "unread"),
      );
      expect(unread.length, `${shortDetails}`).toBeGreaterThan(0);
      for (const piece of unread)
        expect(piece.held, `${shortDetails} ${piece.id}`).toBeUndefined();
    }
  });
});
