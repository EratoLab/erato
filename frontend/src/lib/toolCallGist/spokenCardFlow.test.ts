import { describe, expect, it } from "vitest";

import data from "./fixtures/spokenCards/calls.json";
import expectedPieces from "./fixtures/spokenCards/expected.json";
import {
  namesLongText,
  piecesAhead,
  spokenCardFlow,
  spokenCardStep,
} from "./spokenCardFlow";

import type { SpokenPiece } from "./spokenCard";
import type {
  SpokenCardEvent,
  SpokenCardFlow,
  SpokenPieceState,
  SpokenUtterance,
} from "./spokenCardFlow";

/**
 * Layer 1 of design section 9: the card as a state machine. The scenarios
 * are the spoken-card set (each card of each scenario, as expected.json says
 * it); two dimensions are added, where the voice is when the listener acts
 * and what they ask for, and the combinations are generated so every pair of
 * values occurs at least once.
 */

const piece = (
  role: SpokenPiece["role"],
  text: string,
  mustSay = false,
): SpokenPiece => ({ role, text, mustSay, values: [] });

const CARD = [
  piece("what", "Ich möchte den Datensatz Line 4 Retrofit ändern."),
  piece("detail", "Das Feld Telefon wird geleert.", true),
  piece("detail", "Probability: von 10 auf 60 Prozent."),
  piece("request", "Bitte auf dem Bildschirm bestätigen."),
];

/** Runs `events` from a fresh card and lists what started, in order. */
const run = (pieces: readonly SpokenPiece[], events: SpokenCardEvent[]) => {
  let flow = spokenCardFlow(pieces);
  const said: SpokenUtterance[] = [];
  for (const event of events) {
    const next = spokenCardStep(pieces, flow, event);
    if (next.started !== flow.started && next.playing) said.push(next.playing);
    flow = next;
  }
  return { flow, said };
};

const indices = (said: SpokenUtterance[]) =>
  said.map((utterance) =>
    utterance.type === "piece" ? utterance.index : utterance.type,
  );

const finished = (count: number): SpokenCardEvent[] =>
  Array.from({ length: count }, () => ({ type: "finished" }));

describe("piecesAhead", () => {
  const states = (...list: SpokenPieceState[]) => list;

  it("goes on with the next piece not yet said", () => {
    expect(
      piecesAhead(CARD, states("pending", "pending", "pending", "pending"), []),
    ).toEqual([0, 1, 2, 3]);
    expect(
      piecesAhead(CARD, states("heard", "heard", "pending", "pending"), []),
    ).toEqual([2, 3]);
    expect(
      piecesAhead(CARD, states("heard", "heard", "heard", "heard"), []),
    ).toEqual([]);
  });

  it("says a loss that was cut short again before the request, once", () => {
    expect(
      piecesAhead(CARD, states("heard", "cut", "heard", "pending"), []),
    ).toEqual([1, 3]);
    expect(
      piecesAhead(CARD, states("heard", "cut", "heard", "pending"), [1]),
    ).toEqual([3]);
    // Content that was skipped is not said again.
    expect(
      piecesAhead(CARD, states("heard", "heard", "cut", "pending"), []),
    ).toEqual([3]);
  });
});

describe("what the voice says next", () => {
  it("says the pieces one after another, then falls quiet; the card waits", () => {
    const { flow, said } = run(CARD, [{ type: "start" }, ...finished(4)]);
    expect(indices(said)).toEqual([0, 1, 2, 3]);
    expect(flow.states).toEqual(["heard", "heard", "heard", "heard"]);
    expect(flow.playing).toBeNull();
    expect(flow.closed).toBe(false);
  });

  it("skipping a loss says it once more before the request", () => {
    const { said, flow } = run(CARD, [
      { type: "start" },
      { type: "finished" },
      { type: "skip" },
      ...finished(3),
    ]);
    expect(indices(said)).toEqual([0, 1, 2, 1, 3]);
    expect(flow.repeated).toEqual([1]);
    // Cut again, it is not owed a third time.
    const twice = run(CARD, [
      { type: "start" },
      { type: "finished" },
      { type: "skip" },
      { type: "finished" },
      { type: "skip" },
      { type: "finished" },
    ]);
    expect(indices(twice.said)).toEqual([0, 1, 2, 1, 3]);
  });

  it("the rest is counted first, then only what was not heard", () => {
    const { said } = run(CARD, [
      { type: "start" },
      { type: "rest" },
      ...finished(4),
    ]);
    // The first piece is cut by "what else"; the loss and the field follow.
    expect(said).toEqual([
      { type: "piece", index: 0 },
      { type: "count", count: 2 },
      { type: "piece", index: 1 },
      { type: "piece", index: 2 },
      { type: "piece", index: 3 },
    ]);
    const all = run(CARD, [
      { type: "start" },
      ...finished(4),
      { type: "rest" },
    ]);
    expect(all.said.slice(4)).toEqual([{ type: "nothing_left" }]);
    expect(
      indices(
        run(CARD, [
          { type: "start" },
          ...finished(4),
          { type: "rest" },
          ...finished(2),
        ]).said.slice(4),
      ),
    ).toEqual(["nothing_left", 3]);
  });

  it("repeats the piece being said, a named one, or the last one", () => {
    expect(
      indices(
        run(CARD, [{ type: "start" }, { type: "repeat" }, ...finished(4)]).said,
      ),
    ).toEqual([0, 0, 1, 2, 3]);
    // A named piece first; the one it interrupted follows from its start.
    expect(
      indices(
        run(CARD, [
          { type: "start" },
          { type: "finished" },
          { type: "finished" },
          { type: "repeat", index: 0 },
          ...finished(3),
        ]).said,
      ),
    ).toEqual([0, 1, 2, 0, 2, 3]);
    expect(
      indices(
        run(CARD, [{ type: "start" }, ...finished(4), { type: "repeat" }]).said,
      ),
    ).toEqual([0, 1, 2, 3, 3]);
  });

  it("reads a long text on request; a card without one stays as it is", () => {
    const withText = [
      CARD[0],
      {
        ...piece("text", "Description: ein Text von etwa 70 Wörtern."),
        values: [
          {
            slot: "words" as const,
            value: { kind: "number" as const, value: 70, percent: false },
          },
        ],
      },
      CARD[3],
    ];
    expect(namesLongText(withText[1])).toBe(true);
    const read = run(withText, [
      { type: "start" },
      { type: "finished" },
      { type: "read" },
      ...finished(2),
    ]);
    expect(indices(read.said)).toEqual([0, 1, "text", 2]);
    expect(read.flow.states).toEqual(["heard", "heard", "heard"]);
    const before = run(CARD, [{ type: "start" }]).flow;
    expect(spokenCardStep(CARD, before, { type: "read" })).toBe(before);
  });

  it("stop and failure leave the card waiting; only a decision closes it", () => {
    const stopped = run(CARD, [{ type: "start" }, { type: "stop" }]).flow;
    expect(stopped.playing).toBeNull();
    expect(stopped.states[0]).toBe("cut");
    expect(stopped.closed).toBe(false);
    expect(run(CARD, [{ type: "start" }, { type: "failed" }]).flow.failed).toBe(
      "fallback",
    );
    expect(
      run(CARD, [{ type: "start" }, { type: "finished" }, { type: "failed" }])
        .flow.failed,
    ).toBe("notice");
    const closed = run(CARD, [{ type: "start" }, { type: "closed" }]);
    expect(closed.flow.closed).toBe(true);
    for (const event of [
      { type: "start" },
      { type: "rest" },
      { type: "repeat", index: 0 },
    ] as SpokenCardEvent[]) {
      expect(spokenCardStep(CARD, closed.flow, event)).toBe(closed.flow);
    }
  });
});

// ---------------------------------------------------------------------------
// Generated combinations

interface Scenario {
  id: string;
  kind: string[];
  holds: string[];
}

const { scenarios } = data as unknown as { scenarios: Scenario[] };
const expected = expectedPieces as unknown as Record<
  string,
  Record<string, SpokenPiece[][]>
>;

const LANGUAGES = ["de", "en"] as const;

/** Where the voice is when the listener acts. */
const POSITIONS = [
  "before_start",
  "in_detail",
  "in_long_text",
  "in_consequence",
  "between_pieces",
  "after_request",
] as const;

/** What the listener asks for, or what happens to the card. */
const EVENTS = [
  "finished",
  "failed",
  "skip",
  "rest",
  "repeat_current",
  "repeat_named",
  "read_text",
  "stop",
  "decided",
  "replaced",
] as const;

type Position = (typeof POSITIONS)[number];
type EventValue = (typeof EVENTS)[number];

interface Combination {
  card: string;
  language: (typeof LANGUAGES)[number];
  position: Position;
  event: EventValue;
}

const cards = scenarios.flatMap((scenario) =>
  expected[scenario.id].de.map((_, index) => `${scenario.id}#${index}`),
);

const piecesOf = (card: string, language: string): SpokenPiece[] => {
  const [id, index] = card.split("#");
  return expected[id][language][Number(index)];
};

/** Plays the card until `reached` holds; the listener has not acted yet. */
const playUntil = (
  pieces: readonly SpokenPiece[],
  reached: (flow: SpokenCardFlow) => boolean,
): SpokenCardFlow | undefined => {
  let flow = spokenCardStep(pieces, spokenCardFlow(pieces), { type: "start" });
  for (let steps = 0; steps <= pieces.length; steps++) {
    if (reached(flow)) return flow;
    if (flow.playing === null) return undefined;
    flow = spokenCardStep(pieces, flow, { type: "finished" });
  }
  return undefined;
};

const playingRole = (pieces: readonly SpokenPiece[], flow: SpokenCardFlow) =>
  flow.playing?.type === "piece" ? pieces[flow.playing.index].role : undefined;

/** The card at `position`, or undefined where the card has no such place. */
const flowAt = (
  pieces: readonly SpokenPiece[],
  position: Position,
): SpokenCardFlow | undefined => {
  switch (position) {
    case "before_start":
      return spokenCardFlow(pieces);
    case "in_detail":
      return playUntil(
        pieces,
        (flow) => playingRole(pieces, flow) === "detail",
      );
    case "in_long_text": {
      if (!pieces.some(namesLongText)) return undefined;
      const flow = playUntil(pieces, () => true);
      return flow && spokenCardStep(pieces, flow, { type: "read" });
    }
    case "in_consequence":
      return playUntil(
        pieces,
        (flow) => playingRole(pieces, flow) === "consequence",
      );
    case "between_pieces":
      // The first piece has ended; the next has just begun.
      return pieces.length < 2
        ? undefined
        : playUntil(pieces, (flow) => flow.states[0] === "heard");
    case "after_request":
      return playUntil(pieces, (flow) => flow.playing === null);
  }
};

const eventOf = (
  pieces: readonly SpokenPiece[],
  value: EventValue,
): SpokenCardEvent => {
  switch (value) {
    case "repeat_current":
      return { type: "repeat" };
    case "repeat_named": {
      const detail = pieces.findIndex((entry) => entry.role === "detail");
      return { type: "repeat", index: detail === -1 ? 0 : detail };
    }
    case "read_text":
      return { type: "read" };
    case "decided":
    case "replaced":
      return { type: "closed" };
    default:
      return { type: value };
  }
};

const valid = (combination: Combination): boolean =>
  flowAt(
    piecesOf(combination.card, combination.language),
    combination.position,
  ) !== undefined;

const pairsOf = (combination: Combination): string[] => {
  const entries = Object.entries(combination);
  return entries.flatMap(([a, x], at) =>
    entries.slice(at + 1).map(([b, y]) => `${a}=${x}|${b}=${y}`),
  );
};

/**
 * Every pair of values that some valid combination holds, covered by a
 * greedy pick: each round takes the combination with the most pairs not yet
 * covered.
 */
const pairwise = (): { picked: Combination[]; required: Set<string> } => {
  const all: Combination[] = cards.flatMap((card) =>
    LANGUAGES.flatMap((language) =>
      POSITIONS.flatMap((position) =>
        EVENTS.map((event) => ({ card, language, position, event })),
      ),
    ),
  );
  const candidates = all.filter(valid);
  const required = new Set(candidates.flatMap(pairsOf));
  const left = new Set(required);
  const picked: Combination[] = [];
  const pairs = candidates.map(pairsOf);
  while (left.size > 0) {
    let best = -1;
    let bestGain = 0;
    pairs.forEach((list, at) => {
      const gain = list.filter((pair) => left.has(pair)).length;
      if (gain > bestGain) {
        best = at;
        bestGain = gain;
      }
    });
    picked.push(candidates[best]);
    for (const pair of pairs[best]) left.delete(pair);
  }
  return { picked, required };
};

const { picked: COMBINATIONS, required: REQUIRED_PAIRS } = pairwise();

const name = (combination: Combination) =>
  `${combination.card} ${combination.language} ${combination.position} ${combination.event}`;

describe("the card as a state machine, every pair of values at least once", () => {
  it("covers every pair the scenarios allow", () => {
    const covered = new Set(COMBINATIONS.flatMap(pairsOf));
    for (const pair of REQUIRED_PAIRS)
      expect(covered.has(pair), pair).toBe(true);
    // Every card, position and event value occurs.
    expect(new Set(COMBINATIONS.map((c) => c.card)).size).toBe(cards.length);
    expect(new Set(COMBINATIONS.map((c) => c.position)).size).toBe(
      POSITIONS.length,
    );
    expect(new Set(COMBINATIONS.map((c) => c.event)).size).toBe(EVENTS.length);
  });

  it.each(COMBINATIONS.map((combination) => [name(combination), combination]))(
    "%s",
    (_name, combination) => {
      const pieces = piecesOf(combination.card, combination.language);
      const before = flowAt(pieces, combination.position) as SpokenCardFlow;
      const event = eventOf(pieces, combination.event);
      const after = spokenCardStep(pieces, before, event);

      // What is said from the event on, until the voice falls quiet.
      const said: SpokenUtterance[] = [];
      const startsOf: SpokenCardFlow[] = [];
      let flow = after;
      if (after.started !== before.started && after.playing) {
        said.push(after.playing);
        startsOf.push(after);
      }
      for (let steps = 0; flow.playing !== null; steps++) {
        expect(steps).toBeLessThan(4 * pieces.length + 4);
        const next = spokenCardStep(pieces, flow, { type: "finished" });
        if (next.playing) {
          said.push(next.playing);
          startsOf.push(next);
        }
        flow = next;
      }
      const saidPieces = said.flatMap((utterance) =>
        utterance.type === "piece" ? [utterance.index] : [],
      );

      // No event decides the card: only a decision or a replacement closes it.
      const closes =
        combination.event === "decided" || combination.event === "replaced";
      expect(after.closed).toBe(closes);
      if (closes) {
        expect(said).toEqual([]);
        expect(after.states).not.toContain("playing");
        expect(spokenCardStep(pieces, after, { type: "start" })).toBe(after);
        return;
      }
      expect(flow.closed).toBe(false);
      expect(flow.states).not.toContain("playing");

      // Nothing twice unless asked for: a piece heard before the event is
      // said again only as the piece asked to repeat, or as the request that
      // closes "what else" when nothing is left.
      const request = pieces.findIndex((entry) => entry.role === "request");
      const target =
        event.type === "repeat"
          ? (event.index ??
            (before.playing?.type === "piece"
              ? before.playing.index
              : before.last))
          : null;
      const allowed = new Set<number>();
      if (target !== null) allowed.add(target);
      if (said[0]?.type === "nothing_left") allowed.add(request);
      for (const index of saidPieces) {
        if (before.states[index] === "heard") {
          expect(allowed.has(index), `${index} said again`).toBe(true);
        }
      }
      const counts = new Map<number, number>();
      for (const index of saidPieces)
        counts.set(index, (counts.get(index) ?? 0) + 1);
      for (const [index, count] of counts) {
        const extra =
          (allowed.has(index) ? 1 : 0) + (pieces[index].mustSay ? 1 : 0);
        expect(count, `${index} said ${count} times`).toBeLessThanOrEqual(
          1 + extra,
        );
      }

      // In the card's order, apart from what was asked for and a loss said
      // again before the request.
      const inOrder = saidPieces.filter(
        (index, at) =>
          !(at === 0 && target !== null) &&
          !(
            pieces[index].mustSay &&
            startsOf
              .find(
                (start) =>
                  start.playing?.type === "piece" &&
                  start.playing.index === index,
              )
              ?.repeated.includes(index)
          ),
      );
      for (let at = 1; at < inOrder.length; at++) {
        expect(inOrder[at], `order ${inOrder.join(",")}`).toBeGreaterThan(
          inOrder[at - 1],
        );
      }

      // Every loss and consequence is heard before the request: whatever was
      // skipped, a cut one is said again first.
      for (const start of startsOf) {
        if (
          start.playing?.type !== "piece" ||
          pieces[start.playing.index].role !== "request"
        )
          continue;
        pieces.forEach((entry, index) => {
          if (!entry.mustSay) return;
          const state = start.states[index];
          expect(
            state === "heard" ||
              (state === "cut" && start.repeated.includes(index)),
            `${entry.role} ${index} is ${state} when the request starts`,
          ).toBe(true);
        });
      }

      switch (combination.event) {
        case "finished":
          if (before.playing === null) expect(after).toBe(before);
          break;
        case "skip":
          if (before.playing?.type === "piece") {
            const skipped = before.playing.index;
            // A loss skipped right before the request is said again at once.
            expect(
              after.states[skipped] === "cut" ||
                (pieces[skipped].mustSay && after.repeated.includes(skipped)),
            ).toBe(true);
          }
          break;
        case "rest": {
          const content = saidPieces.filter((index) => index !== request);
          expect(said[0]).toEqual(
            content.length === 0
              ? { type: "nothing_left" }
              : { type: "count", count: content.length },
          );
          if (request !== -1) expect(saidPieces.at(-1)).toBe(request);
          break;
        }
        case "repeat_current":
        case "repeat_named":
          if (target === null) expect(after).toBe(before);
          else expect(said[0]).toEqual({ type: "piece", index: target });
          break;
        case "read_text":
          if (pieces.some(namesLongText)) {
            expect(said[0]?.type).toBe("text");
          } else {
            expect(after).toBe(before);
          }
          break;
        case "stop":
          expect(after.playing).toBeNull();
          expect(said).toEqual([]);
          break;
        case "failed":
          expect(after.playing).toBeNull();
          expect(said).toEqual([]);
          expect(after.failed).toBe(
            after.states.includes("heard") ? "notice" : "fallback",
          );
          break;
      }
    },
  );
});
