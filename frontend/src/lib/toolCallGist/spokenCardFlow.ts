/* eslint-disable lingui/no-unlocalized-strings -- utterance and event names of this module */
import type { SpokenPiece } from "./spokenCard";

/**
 * What the voice says next on a spoken approval card, as a pure function of
 * the card's pieces, what has been heard of each, and what just happened.
 * The player and the controls only follow it. Three rules of the design hold
 * for every event:
 *
 * - nothing is said twice unless the listener asks for it;
 * - a loss or consequence that was cut short is said once more before the
 *   request to decide, so skipping content never skips a consequence;
 * - no event decides the card: it waits until a decision closes it.
 */

export type SpokenPieceState = "pending" | "playing" | "heard" | "cut";

/** One thing the voice says: a piece of the card, or a sentence about them. */
export type SpokenUtterance =
  | { type: "piece"; index: number }
  /** Before the rest: how many pieces follow ("Noch zwei Dinge"). */
  | { type: "count"; count: number }
  /** The rest was asked for and nothing is left ("Das war alles"). */
  | { type: "nothing_left" }
  /** A long text the piece at `index` names, read out on request. */
  | { type: "text"; index: number };

export type SpokenCardEvent =
  /** Say the card from its start: on its own, or when asked to again. */
  | { type: "start" }
  /** What was being said has played to its end. */
  | { type: "finished" }
  /** The voice could not say it. */
  | { type: "failed" }
  /** Skip what is being said and go on. */
  | { type: "skip" }
  /** Only what was not heard yet, with how much that is first. */
  | { type: "rest" }
  /** The piece being said, or the one named, again. */
  | { type: "repeat"; index?: number }
  /** Read out the long text the piece named, or the card's first one, names. */
  | { type: "read"; index?: number }
  /** Quiet; the card keeps waiting. */
  | { type: "stop" }
  /** A decision was taken, or the card was replaced: the voice ends. */
  | { type: "closed" };

export interface SpokenCardFlow {
  states: SpokenPieceState[];
  /** What is being said, or null while the voice is quiet. */
  playing: SpokenUtterance | null;
  /** Bumped each time something starts, so a piece said again is told apart. */
  started: number;
  /** What was asked for, said after `playing` and before the rest goes on. */
  queue: SpokenUtterance[];
  /** Losses and consequences already said a second time after a cut. */
  repeated: number[];
  /** The last piece said to its end, for "again" while nothing plays. */
  last: number | null;
  /** The voice failed: nothing was heard, so the pointer sentence can stand in. */
  failed: "fallback" | "notice" | null;
  /** Decided or replaced: no event says anything any more. */
  closed: boolean;
}

export const spokenCardFlow = (
  pieces: readonly SpokenPiece[],
): SpokenCardFlow => ({
  states: pieces.map(() => "pending"),
  playing: null,
  started: 0,
  queue: [],
  repeated: [],
  last: null,
  failed: null,
  closed: false,
});

/** Whether a piece names a long text instead of reading it. */
export const namesLongText = (piece: SpokenPiece): boolean =>
  piece.role === "text" &&
  (piece.values?.some((source) => source.slot === "words") ?? false);

const owed = (
  pieces: readonly SpokenPiece[],
  states: readonly SpokenPieceState[],
  repeated: readonly number[],
): number[] =>
  pieces.flatMap((piece, index) =>
    piece.mustSay && states[index] === "cut" && !repeated.includes(index)
      ? [index]
      : [],
  );

/**
 * The pieces still to say when nothing else is asked for, in order: those
 * not said yet, with any loss or consequence that was cut short before the
 * request, or last when the request was said already.
 */
export const piecesAhead = (
  pieces: readonly SpokenPiece[],
  states: readonly SpokenPieceState[],
  repeated: readonly number[],
): number[] => {
  const pending = pieces.flatMap((_, index) =>
    states[index] === "pending" ? [index] : [],
  );
  const due = owed(pieces, states, repeated);
  const request = pending.findIndex(
    (index) => pieces[index].role === "request",
  );
  return request === -1
    ? [...pending, ...due]
    : [...pending.slice(0, request), ...due, ...pending.slice(request)];
};

const pieceOf = (utterance: SpokenUtterance | null): number | null =>
  utterance?.type === "piece" ? utterance.index : null;

/** Sets the piece being said to `state`; a text read on request keeps its own. */
const leave = (
  flow: SpokenCardFlow,
  state: "heard" | "cut" | "pending",
): SpokenPieceState[] => {
  const index = pieceOf(flow.playing);
  if (index === null) return flow.states;
  return flow.states.map((current, at) => (at === index ? state : current));
};

/** Starts `utterance`, or falls quiet when there is none. */
const begin = (
  pieces: readonly SpokenPiece[],
  flow: SpokenCardFlow,
  utterance: SpokenUtterance | null,
): SpokenCardFlow => {
  if (utterance === null) return { ...flow, playing: null };
  let { states, repeated } = flow;
  if (utterance.type === "piece") {
    const { index } = utterance;
    if (pieces[index].mustSay && states[index] === "cut") {
      repeated = [...repeated, index];
    }
    states = states.map((state, at) => (at === index ? "playing" : state));
  }
  return {
    ...flow,
    states,
    repeated,
    playing: utterance,
    started: flow.started + 1,
  };
};

/**
 * What comes next once the current utterance is over: what was asked for
 * first, then the pieces ahead. The request waits for an owed consequence
 * whichever way it comes.
 */
const advance = (
  pieces: readonly SpokenPiece[],
  flow: SpokenCardFlow,
): SpokenCardFlow => {
  const asked = flow.queue.at(0);
  const queue = flow.queue.slice(1);
  if (asked === undefined) {
    const next = piecesAhead(pieces, flow.states, flow.repeated).at(0);
    return begin(
      pieces,
      { ...flow, queue },
      next === undefined ? null : { type: "piece", index: next },
    );
  }
  const index = pieceOf(asked);
  if (index !== null && pieces[index].role === "request") {
    const due = owed(pieces, flow.states, flow.repeated).at(0);
    if (due !== undefined) {
      return begin(pieces, flow, { type: "piece", index: due });
    }
  }
  return begin(pieces, { ...flow, queue }, asked);
};

const longTextTarget = (
  pieces: readonly SpokenPiece[],
  flow: SpokenCardFlow,
  index: number | undefined,
): number | undefined => {
  if (index !== undefined) {
    return pieces[index] && namesLongText(pieces[index]) ? index : undefined;
  }
  const playing = pieceOf(flow.playing) ?? undefined;
  if (playing !== undefined && namesLongText(pieces[playing])) return playing;
  const first = pieces.findIndex(namesLongText);
  return first === -1 ? undefined : first;
};

/** The card after `event`; `playing` and `started` tell the player what to say. */
export const spokenCardStep = (
  pieces: readonly SpokenPiece[],
  flow: SpokenCardFlow,
  event: SpokenCardEvent,
): SpokenCardFlow => {
  if (flow.closed) return flow;
  switch (event.type) {
    case "start":
      return advance(pieces, {
        ...spokenCardFlow(pieces),
        started: flow.started,
      });
    case "finished": {
      if (flow.playing === null) return flow;
      const finished = pieceOf(flow.playing);
      const textRead =
        flow.playing.type === "text" ? flow.playing.index : undefined;
      const states = leave(flow, "heard").map((state, at) =>
        at === textRead && state === "pending" ? "heard" : state,
      );
      return advance(pieces, {
        ...flow,
        states,
        last: finished ?? flow.last,
      });
    }
    case "skip": {
      if (flow.playing === null) return flow;
      // A text read on request is skipped to its end; its piece is done.
      const textRead =
        flow.playing.type === "text" ? flow.playing.index : undefined;
      const states = leave(flow, "cut").map((state, at) =>
        at === textRead && state === "pending" ? "cut" : state,
      );
      return advance(pieces, { ...flow, states });
    }
    case "rest": {
      const states = leave(flow, "cut");
      const ahead = piecesAhead(pieces, states, flow.repeated);
      const request = pieces.findIndex((piece) => piece.role === "request");
      const content = ahead.filter((index) => index !== request);
      const closing =
        request !== -1 && !ahead.includes(request)
          ? [{ type: "piece", index: request } as const]
          : [];
      const queue: SpokenUtterance[] = [
        ...ahead.map((index) => ({ type: "piece", index }) as const),
        ...closing,
      ];
      return begin(
        pieces,
        { ...flow, states, queue },
        content.length === 0
          ? { type: "nothing_left" }
          : { type: "count", count: content.length },
      );
    }
    case "repeat": {
      const target = event.index ?? pieceOf(flow.playing) ?? flow.last;
      if (target === null || !(target in pieces)) return flow;
      // What the listener interrupted is not skipped: it follows the repeat.
      const states =
        pieceOf(flow.playing) === target ? flow.states : leave(flow, "pending");
      return begin(
        pieces,
        { ...flow, states },
        { type: "piece", index: target },
      );
    }
    case "read": {
      const target = longTextTarget(pieces, flow, event.index);
      if (target === undefined) return flow;
      const playing = pieceOf(flow.playing);
      const states =
        playing === target ? leave(flow, "heard") : leave(flow, "pending");
      return begin(
        pieces,
        { ...flow, states },
        { type: "text", index: target },
      );
    }
    case "stop":
      return { ...flow, states: leave(flow, "cut"), playing: null, queue: [] };
    case "failed": {
      const states = leave(flow, "cut");
      return {
        ...flow,
        states,
        playing: null,
        queue: [],
        failed: states.includes("heard") ? "notice" : "fallback",
      };
    }
    case "closed":
      return {
        ...flow,
        states: leave(flow, "cut"),
        playing: null,
        queue: [],
        closed: true,
      };
  }
};
