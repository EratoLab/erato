import { describe, expect, it } from "vitest";

import data from "./fixtures/spokenCards/calls.json";
import expectedPieces from "./fixtures/spokenCards/expected.json";
import {
  currentPiece,
  heardStates,
  namesLongText,
  piecesAhead,
  spokenCardFlow,
  spokenCardStep,
  voiceDecisionGate,
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
 * it). Two kinds of runs check the design's rules: one event at each place
 * the voice can be, generated so every pair of values occurs at least once,
 * and random sequences of several events in a row.
 */

const piece = (
  role: SpokenPiece["role"],
  text: string,
  mustSay = false,
): SpokenPiece => ({ id: text, role, text, mustSay, values: [] });

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

const pieceOf = (utterance: SpokenUtterance | null): number | null =>
  utterance?.type === "piece" ? utterance.index : null;

/**
 * Runs `events` and then lets the voice finish, checking the design's rules
 * at every step:
 *
 * - the card closes only on a decision or a replacement, and nothing moves
 *   after that;
 * - in one reading, a piece heard to its end is said again only when asked
 *   for; after "the rest", nothing heard in full before is said unless asked;
 * - a piece heard in full stays heard;
 * - the request starts only when every loss and consequence was heard;
 * - the run ends once only "finished" follows.
 */
const checkRun = (
  pieces: readonly SpokenPiece[],
  events: readonly SpokenCardEvent[],
  where: string,
) => {
  const request = pieces.findIndex((entry) => entry.role === "request");
  let flow = spokenCardFlow(pieces);
  const said: SpokenUtterance[] = [];
  let heardInReading = new Set<number>();
  let afterRest = false;
  let requestAsked = false;
  let closed = false;
  const apply = (event: SpokenCardEvent) => {
    const before = flow;
    const next = spokenCardStep(pieces, before, event);
    if (event.type === "closed") closed = true;
    if (before.closed) expect(next, where).toBe(before);
    expect(next.closed, `${where}: closed`).toBe(closed);
    before.heard.forEach((wasHeard, index) => {
      if (wasHeard) expect(next.heard[index], `${where}: unheard`).toBe(true);
    });
    let target: number | null = null;
    switch (event.type) {
      case "start":
        heardInReading = new Set();
        afterRest = false;
        requestAsked = false;
        break;
      case "rest":
        afterRest = true;
        requestAsked = true;
        break;
      case "skip":
        // Quiet with nothing left of the reading, "go on" is the rest.
        if (
          before.playing === null &&
          piecesAhead(pieces, before.states, before.heard).length === 0
        ) {
          afterRest = true;
          requestAsked = true;
        }
        break;
      case "repeat":
        target = event.index ?? pieceOf(before.playing) ?? before.last;
        if (target === request) requestAsked = true;
        break;
      case "finished":
        if (before.playing?.type === "piece")
          heardInReading.add(before.playing.index);
        if (before.playing?.type === "text")
          heardInReading.add(before.playing.index);
        break;
    }
    if (next.started !== before.started && next.playing) {
      said.push(next.playing);
      const index = pieceOf(next.playing);
      if (index !== null) {
        const asked = index === target || (index === request && requestAsked);
        if (heardInReading.has(index) || (afterRest && before.heard[index])) {
          expect(asked, `${where}: piece ${index} said again`).toBe(true);
        }
        if (index === request) {
          expect(next.owed, `${where}: request before a consequence`).toEqual(
            [],
          );
          requestAsked = false;
        }
      }
    }
    flow = next;
  };
  for (const event of events) apply(event);
  for (let steps = 0; flow.playing !== null; steps++) {
    expect(steps, `${where}: never ends`).toBeLessThan(4 * pieces.length + 4);
    apply({ type: "finished" });
  }
  expect(flow.states, where).not.toContain("playing");
  return { flow, said };
};

describe("piecesAhead", () => {
  const states = (...list: SpokenPieceState[]) => list;
  const none = [false, false, false, false];

  it("goes on with the next piece not yet said", () => {
    expect(
      piecesAhead(
        CARD,
        states("pending", "pending", "pending", "pending"),
        none,
      ),
    ).toEqual([0, 1, 2, 3]);
    expect(
      piecesAhead(CARD, states("heard", "heard", "pending", "pending"), [
        true,
        true,
        false,
        false,
      ]),
    ).toEqual([2, 3]);
    expect(
      piecesAhead(CARD, states("heard", "heard", "heard", "heard"), [
        true,
        true,
        true,
        true,
      ]),
    ).toEqual([]);
  });

  it("says a loss cut short again before the request, until it was heard", () => {
    expect(
      piecesAhead(CARD, states("heard", "cut", "heard", "pending"), [
        true,
        false,
        true,
        false,
      ]),
    ).toEqual([1, 3]);
    // Heard in full once, a loss cut short later is not owed.
    expect(
      piecesAhead(CARD, states("heard", "cut", "heard", "pending"), [
        true,
        true,
        true,
        false,
      ]),
    ).toEqual([3]);
    // Content that was skipped is not said again.
    expect(
      piecesAhead(CARD, states("heard", "heard", "cut", "pending"), [
        true,
        true,
        false,
        false,
      ]),
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

  it("a skipped loss is said again before the request, until it was heard", () => {
    const once = run(CARD, [
      { type: "start" },
      { type: "finished" },
      { type: "skip" },
      ...finished(3),
    ]);
    expect(indices(once.said)).toEqual([0, 1, 2, 1, 3]);
    const twice = run(CARD, [
      { type: "start" },
      { type: "finished" },
      { type: "skip" },
      { type: "finished" },
      { type: "skip" },
      ...finished(2),
    ]);
    expect(indices(twice.said)).toEqual([0, 1, 2, 1, 1, 3]);
  });

  it("says what is owed, so a decision by voice can wait for it", () => {
    const flow = spokenCardFlow(CARD);
    expect(flow.owed).toEqual([1]);
    expect(run(CARD, [{ type: "start" }, ...finished(2)]).flow.owed).toEqual(
      [],
    );
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

describe("while the voice is quiet and listens", () => {
  it("'go on' after a stop drops what was cut and says the rest of the reading", () => {
    const { said, flow } = run(CARD, [
      { type: "start" },
      { type: "finished" },
      { type: "finished" },
      { type: "stop" },
      { type: "skip" },
      ...finished(2),
    ]);
    // Piece 2 was stopped and is dropped; only the request is left.
    expect(indices(said)).toEqual([0, 1, 2, 3]);
    expect(flow.states).toEqual(["heard", "heard", "cut", "heard"]);
  });

  it("'go on' with nothing left is 'that was all', and the request again", () => {
    const { said } = run(CARD, [
      { type: "start" },
      ...finished(4),
      { type: "skip" },
      ...finished(2),
    ]);
    expect(indices(said).slice(4)).toEqual(["nothing_left", 3]);
  });

  it("a stopped loss is still said before the request", () => {
    const { said } = run(CARD, [
      { type: "start" },
      { type: "finished" },
      { type: "stop" },
      { type: "skip" },
      ...finished(3),
    ]);
    expect(indices(said)).toEqual([0, 1, 2, 1, 3]);
  });

  it("a notice is said, then the voice is quiet and nothing else changes", () => {
    const before = run(CARD, [{ type: "start" }, ...finished(4)]).flow;
    const notice = spokenCardStep(CARD, before, {
      type: "notice",
      notice: { kind: "decide_on_screen", decision: "approve" },
    });
    expect(notice.playing).toEqual({
      type: "notice",
      notice: { kind: "decide_on_screen", decision: "approve" },
    });
    const after = spokenCardStep(CARD, notice, { type: "finished" });
    expect(after.playing).toBeNull();
    expect(after.states).toEqual(before.states);
    expect(after.heard).toEqual(before.heard);
    expect(after.closed).toBe(false);
  });

  it("knows the piece said last, also when it was cut short", () => {
    const stopped = run(CARD, [
      { type: "start" },
      { type: "finished" },
      { type: "stop" },
    ]).flow;
    expect(stopped.last).toBe(0);
    expect(currentPiece(stopped)).toBe(1);
    expect(heardStates(stopped)).toEqual([
      "heard",
      "cut_short",
      "not_said",
      "not_said",
    ]);
  });

  it("a card withdrawn for a change is closed, but not decided", () => {
    const withdrawn = run(CARD, [
      { type: "start" },
      { type: "closed", withdrawn: true },
    ]).flow;
    expect(withdrawn.closed).toBe(true);
    expect(withdrawn.withdrawn).toBe(true);
    expect(
      run(CARD, [{ type: "start" }, { type: "closed" }]).flow.withdrawn,
    ).toBe(false);
  });

  it("a decision by voice would wait for the request and every owed loss", () => {
    const fresh = spokenCardFlow(CARD);
    expect(voiceDecisionGate(CARD, fresh)).toEqual({
      ready: false,
      owed: [1],
    });
    const skipped = run(CARD, [
      { type: "start" },
      { type: "finished" },
      { type: "stop" },
    ]).flow;
    expect(voiceDecisionGate(CARD, skipped).ready).toBe(false);
    const heard = run(CARD, [{ type: "start" }, ...finished(4)]).flow;
    expect(voiceDecisionGate(CARD, heard)).toEqual({ ready: true, owed: [] });
    const closed = spokenCardStep(CARD, heard, { type: "closed" });
    expect(voiceDecisionGate(CARD, closed).ready).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The scenario cards

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

const cards = scenarios.flatMap((scenario) =>
  expected[scenario.id].de.map((_, index) => `${scenario.id}#${index}`),
);

const piecesOf = (card: string, language: string): SpokenPiece[] => {
  const [id, index] = card.split("#");
  return expected[id][language][Number(index)];
};

describe("findings of the review of 2026-11-17 (base)", () => {
  const card = (id: string) => piecesOf(`${id}#0`, "de");

  it("2.1: after the rest, a repeat says nothing twice and no loss after the request", () => {
    const contact = card("delete-04-contact");
    const repeated = checkRun(
      contact,
      [
        { type: "start" },
        { type: "rest" },
        { type: "finished" },
        { type: "repeat", index: 0 },
      ],
      "delete-04",
    );
    // The consequence the repeat interrupted follows from its start, before
    // the request; the item is said once more, as asked.
    expect(indices(repeated.said)).toEqual([0, "count", 1, 0, 1, 2]);

    const emptied = card("update-04-emptied-fields");
    const losses = checkRun(
      emptied,
      [
        { type: "start" },
        { type: "rest" },
        { type: "finished" },
        { type: "repeat", index: 0 },
      ],
      "update-04",
    );
    expect(indices(losses.said)).toEqual([0, "count", 1, 0, 1, 2, 3, 4]);

    const text = card("update-08-long-text");
    const read = checkRun(
      text,
      [{ type: "start" }, { type: "rest" }, { type: "read" }],
      "update-08",
    );
    // The text is read; the piece that names it is not said after it.
    expect(indices(read.said)).toEqual([0, "count", "text", 2]);
  });

  it("2.2: a piece heard in full stays heard, also when its repeat is cut", () => {
    const contact = card("delete-04-contact");
    for (const cut of ["failed", "stop"] as const) {
      const { said, flow } = checkRun(
        contact,
        [
          { type: "start" },
          { type: "finished" },
          { type: cut },
          { type: "repeat" },
          { type: "rest" },
        ],
        `delete-04 ${cut}`,
      );
      expect(indices(said)).toEqual([0, 1, 0, "count", 1, 2]);
      expect(flow.heard).toEqual([true, true, true]);
    }
  });

  it("2.3: the request waits for an owed consequence, also when asked for by name", () => {
    const contact = card("delete-04-contact");
    const stopped = run(contact, [
      { type: "start" },
      { type: "finished" },
      { type: "stop" },
    ]).flow;
    expect(stopped.owed).toEqual([1]);
    const asked = spokenCardStep(contact, stopped, {
      type: "repeat",
      index: 2,
    });
    expect(asked.playing).toEqual({ type: "piece", index: 1 });
    const consequence = spokenCardStep(contact, asked, { type: "finished" });
    expect(consequence.owed).toEqual([]);
    expect(consequence.playing).toEqual({ type: "piece", index: 2 });
  });
});

// ---------------------------------------------------------------------------
// One event at each place the voice can be, every pair of values

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
  "notice",
  "decided",
  "replaced",
  "withdrawn",
] as const;

type Position = (typeof POSITIONS)[number];
type EventValue = (typeof EVENTS)[number];

interface Combination {
  card: string;
  language: (typeof LANGUAGES)[number];
  position: Position;
  event: EventValue;
}

const playingRole = (pieces: readonly SpokenPiece[], flow: SpokenCardFlow) => {
  const index = pieceOf(flow.playing);
  return index === null ? undefined : pieces[index].role;
};

/** The events that bring the card to `position`, or undefined where it has no such place. */
const eventsTo = (
  pieces: readonly SpokenPiece[],
  position: Position,
): SpokenCardEvent[] | undefined => {
  const until = (reached: (flow: SpokenCardFlow) => boolean) => {
    const events: SpokenCardEvent[] = [{ type: "start" }];
    let flow = spokenCardStep(pieces, spokenCardFlow(pieces), events[0]);
    for (let steps = 0; steps <= pieces.length; steps++) {
      if (reached(flow)) return events;
      if (flow.playing === null) return undefined;
      events.push({ type: "finished" });
      flow = spokenCardStep(pieces, flow, { type: "finished" });
    }
    return undefined;
  };
  switch (position) {
    case "before_start":
      return [];
    case "in_detail":
      return until((flow) => playingRole(pieces, flow) === "detail");
    case "in_long_text":
      return pieces.some(namesLongText)
        ? [{ type: "start" }, { type: "read" }]
        : undefined;
    case "in_consequence":
      return until((flow) => playingRole(pieces, flow) === "consequence");
    case "between_pieces":
      // The first piece has ended; the next has just begun.
      return pieces.length < 2
        ? undefined
        : until((flow) => flow.states[0] === "heard");
    case "after_request":
      return until((flow) => flow.playing === null);
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
    case "notice":
      return { type: "notice", notice: { kind: "unclear", hasText: false } };
    case "decided":
    case "replaced":
      return { type: "closed" };
    case "withdrawn":
      return { type: "closed", withdrawn: true };
    default:
      return { type: value };
  }
};

const valid = (combination: Combination): boolean =>
  eventsTo(
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
    expect(new Set(COMBINATIONS.map((c) => c.card)).size).toBe(cards.length);
    expect(new Set(COMBINATIONS.map((c) => c.position)).size).toBe(
      POSITIONS.length,
    );
    expect(new Set(COMBINATIONS.map((c) => c.event)).size).toBe(EVENTS.length);
  });

  it.each(COMBINATIONS.map((combination) => [name(combination), combination]))(
    "%s",
    (where, combination) => {
      const pieces = piecesOf(combination.card, combination.language);
      const to = eventsTo(pieces, combination.position) as SpokenCardEvent[];
      const before = run(pieces, to);
      const event = eventOf(pieces, combination.event);
      const after = spokenCardStep(pieces, before.flow, event);
      const said = checkRun(pieces, [...to, event], where).said.slice(
        before.said.length,
      );
      const saidPieces = said.flatMap((utterance) => {
        const index = pieceOf(utterance);
        return index === null ? [] : [index];
      });
      const request = pieces.findIndex((entry) => entry.role === "request");

      switch (combination.event) {
        case "decided":
        case "replaced":
        case "withdrawn":
          expect(after.closed).toBe(true);
          expect(after.withdrawn).toBe(combination.event === "withdrawn");
          expect(said).toEqual([]);
          break;
        case "notice":
          // The sentence, then quiet; no piece follows it.
          expect(said).toEqual([event.type === "notice" && event]);
          expect(said.map((utterance) => utterance.type)).toEqual(["notice"]);
          break;
        case "finished":
          if (before.flow.playing === null) expect(after).toBe(before.flow);
          break;
        case "skip": {
          const skipped = pieceOf(before.flow.playing);
          if (before.flow.playing === null) {
            const ahead = piecesAhead(
              pieces,
              before.flow.states,
              before.flow.heard,
            );
            expect(said[0]).toEqual(
              ahead.length === 0
                ? { type: "nothing_left" }
                : {
                    type: "piece",
                    index:
                      ahead[0] === request && before.flow.owed.length > 0
                        ? before.flow.owed[0]
                        : ahead[0],
                  },
            );
          }
          if (skipped !== null) {
            // A loss skipped before it was heard is said again first.
            expect(
              after.states[skipped] === "cut" ||
                after.states[skipped] === "heard" ||
                (pieces[skipped].mustSay && pieceOf(after.playing) === skipped),
            ).toBe(true);
          }
          break;
        }
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
        case "repeat_named": {
          const target =
            event.type === "repeat"
              ? (event.index ??
                pieceOf(before.flow.playing) ??
                before.flow.last)
              : null;
          if (target === null) expect(after).toBe(before.flow);
          else
            expect(said[0]).toEqual({
              type: "piece",
              index:
                target === request && before.flow.owed.length > 0
                  ? before.flow.owed[0]
                  : target,
            });
          break;
        }
        case "read_text":
          if (pieces.some(namesLongText)) expect(said[0]?.type).toBe("text");
          else expect(after).toBe(before.flow);
          break;
        case "stop":
          expect(after.playing).toBeNull();
          expect(said).toEqual([]);
          break;
        case "failed":
          expect(after.playing).toBeNull();
          expect(said).toEqual([]);
          expect(after.failed).toBe(
            after.heard.some(Boolean) ? "notice" : "fallback",
          );
          break;
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Several events in a row

/** A small seeded generator, so a failing sequence can be run again. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const SEQUENCES_PER_CARD = 12;
const MAX_EVENTS = 10;

const randomEvent = (
  next: () => number,
  pieces: readonly SpokenPiece[],
): SpokenCardEvent => {
  const pick = <T>(list: readonly T[]): T =>
    list[Math.floor(next() * list.length)];
  const anyPiece = () => Math.floor(next() * pieces.length);
  return pick<() => SpokenCardEvent>([
    () => ({ type: "finished" }),
    () => ({ type: "finished" }),
    () => ({ type: "finished" }),
    () => ({ type: "skip" }),
    () => ({ type: "skip" }),
    () => ({ type: "rest" }),
    () => ({ type: "repeat" }),
    () => ({ type: "repeat", index: anyPiece() }),
    () => ({ type: "read" }),
    () => ({ type: "read", index: anyPiece() }),
    () => ({ type: "stop" }),
    () => ({
      type: "notice",
      notice: { kind: "decide_on_screen", decision: "approve" },
    }),
    () => ({ type: "failed" }),
    () => ({ type: "start" }),
    () => (next() < 0.3 ? { type: "closed" } : { type: "finished" }),
  ])();
};

describe("several events in a row, on every scenario card", () => {
  it.each(
    cards.flatMap((card) => LANGUAGES.map((language) => [card, language])),
  )("%s %s", (card, language) => {
    const pieces = piecesOf(card, language);
    const next = seeded(
      [...`${card}${language}`].reduce(
        (sum, char) => (sum * 31 + char.charCodeAt(0)) | 0,
        7,
      ),
    );
    for (let sequence = 0; sequence < SEQUENCES_PER_CARD; sequence++) {
      const length = 2 + Math.floor(next() * (MAX_EVENTS - 1));
      const events: SpokenCardEvent[] = [{ type: "start" }];
      for (let at = 1; at < length; at++)
        events.push(randomEvent(next, pieces));
      checkRun(pieces, events, `${card} ${language} ${JSON.stringify(events)}`);
    }
  });
});
