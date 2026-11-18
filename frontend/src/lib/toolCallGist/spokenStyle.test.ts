import { writeFileSync } from "node:fs";

import { i18n } from "@lingui/core";
import { describe, expect, it } from "vitest";

import { messages as deMessages } from "@/locales/de/messages.json";

import data from "./fixtures/spokenCards/calls.json";
import {
  sameSpokenKind,
  spokenApprovalFor,
  spokenApprovalPieces,
  spokenUtteranceSentences,
} from "./spokenCard";
import { spokenCardFlow, spokenCardStep } from "./spokenCardFlow";
import { fillVariant, naturalVariant, usableVariant } from "./spokenSentences";

import type { SpokenApproval, SpokenOptions, SpokenPiece } from "./spokenCard";
import type { SpokenCardFlow } from "./spokenCardFlow";
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

type Style = Pick<SpokenOptions, "amount" | "shortDetails" | "wording">;
const STYLES: Record<string, Style> = {
  "precise, full": { amount: "full", wording: "precise" },
  "precise, short": { amount: "short", shortDetails: 1, wording: "precise" },
  "natural, full": { amount: "full", wording: "natural" },
  "natural, short": { amount: "short", shortDetails: 1, wording: "natural" },
};

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
        ...style,
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
      for (const name of ["precise, full", "natural, full"])
        expect(
          cards[name].filter((piece) => piece.held !== undefined),
          `${where} ${name}`,
        ).toEqual([]);
    }
  });

  it("in a short reading says how much it holds back, and the rest says it", () => {
    let shortened = 0;
    for (const { where, language, cards } of all) {
      for (const name of ["precise, short", "natural, short"]) {
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
    expect(shortened).toBeGreaterThan(20);
  });

  it("words natural pieces only from variants, with the same values", () => {
    let natural = 0;
    for (const { where, cards } of all) {
      cards["natural, full"].forEach((piece, index) => {
        const precise = cards["precise, full"][index];
        if (piece.text === precise.text) return;
        natural += 1;
        expect(["what", "detail"], `${where} ${piece.id}`).toContain(
          piece.role,
        );
        expect(piece.mustSay, where).toBe(false);
      });
    }
    expect(natural).toBeGreaterThan(50);
  });

  it("writes the listening set when asked", () => {
    const out = process.env.SPOKEN_CARD_STYLE_RENDER;
    if (!out) return;
    const lines = [
      "| Scenario | " +
        Object.keys(STYLES)
          .flatMap((name) => [`${name}, German`, `${name}, English`])
          .join(" | ") +
        " |",
      `|---|${Object.keys(STYLES)
        .flatMap(() => ["---", "---"])
        .join("|")}|`,
    ];
    for (const scenario of scenarios) {
      const cells = Object.keys(STYLES).flatMap((name) =>
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
  it("are used only with exactly their slots, in the precise order", () => {
    expect(usableVariant("changed", "{field} ändert sich {from} {to}.")).toBe(
      true,
    );
    expect(usableVariant("changed", "{field}: {to} statt {from}.")).toBe(false);
    expect(usableVariant("changed", "{field} {from}.")).toBe(false);
    expect(usableVariant("set", "{field} ist {value} für {name}.")).toBe(false);
    expect(usableVariant("changed", "Der Abschluss rückt {from} {to}.")).toBe(
      false,
    );
    expect(
      usableVariant("changed", "Der Abschluss rückt {from} {to}.", true),
    ).toBe(true);
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
        "Der Abschluss rückt {from} {to}.",
      ),
    ).toBe("Der Abschluss rückt {from} {to}.");
    expect(naturalVariant("fr", "changed", undefined)).toBeUndefined();
    expect(
      fillVariant("Als Nächstes {source} {thing} anlegen{clause}", {
        source: "",
        thing: "eine Aufgabe",
        clause: "",
      }),
    ).toBe("Als Nächstes eine Aufgabe anlegen");
  });
});
