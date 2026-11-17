/* eslint-disable lingui/no-unlocalized-strings -- utterance and event names of this module */
import type { SpokenPiece } from "./spokenCard";

/**
 * What the voice says next on a spoken approval card, as a pure function of
 * the card's pieces, what has been heard of each, and what just happened.
 * The player and the controls only follow it. Nothing is planned ahead: what
 * comes next is read off the pieces' states at every step, so a later event
 * can never leave a stale plan behind. The rules of the design hold for
 * every sequence of events:
 *
 * - nothing is said twice in one reading unless the listener asks for it;
 * - a piece heard in full once stays heard, whatever happens to a repeat;
 * - the request to decide is never started while a loss or consequence has
 *   not been heard in full: that piece comes first, however often it is
 *   skipped;
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
  | { type: "text"; index: number }
  /** A sentence about what the voice cannot do (yet); the card stays as it is. */
  | { type: "notice"; notice: SpokenNotice };

/**
 * What the voice says instead of acting: a decision asked for by voice,
 * which is made on screen for now; a change it is making, or cannot make;
 * what came of a change; words it did not understand; a long text asked for
 * on a card without one; listening that is not available.
 */
export type SpokenNotice =
  | { kind: "decide_on_screen"; decision: "approve" | "reject" }
  /** `others`: other approvals of the stop are still open on screen. */
  | { kind: "change_on_screen"; reason: "card" | "others" }
  | { kind: "changing" }
  | { kind: "change_failed" }
  /** The card was decided or replaced meanwhile, elsewhere. */
  | { kind: "change_conflict" }
  /** The answer to a change came without a card; `several`: after many rounds. */
  | { kind: "change_no_card"; several: boolean }
  | { kind: "new_request_on_screen" }
  | { kind: "unclear"; hasText: boolean }
  | { kind: "no_text" }
  | { kind: "unavailable" };

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
  /** Say `notice`; afterwards the voice is quiet and the card waits. */
  | { type: "notice"; notice: SpokenNotice }
  /**
   * A decision was taken, or the card was replaced: the voice ends.
   * `withdrawn` is a card taken back for a change, which no decision closed.
   */
  | { type: "closed"; withdrawn?: boolean };

export interface SpokenCardFlow {
  /** Where each piece stands in the current reading. */
  states: SpokenPieceState[];
  /** Each piece heard in full at least once, in any reading. */
  heard: boolean[];
  /**
   * Losses and consequences not heard in full yet, in order. While any is
   * left the request is not said, and a decision by voice must not count.
   */
  owed: number[];
  /** What is being said, or null while the voice is quiet. */
  playing: SpokenUtterance | null;
  /** Bumped each time something starts, so a piece said again is told apart. */
  started: number;
  /** The last piece said to its end, for "again" while nothing plays. */
  last: number | null;
  /** The last piece that was being said, to its end or cut short. */
  previous: number | null;
  /**
   * The piece whose long text was read out last, while nothing but the
   * request was said after it: "again" then means that text.
   */
  lastRead: number | null;
  /** The voice failed: nothing was heard, so the pointer sentence can stand in. */
  failed: "fallback" | "notice" | null;
  /** Decided or replaced: no event says anything any more. */
  closed: boolean;
  /** Closed because it was taken back for a change, not decided. */
  withdrawn: boolean;
}

const owedOf = (
  pieces: readonly SpokenPiece[],
  heard: readonly boolean[],
): number[] =>
  pieces.flatMap((piece, index) =>
    piece.mustSay && !heard[index] ? [index] : [],
  );

export const spokenCardFlow = (
  pieces: readonly SpokenPiece[],
): SpokenCardFlow => {
  const heard = pieces.map(() => false);
  return {
    states: pieces.map(() => "pending"),
    heard,
    owed: owedOf(pieces, heard),
    playing: null,
    started: 0,
    last: null,
    previous: null,
    lastRead: null,
    failed: null,
    closed: false,
    withdrawn: false,
  };
};

/** Whether a piece names a long text instead of reading it. */
export const namesLongText = (piece: SpokenPiece): boolean =>
  piece.role === "text" &&
  (piece.values?.some((source) => source.slot === "words") ?? false);

const requestOf = (pieces: readonly SpokenPiece[]): number =>
  pieces.findIndex((piece) => piece.role === "request");

/**
 * The pieces still to say in this reading, in order: those not said yet,
 * then any loss or consequence cut short before it was heard, then the
 * request.
 */
export const piecesAhead = (
  pieces: readonly SpokenPiece[],
  states: readonly SpokenPieceState[],
  heard: readonly boolean[],
): number[] => {
  const request = requestOf(pieces);
  const pending = pieces.flatMap((_, index) =>
    states[index] === "pending" && index !== request ? [index] : [],
  );
  const due = pieces.flatMap((piece, index) =>
    piece.mustSay && states[index] === "cut" && !heard[index] ? [index] : [],
  );
  return [
    ...pending,
    ...due,
    ...(request !== -1 && states[request] === "pending" ? [request] : []),
  ];
};

const pieceOf = (utterance: SpokenUtterance | null): number | null =>
  utterance?.type === "piece" ? utterance.index : null;

/** `index` set to `state`, unless it was heard in full before. */
const withState = (
  flow: SpokenCardFlow,
  index: number,
  state: SpokenPieceState,
): SpokenCardFlow => ({
  ...flow,
  states: flow.states.map((current, at) =>
    at === index
      ? flow.heard[at] && state !== "playing"
        ? "heard"
        : state
      : current,
  ),
});

/** The piece being said leaves off: heard to its end, or cut short. */
const leave = (
  flow: SpokenCardFlow,
  outcome: "heard" | "cut" | "pending",
): SpokenCardFlow => {
  const index = pieceOf(flow.playing);
  if (index === null) return flow;
  const next =
    outcome === "heard"
      ? { ...flow, heard: flow.heard.map((value, at) => value || at === index) }
      : flow;
  return withState({ ...next, previous: index }, index, outcome);
};

/**
 * Starts `utterance`, or falls quiet when there is none. The request waits
 * for every loss and consequence not heard yet: the first of them is said
 * instead, and the request follows it.
 */
const begin = (
  pieces: readonly SpokenPiece[],
  flow: SpokenCardFlow,
  utterance: SpokenUtterance | null,
): SpokenCardFlow => {
  if (utterance === null) return { ...flow, playing: null };
  let next = flow;
  let said = utterance;
  const request = requestOf(pieces);
  if (pieceOf(utterance) === request) {
    const owed = owedOf(pieces, flow.heard).at(0);
    if (owed !== undefined) {
      next = {
        ...next,
        states: next.states.map((state, at) =>
          at === request ? "pending" : state,
        ),
      };
      said = { type: "piece", index: owed };
    }
  }
  const playing = pieceOf(said);
  return {
    ...(playing === null ? next : withState(next, playing, "playing")),
    playing: said,
    started: next.started + 1,
  };
};

/** Goes on with the first piece still to say in this reading. */
const advance = (
  pieces: readonly SpokenPiece[],
  flow: SpokenCardFlow,
): SpokenCardFlow => {
  const next = piecesAhead(pieces, flow.states, flow.heard).at(0);
  return begin(
    pieces,
    flow,
    next === undefined ? null : { type: "piece", index: next },
  );
};

const longTextTarget = (
  pieces: readonly SpokenPiece[],
  flow: SpokenCardFlow,
  index: number | undefined,
): number | undefined => {
  if (index !== undefined) {
    return index in pieces && namesLongText(pieces[index]) ? index : undefined;
  }
  const playing = pieceOf(flow.playing);
  if (playing !== null && namesLongText(pieces[playing])) return playing;
  const first = pieces.findIndex(namesLongText);
  return first === -1 ? undefined : first;
};

/** What the listener interrupted is not skipped: it follows from its start. */
const interrupt = (flow: SpokenCardFlow, target: number | null) =>
  pieceOf(flow.playing) === target ? flow : leave(flow, "pending");

const step = (
  pieces: readonly SpokenPiece[],
  flow: SpokenCardFlow,
  event: SpokenCardEvent,
): SpokenCardFlow => {
  switch (event.type) {
    case "start":
      // A new reading says every piece again; what was heard stays heard.
      return advance(pieces, {
        ...flow,
        states: pieces.map(() => "pending"),
        playing: null,
        failed: null,
      });
    case "finished": {
      const { playing } = flow;
      if (playing === null) return flow;
      if (playing.type === "notice") return { ...flow, playing: null };
      let next = leave(flow, "heard");
      if (playing.type === "text") {
        next = withState(
          {
            ...next,
            heard: next.heard.map((value, at) => value || at === playing.index),
          },
          playing.index,
          "heard",
        );
      }
      return advance(pieces, {
        ...next,
        last: pieceOf(playing) ?? flow.last,
      });
    }
    case "skip": {
      const { playing } = flow;
      // Quiet, "go on" says what is left of this reading; with nothing left
      // it is the rest: "that was all", and the request again.
      if (playing === null) {
        return piecesAhead(pieces, flow.states, flow.heard).length === 0
          ? step(pieces, flow, { type: "rest" })
          : advance(pieces, flow);
      }
      let next = leave(flow, "cut");
      // A text read on request is skipped to its end; its piece is done.
      if (playing.type === "text" && next.states[playing.index] === "pending") {
        next = withState(next, playing.index, "cut");
      }
      return advance(pieces, next);
    }
    case "rest": {
      let next = leave(flow, "cut");
      const request = requestOf(pieces);
      // Only what was never heard in full; it ends with the request, said
      // again if it was heard.
      next = {
        ...next,
        states: next.states.map((state, at) =>
          at === request
            ? "pending"
            : state === "pending" && next.heard[at]
              ? "heard"
              : state,
        ),
      };
      const content = piecesAhead(pieces, next.states, next.heard).filter(
        (index) => index !== request,
      );
      return begin(
        pieces,
        next,
        content.length === 0
          ? { type: "nothing_left" }
          : { type: "count", count: content.length },
      );
    }
    case "repeat": {
      const target =
        event.index ?? pieceOf(flow.playing) ?? flow.lastRead ?? flow.last;
      if (target === null || !(target in pieces)) return flow;
      // Again, right after a text was read out, is the text.
      if (target === flow.lastRead && flow.playing === null)
        return step(pieces, flow, { type: "read", index: target });
      return begin(pieces, interrupt(flow, target), {
        type: "piece",
        index: target,
      });
    }
    case "read": {
      const target = longTextTarget(pieces, flow, event.index);
      if (target === undefined) return flow;
      const next =
        pieceOf(flow.playing) === target
          ? leave(flow, "heard")
          : interrupt(flow, null);
      return begin(pieces, next, { type: "text", index: target });
    }
    case "stop":
      return { ...leave(flow, "cut"), playing: null };
    case "notice":
      return begin(pieces, interrupt(flow, null), {
        type: "notice",
        notice: event.notice,
      });
    case "failed": {
      const next = leave(flow, "cut");
      return {
        ...next,
        playing: null,
        failed: next.heard.some(Boolean) ? "notice" : "fallback",
      };
    }
    case "closed":
      return {
        ...leave(flow, "cut"),
        playing: null,
        closed: true,
        withdrawn: event.withdrawn === true,
      };
  }
};

/** The card after `event`; `playing` and `started` tell the player what to say. */
export const spokenCardStep = (
  pieces: readonly SpokenPiece[],
  flow: SpokenCardFlow,
  event: SpokenCardEvent,
): SpokenCardFlow => {
  if (flow.closed) return flow;
  const next = step(pieces, flow, event);
  if (next === flow) return flow;
  return {
    ...next,
    owed: owedOf(pieces, next.heard),
    lastRead: lastReadAfter(pieces, flow, next, event),
  };
};

/** A text read out stays "the last one" until other content is said. */
const lastReadAfter = (
  pieces: readonly SpokenPiece[],
  before: SpokenCardFlow,
  after: SpokenCardFlow,
  event: SpokenCardEvent,
): number | null => {
  if (event.type === "start") return null;
  const started = after.started !== before.started;
  const now = pieceOf(after.playing);
  if (started && now !== null && now !== requestOf(pieces)) return null;
  const left =
    before.playing?.type === "text" && after.playing !== before.playing
      ? before.playing.index
      : null;
  return left ?? after.lastRead;
};

/** A piece's state as the voice command endpoint takes it. */
export type HeardState = "heard" | "cut_short" | "not_said";

/**
 * What the listener has heard of each piece: heard in full once, in any
 * reading; cut short; or not said yet, which includes the piece being said.
 */
export const heardStates = (flow: SpokenCardFlow): HeardState[] =>
  flow.states.map((state, index) =>
    flow.heard[index] ? "heard" : state === "cut" ? "cut_short" : "not_said",
  );

/** The piece being said or read out, or else the last one that was. */
export const currentPiece = (flow: SpokenCardFlow): number | null =>
  pieceOf(flow.playing) ??
  (flow.playing?.type === "text" ? flow.playing.index : null) ??
  flow.lastRead ??
  flow.previous;

/**
 * Whether a decision said by voice may count: the card is waiting, its
 * request to decide was heard, and no loss or consequence is owed. `owed`
 * lists what must be said first. Nothing decides by voice yet; this is the
 * gate that step plugs into.
 */
export const voiceDecisionGate = (
  pieces: readonly SpokenPiece[],
  flow: SpokenCardFlow,
): { ready: boolean; owed: number[] } => {
  const request = requestOf(pieces);
  const asked = request === -1 || flow.heard[request];
  return {
    ready: !flow.closed && asked && flow.owed.length === 0,
    owed: flow.owed,
  };
};
