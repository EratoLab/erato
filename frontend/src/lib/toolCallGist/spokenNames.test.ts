import { writeFileSync } from "node:fs";

import { i18n } from "@lingui/core";
import { describe, expect, it } from "vitest";

import { messages as deMessages } from "@/locales/de/messages.json";

import data from "./fixtures/spokenCards/calls.json";
import withoutVocabulary from "./fixtures/spokenCards/expected-without-vocabulary.json";
import { toolCallCardOf } from "./gist";
import { gistPlainLine } from "./gistLabels";
import {
  sameSpokenKind,
  spokenApprovalFor,
  spokenApprovalPieces,
} from "./spokenCard";
import {
  spokenChoice,
  spokenFieldName,
  spokenNamesFor,
  spokenTableName,
} from "./spokenNames";

import type { SpokenApproval, SpokenPiece } from "./spokenCard";
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

const approvalOf = (
  call: SetCall,
  kind = "mcp_tool",
  vocabulary = true,
): SpokenApproval => {
  const label = call.display.label as ToolCallLabel | undefined;
  const { spoken_names: _, ...plain } = label ?? ({} as ToolCallLabel);
  return spokenApprovalFor(kind, {
    tool_name: call.tool_name,
    input: call.input,
    display: {
      title: call.display.title,
      server_name: call.display.server_name,
      label: label && !vocabulary ? (plain) : label,
    },
  });
};

/** Every card of a scenario, as `spokenCard.test.ts` composes them. */
const scenarioCards = (
  scenario: Scenario,
  language: string,
  vocabulary = true,
) => {
  const approvals =
    scenario.calls.length > 0
      ? scenario.calls.map((id) =>
          approvalOf(callOf(id), scenario.approval_kind, vocabulary),
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
      return { pieces };
    }),
  );
};

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

/**
 * Without a vocabulary the voice says exactly what it said before spoken
 * names existed: this fixture was checked equal to `main`'s `expected.json`
 * for every scenario both have when spoken names were added (ERMAIN-1224).
 */
describe("without a vocabulary", () => {
  it("says every scenario as before spoken names", () => {
    const pieces: Record<string, Record<string, SpokenPiece[][]>> = {};
    for (const scenario of scenarios) {
      pieces[scenario.id] = Object.fromEntries(
        LANGUAGES.map((language) => [
          language,
          scenarioCards(scenario, language, false).map((card) => card.pieces),
        ]),
      );
    }
    if (process.env.SPOKEN_CARD_EXPECT_WRITE) {
      writeFileSync(
        "src/lib/toolCallGist/fixtures/spokenCards/expected-without-vocabulary.json",
        `${JSON.stringify(pieces, null, 2)}\n`,
      );
      return;
    }
    expect(withoutVocabulary).toEqual(pieces);
  });
});
