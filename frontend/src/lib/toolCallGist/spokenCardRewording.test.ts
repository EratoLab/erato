import { writeFileSync } from "node:fs";

import { i18n } from "@lingui/core";
import { describe, expect, it } from "vitest";

import { messages as deMessages } from "@/locales/de/messages.json";

import data from "./fixtures/spokenCards/calls.json";
import rewordingSet from "./fixtures/spokenCards/rewording.json";
import { toolCallCardOf } from "./gist";
import { gistPlainLine } from "./gistLabels";
import {
  sameSpokenKind,
  spokenApprovalFor,
  spokenApprovalPieces,
} from "./spokenCard";
import {
  factTokens,
  rewordable,
  rewordingRequest,
  withRewording,
} from "./spokenCardRewording";
import {
  spokenChoice,
  spokenFieldName,
  spokenNamesFor,
  spokenTableName,
} from "./spokenNames";

import type { SpokenApproval, SpokenPiece } from "./spokenCard";
import type { RewordedPiece, RewordingPiece } from "./spokenCardRewording";
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

const callOf = (id: string): SetCall =>
  calls.find((call) => call.id === id) as SetCall;

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

/** Every card of a scenario, as `spokenCard.test.ts` composes them. */
const scenarioCards = (scenario: Scenario, language: string) => {
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
  const together = scenario.shape !== "consecutive_stops";
  const options = { language, now: NOW, timeZone: ZONE };
  return inLanguage(language, () =>
    approvals.map((approval, index) => {
      const pieces = spokenApprovalPieces(approval, {
        ...options,
        position:
          together && approvals.length > 1
            ? {
                index,
                total: approvals.length,
                sameAsPrevious:
                  index > 0 && sameSpokenKind(approvals[index - 1], approval),
              }
            : undefined,
      });
      return { pieces, request: rewordingRequest(pieces, options).pieces };
    }),
  );
};

const all = scenarios.flatMap((scenario) =>
  LANGUAGES.flatMap((language) =>
    scenarioCards(scenario, language).map((card, index) => ({
      where: `${scenario.id} ${language} #${index}`,
      scenario: scenario.id,
      language,
      ...card,
    })),
  ),
);

describe("spoken names", () => {
  const label = {
    spoken_names: {
      de: {
        fields: { statecode: "Status", "Risk level": " " },
        choices: { statecode: { "0": "Offen" } },
        tables: { opportunity: "Verkaufschancen" },
      },
      en: { fields: { statecode: "Status" } },
    },
  } as unknown as ToolCallLabel;

  it("are looked up per language, by the primary tag too", () => {
    const de = spokenNamesFor(label, "de-DE");
    expect(spokenFieldName(de, "statecode")).toBe("Status");
    expect(spokenChoice(de, "statecode", "0")).toBe("Offen");
    expect(spokenTableName(de, "opportunity")).toBe("Verkaufschancen");
    expect(spokenFieldName(spokenNamesFor(label, "en"), "statecode")).toBe(
      "Status",
    );
  });

  it("fall back to the card's name: a missing or blank entry, another language, no label", () => {
    const de = spokenNamesFor(label, "de");
    expect(spokenFieldName(de, "scheduledend")).toBeUndefined();
    expect(spokenFieldName(de, "Risk level")).toBeUndefined();
    expect(spokenChoice(de, "statecode", "1")).toBeUndefined();
    expect(spokenChoice(spokenNamesFor(label, "en"), "statecode", "0")).toBe(
      undefined,
    );
    expect(spokenNamesFor(label, "fr")).toBeUndefined();
    expect(spokenNamesFor(undefined, "de")).toBeUndefined();
  });

  it("change the voice's words in the set, in German and English", () => {
    const words = (id: string, language: string) =>
      scenarioCards(
        scenarios.find((scenario) => scenario.id === id) as Scenario,
        language,
      )
        .flatMap((card) => card.pieces.map((piece) => piece.text))
        .join(" ");
    expect(words("read-02-query", "de")).toMatch(
      /Verkaufschancen auflisten.*Status ist Offen/,
    );
    expect(words("read-02-query", "en")).toMatch(
      /list opportunities.*Status is Open/,
    );
    expect(words("create-01-task-long-description", "de")).toMatch(
      /Fälligkeitsdatum: 15\. Januar 2030\. Priorität: Hoch\./,
    );
    expect(words("create-01-task-long-description", "en")).toMatch(
      /Due date: 15 January 2030\. Priority: High\./,
    );
    // The customer's own vocabulary comes before the shared one.
    expect(words("update-06-many-fields", "de")).toMatch(
      /Risikostufe: von Niedrig auf Mittel\./,
    );
  });

  it("leave the on-screen card exactly as it was", () => {
    for (const call of calls) {
      const label = call.display.label as ToolCallLabel | undefined;
      if (!label?.spoken_names) continue;
      const { spoken_names: _, ...without } = label;
      for (const language of LANGUAGES) {
        inLanguage(language, () => {
          const shown = toolCallCardOf(label, call.input);
          const plain = toolCallCardOf(without, call.input);
          // A generic card keeps the label it was given; nothing on it reads
          // the spoken names.
          const visible = (card: unknown) =>
            JSON.stringify(card, (key, value: unknown) =>
              key === "spoken_names" ? undefined : value,
            );
          expect(visible(shown), call.id).toBe(visible(plain));
          if (shown.kind === "gist" && plain.kind === "gist")
            expect(gistPlainLine(shown.gist, shown.gist.items[0], "ask")).toBe(
              gistPlainLine(plain.gist, plain.gist.items[0], "ask"),
            );
        });
      }
    }
  });
});

describe("the natural reading", () => {
  it("asks about every piece, with its id and role, and facts the piece says", () => {
    for (const card of all) {
      expect(
        card.request.map((piece) => [piece.id, piece.role, piece.text]),
        card.where,
      ).toEqual(card.pieces.map((piece) => [piece.id, piece.role, piece.text]));
      for (const piece of card.request) {
        const said = factTokens(piece.text).join(" ");
        for (const fact of piece.facts)
          expect(
            ` ${said} `.includes(` ${factTokens(fact).join(" ")} `),
            `${card.where} ${piece.id}: ${fact}`,
          ).toBe(true);
      }
    }
  });

  /** Answers a model might give, faithful or not, for every piece. */
  const answers: ((piece: SpokenPiece) => RewordedPiece | undefined)[] = [
    (piece) => ({ id: piece.id, text: "Etwas ganz anderes.", natural: true }),
    (piece) => ({
      id: piece.id,
      text: piece.text.toUpperCase(),
      natural: true,
    }),
    (piece) => ({ id: piece.id, text: "   ", natural: true }),
    (piece) => ({ id: piece.id, text: "Nicht benutzt.", natural: false }),
    (piece) => ({ id: `${piece.id}-other`, text: "Fremd.", natural: true }),
    () => undefined,
  ];

  it("keeps ids, roles, count and the precise consequence and request whatever comes back", () => {
    for (const card of all) {
      for (const answer of answers) {
        const merged = withRewording(
          card.pieces,
          card.pieces.flatMap((piece) => answer(piece) ?? []),
        );
        expect(merged.length, card.where).toBe(card.pieces.length);
        merged.forEach((piece, index) => {
          const precise = card.pieces[index];
          expect(piece.id).toBe(precise.id);
          expect(piece.role).toBe(precise.role);
          expect(piece.mustSay).toBe(precise.mustSay);
          expect(piece.values).toEqual(precise.values);
          expect(piece.readOut).toEqual(precise.readOut);
          if (!rewordable(precise))
            expect(piece.text, `${card.where} ${piece.id}`).toBe(precise.text);
        });
      }
    }
  });

  it("uses a checked wording only for its own piece", () => {
    const card = all.find(
      (entry) => entry.pieces.length > 3,
    ) as (typeof all)[0];
    const target = card.pieces.find((piece) =>
      rewordable(piece),
    ) as SpokenPiece;
    const merged = withRewording(card.pieces, [
      { id: target.id, text: "Neu gesagt.", natural: true },
    ]);
    expect(
      merged.filter((piece, index) => piece !== card.pieces[index]),
    ).toEqual([{ ...target, text: "Neu gesagt." }]);
  });

  it("writes the requests the backend checks, and they match", () => {
    const requests: Record<string, Record<string, RewordingPiece[][]>> = {};
    for (const card of all) {
      const languages = (requests[card.scenario] ??= {});
      (languages[card.language] ??= []).push(card.request);
    }
    if (process.env.SPOKEN_CARD_EXPECT_WRITE) {
      writeFileSync(
        "src/lib/toolCallGist/fixtures/spokenCards/rewording.json",
        `${JSON.stringify(requests, null, 2)}\n`,
      );
      return;
    }
    expect(rewordingSet).toEqual(requests);
  });
});
