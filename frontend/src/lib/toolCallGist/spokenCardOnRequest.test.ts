import { i18n } from "@lingui/core";
import { afterEach, describe, expect, it } from "vitest";

import { messages as deMessages } from "@/locales/de/messages.json";

import visitReport from "./fixtures/spokenCards/visitReport.json";
import {
  MAX_COMMAND_PIECES,
  spokenApprovalFor,
  spokenApprovalPieces,
} from "./spokenCard";
import {
  piecesAhead,
  spokenCardFlow,
  spokenCardStep,
  voiceDecisionGate,
} from "./spokenCardFlow";
import { spokenWordsFor } from "./spokenCardWords";

import type { SpokenOptions, SpokenPiece } from "./spokenCard";
import type { SpokenCardEvent, SpokenCardFlow } from "./spokenCardFlow";
import type { Messages } from "@lingui/core";

i18n.load({ de: deMessages as unknown as Messages });
const previous = i18n.locale;
afterEach(() => i18n.activate(previous));

// The visit report create and the opportunity update from MS staging,
// 2026-11-23: the create shows five fields and four behind "more".
type Call = Parameters<typeof spokenApprovalFor>[1];
const [UPDATE, CREATE] = visitReport as unknown as Call[];

const piecesOf = (
  call: Call,
  language: string,
  options: Partial<SpokenOptions> = {},
): SpokenPiece[] => {
  i18n.activate(language);
  return spokenApprovalPieces(spokenApprovalFor("mcp_tool", call), {
    language,
    now: new Date("2026-11-23T17:00:00Z"),
    timeZone: "Europe/Berlin",
    voiceApproval: true,
    ...options,
  });
};

const reading = (pieces: readonly SpokenPiece[], events: SpokenCardEvent[]) =>
  events.reduce<SpokenCardFlow>(
    (flow, event) => spokenCardStep(pieces, flow, event),
    spokenCardFlow(pieces),
  );

/** The card read to its end: each piece it starts is heard in full. */
const readToEnd = (pieces: readonly SpokenPiece[]) => {
  let flow = spokenCardStep(pieces, spokenCardFlow(pieces), { type: "start" });
  const said: number[] = [];
  while (flow.playing?.type === "piece") {
    said.push(flow.playing.index);
    flow = spokenCardStep(pieces, flow, { type: "finished" });
  }
  return { flow, said };
};

describe("fields a card counts as more", () => {
  it.each([
    ["de", "precise", "full"],
    ["de", "natural", "short"],
    ["en", "precise", "full"],
    ["en", "natural", "short"],
  ] as const)(
    "are pieces said only on request (%s, %s, %s)",
    (language, wording, amount) => {
      const pieces = piecesOf(CREATE, language, { wording, amount });
      const asked = pieces.filter((piece) => piece.onRequest);
      expect(asked.map((piece) => piece.id)).toEqual([
        "detail:Summary",
        "detail:Customerneed",
        "detail:Competitionnotes",
        "detail:Nextsteps",
        "detail:Followupdate",
        "detail:Site ID",
      ]);
      // They follow the card and are never owed.
      expect(pieces.slice(-asked.length)).toEqual(asked);
      expect(asked.every((piece) => !piece.mustSay && !piece.held)).toBe(true);
      expect(pieces.length).toBeLessThanOrEqual(MAX_COMMAND_PIECES);
      // The card itself still counts them.
      expect(pieces.find((piece) => piece.role === "more")?.text).toMatch(
        language === "de" ? /sechs weitere Felder/ : /six more fields/,
      );
    },
  );

  it("say the field asked for in full, not cut as a reading would", () => {
    const summary = piecesOf(CREATE, "de").find(
      (piece) => piece.id === "detail:Summary",
    );
    expect(summary?.text).toBe(
      "Summary: Budget in Höhe von 1.200.000 EUR bestätigt. Kundenentscheidung ist für den 14.12.2026 vorgesehen.",
    );
  });

  it("are never part of a reading, the rest included", () => {
    for (const language of ["de", "en"]) {
      const pieces = piecesOf(CREATE, language);
      const { flow, said } = readToEnd(pieces);
      expect(said.some((index) => pieces[index].onRequest)).toBe(false);
      expect(said.at(-1)).toBe(
        pieces.findIndex((piece) => piece.role === "request"),
      );
      const rest = spokenCardStep(pieces, flow, { type: "rest" });
      expect(rest.playing).toEqual({ type: "nothing_left" });
      expect(piecesAhead(pieces, rest.states, rest.heard)).toEqual([
        pieces.findIndex((piece) => piece.role === "request"),
      ]);
    }
  });

  it("are said when asked for, and hearing one stands in for nothing", () => {
    const pieces = piecesOf(CREATE, "en");
    const summary = pieces.findIndex((piece) => piece.id === "detail:Summary");
    // Asked before the card was heard: the field, then quiet; the card still
    // owes what it must say and has not asked.
    let flow = reading(pieces, [{ type: "repeat", index: summary }]);
    expect(flow.playing).toEqual({ type: "piece", index: summary });
    flow = spokenCardStep(pieces, flow, { type: "finished" });
    expect(flow.heard[summary]).toBe(true);
    expect(flow.owed.length).toBeGreaterThan(0);
    expect(voiceDecisionGate(pieces, flow, "approve").ready).toBe(false);
    // After the whole card: the field again, and the card stays ready.
    const heard = readToEnd(pieces).flow;
    expect(voiceDecisionGate(pieces, heard, "approve").ready).toBe(true);
    let after = spokenCardStep(pieces, heard, {
      type: "repeat",
      index: summary,
    });
    expect(after.playing).toEqual({ type: "piece", index: summary });
    after = spokenCardStep(pieces, after, { type: "finished" });
    expect(after.playing).toBeNull();
    expect(voiceDecisionGate(pieces, after, "approve").ready).toBe(true);
  });

  it("a card that says every field has none", () => {
    const pieces = piecesOf(UPDATE, "en");
    expect(pieces.some((piece) => piece.onRequest)).toBe(false);
  });
});

describe("other names of a field", () => {
  it("come from the card and the vocabulary in each language", () => {
    const budget = piecesOf(UPDATE, "de").find(
      (piece) => piece.id === "detail:Budget amount",
    );
    expect(budget?.text).toMatch(/^Budget/);
    expect(budget?.names).toEqual(["Budget amount"]);
  });
});

describe("asking which field", () => {
  it("names the fields in either language", () => {
    i18n.activate("de");
    expect(
      spokenWordsFor("de", { now: new Date() }).notice({
        kind: "which_field",
        fields: ["Besuchsdatum", "Nachfassdatum"],
      }),
    ).toBe("Welches Feld: Besuchsdatum oder Nachfassdatum?");
    i18n.activate("en");
    expect(
      spokenWordsFor("en", { now: new Date() }).notice({
        kind: "which_field",
        fields: ["Visitedon", "Followupdate"],
      }),
    ).toBe("Which field: Visitedon or Followupdate?");
  });
});
