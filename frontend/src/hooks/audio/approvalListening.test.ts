import { i18n } from "@lingui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import data from "@/lib/toolCallGist/fixtures/spokenCards/calls.json";
import expectedPieces from "@/lib/toolCallGist/fixtures/spokenCards/expected.json";
import {
  currentPiece,
  namesLongText,
  piecesAhead,
  spokenCardFlow,
  spokenCardStep,
  voiceDecisionGate,
} from "@/lib/toolCallGist/spokenCardFlow";
import { messages as deMessages } from "@/locales/de/messages.json";

import { commandPieces, stepForMeaning } from "./approvalListening";

import type { VoiceChange, VoiceChangeOutcome } from "./approvalChanges";
import type { ApprovalVoiceMeaning } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { SpokenPiece } from "@/lib/toolCallGist/spokenCard";
import type {
  SpokenCardEvent,
  SpokenCardFlow,
  SpokenUtterance,
} from "@/lib/toolCallGist/spokenCardFlow";
import type { SSEOptions } from "@/utils/sse/sseClient";
import type { Messages } from "@lingui/core";

/**
 * Layer 1 of design section 9 for listening: what each meaning does to a
 * card, for every kind of card with and without a long text, wherever the
 * voice fell silent. And the listener against the endpoint: what it sends,
 * what it says, and that no decision can leave this path.
 */

// ---------------------------------------------------------------------------
// The cards

interface Scenario {
  id: string;
  kind: string[];
}

const { scenarios } = data as unknown as { scenarios: Scenario[] };
const expected = expectedPieces as unknown as Record<
  string,
  Record<string, SpokenPiece[][]>
>;

/** Kinds a card is said in full for; the first four also with a long text added. */
const KINDS = [
  "read",
  "create",
  "update",
  "delete",
  "send",
  "batch",
  "queue",
  "builtin_tool",
] as const;
type Kind = (typeof KINDS)[number];
const SINGLE_KINDS: readonly Kind[] = ["read", "create", "update", "delete"];

const LONG_TEXT: SpokenPiece = {
  id: "text:Meeting notes",
  role: "text",
  text: "Meeting notes: ein Text von etwa 120 Wörtern, er steht auf dem Bildschirm.",
  mustSay: false,
  values: [
    { slot: "field", value: { kind: "text", text: "Meeting notes" } },
    { slot: "words", value: { kind: "number", value: 120, percent: false } },
  ],
  readOut: { text: "Ein langer Text. ".repeat(40).trim(), cut: false },
};

/** A card of `kind` with a long text: from the set, or with one added before its consequence. */
const withLongText = (pieces: SpokenPiece[]): SpokenPiece[] => {
  if (pieces.some(namesLongText)) return pieces;
  const at = pieces.findIndex(
    (piece) => piece.role === "consequence" || piece.role === "request",
  );
  return [...pieces.slice(0, at), LONG_TEXT, ...pieces.slice(at)];
};

/**
 * The set's cards of `kind`: a single kind alone, or any scenario that has
 * it (a send, a batch, each card of a queue, a built-in tool's pointer).
 */
const cardsOf = (kind: Kind, longText: boolean) =>
  scenarios
    .filter((scenario) =>
      SINGLE_KINDS.includes(kind)
        ? scenario.kind.length === 1 && scenario.kind[0] === kind
        : scenario.kind.includes(kind),
    )
    .flatMap((scenario) =>
      (["de", "en"] as const).flatMap((language) =>
        expected[scenario.id][language].map((pieces, index) => ({
          name: `${scenario.id}#${index} ${language}`,
          pieces: longText
            ? withLongText(pieces)
            : pieces.filter((piece) => !namesLongText(piece)),
        })),
      ),
    )
    .filter(({ pieces }) =>
      pieces[0].role === "pointer"
        ? kind === "builtin_tool" && !longText
        : true,
    );

// ---------------------------------------------------------------------------
// Where the voice fell silent, the only times the microphone is open

const POSITIONS = [
  "after_request",
  "stopped_in_detail",
  "stopped_in_long_text",
  "stopped_in_consequence",
  "after_notice",
] as const;
type Position = (typeof POSITIONS)[number];

const step = (
  pieces: readonly SpokenPiece[],
  flow: SpokenCardFlow,
  event: SpokenCardEvent,
) => spokenCardStep(pieces, flow, event);

const finishAll = (pieces: readonly SpokenPiece[], flow: SpokenCardFlow) => {
  const said: SpokenUtterance[] = [];
  let next = flow;
  for (let steps = 0; next.playing !== null; steps++) {
    expect(steps).toBeLessThan(4 * pieces.length + 4);
    const after = step(pieces, next, { type: "finished" });
    if (after.started !== next.started && after.playing)
      said.push(after.playing);
    next = after;
  }
  return { flow: next, said };
};

const roleOf = (pieces: readonly SpokenPiece[], flow: SpokenCardFlow) =>
  flow.playing?.type === "piece" ? pieces[flow.playing.index].role : null;

/** The card brought to `position` and quiet there, or undefined where it has no such place. */
const quietAt = (
  pieces: readonly SpokenPiece[],
  position: Position,
): SpokenCardFlow | undefined => {
  let flow = step(pieces, spokenCardFlow(pieces), { type: "start" });
  const until = (role: SpokenPiece["role"]) => {
    for (let steps = 0; steps <= pieces.length; steps++) {
      if (roleOf(pieces, flow) === role)
        return step(pieces, flow, { type: "stop" });
      if (flow.playing === null) return undefined;
      flow = step(pieces, flow, { type: "finished" });
    }
    return undefined;
  };
  switch (position) {
    case "after_request":
      return finishAll(pieces, flow).flow;
    case "stopped_in_detail":
      return until("detail");
    case "stopped_in_long_text": {
      if (!pieces.some(namesLongText)) return undefined;
      flow = step(pieces, finishAll(pieces, flow).flow, { type: "read" });
      return step(pieces, flow, { type: "stop" });
    }
    case "stopped_in_consequence":
      return until("consequence");
    case "after_notice": {
      flow = finishAll(pieces, flow).flow;
      flow = step(pieces, flow, {
        type: "notice",
        notice: { kind: "unclear", hasText: false },
      });
      return finishAll(pieces, flow).flow;
    }
  }
};

const MEANINGS: readonly ApprovalVoiceMeaning[] = [
  "skip",
  "rest",
  "repeat",
  "read_text",
  "stop",
  "change",
  "new_request",
  "approve",
  "reject",
  "noise",
  "unclear",
];

const pieceIndex = (utterance: SpokenUtterance | undefined) =>
  utterance?.type === "piece" ? utterance.index : null;

describe("what a meaning does to a waiting card", () => {
  const combinations = KINDS.flatMap((kind) =>
    [false, true].flatMap((longText) =>
      cardsOf(kind, longText).flatMap((card) =>
        POSITIONS.flatMap((position) =>
          MEANINGS.map((meaning) => ({
            kind,
            longText,
            card,
            position,
            meaning,
          })),
        ),
      ),
    ),
  ).filter(
    (combination) =>
      quietAt(combination.card.pieces, combination.position) !== undefined,
  );

  it("covers every kind with and without a long text, every meaning and every place", () => {
    for (const kind of [...SINGLE_KINDS, "send"])
      for (const longText of [false, true])
        expect(
          combinations.some(
            (entry) => entry.kind === kind && entry.longText === longText,
          ),
          `${kind} ${longText}`,
        ).toBe(true);
    for (const kind of KINDS)
      expect(
        combinations.some((entry) => entry.kind === kind),
        kind,
      ).toBe(true);
    expect(new Set(combinations.map((entry) => entry.position)).size).toBe(
      POSITIONS.length,
    );
    expect(new Set(combinations.map((entry) => entry.meaning)).size).toBe(
      MEANINGS.length,
    );
  });

  const groups = new Map<string, typeof combinations>();
  for (const entry of combinations) {
    const group = `${entry.kind}, ${entry.longText ? "with" : "without"} a long text: ${entry.meaning}`;
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }

  it.each([...groups.entries()])("%s", (_group, entries) => {
    for (const entry of entries) {
      try {
        checkMeaning(entry);
      } catch (error) {
        throw new Error(
          `${entry.card.name} ${entry.position}: ${(error as Error).message}`,
        );
      }
    }
  });

  function checkMeaning({
    card,
    position,
    meaning,
  }: (typeof combinations)[number]) {
    const { pieces } = card;
    const before = quietAt(pieces, position) as SpokenCardFlow;
    const request = pieces.findIndex((piece) => piece.role === "request");
    // The endpoint names the piece the voice stopped in, or the last one.
    const current = currentPiece(before);
    const pieceId = current === null ? null : pieces[current].id;
    const { event, listen, change } = stepForMeaning(meaning, pieceId, pieces);

    const after = event ? step(pieces, before, event) : before;
    const said: SpokenUtterance[] =
      after.started !== before.started && after.playing ? [after.playing] : [];
    const end = finishAll(pieces, after);
    said.push(...end.said);

    // Nothing a listener says decides or withdraws the card.
    expect(end.flow.closed).toBe(false);
    // A change is sent by the listener and listens no more: the next card,
    // or a sentence about what came of it, follows.
    expect(listen).toBe(meaning !== "stop" && meaning !== "change");
    expect(change === true).toBe(meaning === "change");
    before.heard.forEach((heard, index) => {
      if (heard) expect(end.flow.heard[index]).toBe(true);
    });
    // The request is never started while a loss or consequence is owed.
    let replay = before;
    for (const entry of [event, ...end.said.map(() => null)]) {
      const next = entry
        ? step(pieces, replay, entry)
        : step(pieces, replay, { type: "finished" });
      if (
        next.started !== replay.started &&
        pieceIndex(next.playing ?? undefined) === request
      )
        expect(next.owed).toEqual([]);
      replay = next;
    }

    switch (meaning) {
      case "approve":
      case "reject":
        expect(said).toEqual([
          {
            type: "notice",
            notice: { kind: "decide_on_screen", decision: meaning },
          },
        ]);
        expect(end.flow.states).toEqual(before.states);
        break;
      case "change":
        expect(said).toEqual([]);
        expect(end.flow.states).toEqual(before.states);
        break;
      case "new_request":
        expect(said).toEqual([
          { type: "notice", notice: { kind: "new_request_on_screen" } },
        ]);
        expect(end.flow.states).toEqual(before.states);
        break;
      case "noise":
      case "stop":
        expect(said).toEqual([]);
        break;
      case "unclear":
        expect(said).toEqual([
          {
            type: "notice",
            notice: { kind: "unclear", hasText: pieces.some(namesLongText) },
          },
        ]);
        break;
      case "read_text":
        expect(said[0]).toEqual(
          pieces.some(namesLongText)
            ? {
                type: "text",
                index:
                  current !== null && namesLongText(pieces[current])
                    ? current
                    : pieces.findIndex(namesLongText),
              }
            : { type: "notice", notice: { kind: "no_text" } },
        );
        break;
      case "repeat":
        expect(said[0]).toEqual(
          current === null
            ? { type: "piece", index: 0 }
            : current === before.lastRead
              ? { type: "text", index: current }
              : {
                  type: "piece",
                  index:
                    current === request && before.owed.length > 0
                      ? before.owed[0]
                      : current,
                },
        );
        break;
      case "rest": {
        const content = said.filter(
          (utterance) =>
            utterance.type === "piece" && utterance.index !== request,
        );
        expect(said[0]).toEqual(
          content.length === 0
            ? { type: "nothing_left" }
            : { type: "count", count: content.length },
        );
        // Nothing heard in full is said again; the request closes it.
        for (const utterance of content)
          expect(before.heard[pieceIndex(utterance) as number]).toBe(false);
        if (request !== -1) expect(pieceIndex(said.at(-1))).toBe(request);
        break;
      }
      case "skip": {
        const ahead = piecesAhead(pieces, before.states, before.heard);
        if (ahead.length === 0) {
          expect(said[0]).toEqual({ type: "nothing_left" });
        } else {
          // What was cut short is dropped; only a loss or a consequence
          // comes back before the request.
          const first = pieceIndex(said[0]);
          expect(first).not.toBeNull();
          expect(ahead).toContain(
            first === before.owed[0] ? ahead.at(-1) : first,
          );
          if (current !== null && !pieces[current].mustSay)
            expect(
              said.filter((utterance) => pieceIndex(utterance) === current),
            ).toEqual([]);
        }
        break;
      }
    }

    // Afterwards a decision by voice may count only once the request was
    // heard and nothing is owed.
    const gate = voiceDecisionGate(pieces, end.flow);
    if (gate.ready) {
      expect(gate.owed).toEqual([]);
      if (request !== -1) expect(end.flow.heard[request]).toBe(true);
    }
  }
});

describe("the card as the endpoint takes it", () => {
  const pieces = expected["delete-04-contact"].de[0];

  it("sends heard, cut short and not said, with unique ids and fields", () => {
    let flow = step(pieces, spokenCardFlow(pieces), { type: "start" });
    flow = step(pieces, flow, { type: "finished" });
    flow = step(pieces, flow, { type: "stop" });
    const sent = commandPieces(pieces, flow);
    expect(sent.map((piece) => piece.state)).toEqual([
      "heard",
      "cut_short",
      "not_said",
    ]);
    expect(new Set(sent.map((piece) => piece.id)).size).toBe(sent.length);
    expect(sent.every((piece) => piece.id.length <= 64)).toBe(true);
  });

  it("names the field of a detail and a text", () => {
    const update = expected["update-08-long-text"].de[0];
    const sent = commandPieces(update, spokenCardFlow(update));
    expect(sent.find((piece) => piece.role === "text")?.field).toBeTruthy();
  });

  it("keeps a piece heard in an earlier reading heard", () => {
    let flow = step(pieces, spokenCardFlow(pieces), { type: "start" });
    flow = finishAll(pieces, flow).flow;
    flow = step(pieces, flow, { type: "start" });
    expect(commandPieces(pieces, flow).map((piece) => piece.state)).toEqual([
      "heard",
      "heard",
      "heard",
    ]);
  });
});

describe("a card read as pieces keeps its ids", () => {
  it("gives every piece of every card a unique id of at most 64 characters", () => {
    for (const [scenario, languages] of Object.entries(expected))
      for (const [language, cards] of Object.entries(languages))
        for (const card of cards) {
          const ids = card.map((piece) => piece.id);
          expect(new Set(ids).size, `${scenario} ${language}`).toBe(ids.length);
          for (const id of ids) expect(Array.from(id).length).toBeLessThan(65);
        }
  });

  it("gives a piece the same id in both languages", () => {
    for (const [scenario, languages] of Object.entries(expected))
      expect(
        languages.de.map((card) => card.map((piece) => piece.id)),
        scenario,
      ).toEqual(languages.en.map((card) => card.map((piece) => piece.id)));
  });
});

// ---------------------------------------------------------------------------
// Against the endpoint

const fetchCommand = vi.fn();
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchInterpretApprovalVoiceCommand: (...args: unknown[]) =>
    fetchCommand(...args),
}));

interface Connection {
  url: string;
  options: SSEOptions;
  close: ReturnType<typeof vi.fn>;
}
const connections: Connection[] = [];
const sources: { onended: (() => void) | null }[] = [];

vi.mock("@/utils/sse/sseClient", () => ({
  createSSEConnection: (url: string, options: SSEOptions) => {
    const connection: Connection = { url, options, close: vi.fn() };
    connections.push(connection);
    return connection.close;
  },
}));

class MockAudioContext {
  state = "running";
  currentTime = 1;
  destination = {};
  resume = vi.fn(async () => {});
  createBuffer(_channels: number, length: number, rate: number) {
    return {
      duration: length / rate,
      getChannelData: () => new Float32Array(length),
    };
  }
  createGain() {
    return {
      context: this,
      gain: { value: 1, setTargetAtTime: vi.fn() },
      connect: vi.fn(),
    };
  }
  createBufferSource() {
    const source = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      stop: vi.fn(),
      start: vi.fn(),
      buffer: null,
      onended: null,
    };
    sources.push(source);
    return source;
  }
}

let sequence = 0;
/** Twelve seconds of silence: enough for any sentence to count as said. */
const SPEECH = globalThis.btoa("\0".repeat(2 * 8000 * 12));
const audio = (connection: Connection, index: number, speech = SPEECH) => {
  connection.options.onMessage?.({
    type: "audio_delta",
    data: JSON.stringify({
      message_type: "audio_delta",
      sequence: sequence++,
      audio: speech,
      sample_rate: 8000,
      piece: index,
    }),
  });
  connection.options.onMessage?.({
    type: "piece_done",
    data: JSON.stringify({ message_type: "piece_done", piece: index }),
  });
};
const playOut = () => sources.at(-1)?.onended?.();
const sentences = (connection: Connection) =>
  (JSON.parse(connection.options.body as string) as { pieces: string[] })
    .pieces;

const KEY = "message-1:stop-1";
const CARD = expected["update-08-long-text"].de[0];

/** A card read to its end; the voice is quiet and the microphone would open. */
async function heardCard(change?: VoiceChange) {
  const speech = await import("./approvalSpeech");
  const listening = await import("./approvalListening");
  const changes = await import("./approvalChanges");
  const { useSpeechPlayback } = await import("./speechPlayback");
  useSpeechPlayback.setState({ conversational: true, enabled: true });
  speech.speakApprovalCard({
    key: KEY,
    messageId: "message-1",
    pieces: CARD,
    language: "de",
    approval: { type: "pointer" },
    ...(change ? { change } : {}),
  });
  await vi.waitFor(() => expect(connections).toHaveLength(1));
  CARD.forEach((_, index) => {
    audio(connections[0], index);
    playOut();
  });
  expect(speech.useApprovalSpeech.getState().speaking).toBe(false);
  return { ...speech, ...listening, ...changes, useSpeechPlayback };
}

/** A card the screen lets change, recording what it was asked to send. */
const changeable = (
  outcome: VoiceChangeOutcome | Promise<VoiceChangeOutcome> = "sent",
  ready = true,
) => {
  const send = vi.fn((_words: string) => Promise.resolve(outcome));
  const change: VoiceChange = {
    approvalId: "call-7",
    ready: () => ready,
    send,
  };
  return { change, send };
};

describe("listening against the endpoint", () => {
  let locale = "en";
  beforeEach(() => {
    locale = i18n.locale;
    i18n.load("de", deMessages as unknown as Messages);
    i18n.activate("de");
    vi.resetModules();
    connections.length = 0;
    sources.length = 0;
    sequence = 0;
    fetchCommand.mockReset();
    vi.stubGlobal("AudioContext", MockAudioContext);
  });
  afterEach(() => {
    i18n.activate(locale);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends the words with the pieces and what was heard, and says the rest", async () => {
    const { heardApprovalWords, useApprovalSpeech } = await heardCard();
    fetchCommand.mockResolvedValue({
      meaning: "rest",
      piece_id: null,
      source: "rules",
    });
    await heardApprovalWords(KEY, "  hab ich, was noch?  ");
    const [variables] = fetchCommand.mock.calls[0] as [
      {
        pathParams: { messageId: string };
        body: {
          transcript: string;
          language: string;
          pieces: { id: string; role: string; state: string }[];
          current_piece_id: string;
        };
      },
    ];
    expect(variables.pathParams.messageId).toBe("message-1");
    expect(variables.body.transcript).toBe("hab ich, was noch?");
    expect(variables.body.language).toBe("de");
    expect(variables.body.pieces.map((piece) => piece.state)).toEqual(
      CARD.map(() => "heard"),
    );
    expect(variables.body.current_piece_id).toBe(CARD.at(-1)?.id);
    // Everything was heard: "that was all", then the request again.
    expect(connections).toHaveLength(2);
    expect(sentences(connections[1])).toEqual(["Das war alles."]);
    audio(connections[1], 0);
    playOut();
    expect(useApprovalSpeech.getState().current).toBe(CARD.length - 1);
  });

  it("reads the long text on request, in passages", async () => {
    const { heardApprovalWords } = await heardCard();
    const text = CARD.findIndex(namesLongText);
    fetchCommand.mockResolvedValue({
      meaning: "read_text",
      piece_id: CARD[text].id,
      source: "rules",
    });
    await heardApprovalWords(KEY, "lies den Text vor");
    const read = sentences(connections[1]);
    expect(read.length).toBeGreaterThan(0);
    expect(read.join(" ")).toContain(
      CARD[text].readOut?.text.slice(0, 40) ?? "",
    );
    for (const passage of read) expect(passage.length).toBeLessThan(401);
    expect(read.join("").length).toBeLessThan(2001);
  });

  it.each(["approve", "reject"] as const)(
    "%s: says the decision is made on screen, and sends no decision",
    async (meaning) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { heardApprovalWords, useApprovalSpeech } = await heardCard();
      fetchCommand.mockResolvedValue({
        meaning,
        piece_id: null,
        source: "rules",
      });
      await heardApprovalWords(KEY, meaning === "approve" ? "ja" : "nein");
      expect(sentences(connections[1])).toEqual([
        meaning === "approve"
          ? "Zustimmen geht im Moment nur auf dem Bildschirm."
          : "Ablehnen geht im Moment nur auf dem Bildschirm.",
      ]);
      audio(connections[1], 0);
      playOut();
      expect(useApprovalSpeech.getState().closed).toBe(false);
      expect(useApprovalSpeech.getState().speaking).toBe(false);
      // Only the voice and the voice command endpoint were asked; nothing
      // continues the stream with a decision.
      expect(fetchSpy).not.toHaveBeenCalled();
      for (const connection of connections)
        expect(connection.url).toMatch(/\/approval-speech$/);
      fetchSpy.mockRestore();
    },
  );

  it("stop: the voice stays quiet and the card stops listening", async () => {
    const { heardApprovalWords, useApprovalListening, useApprovalSpeech } =
      await heardCard();
    fetchCommand.mockResolvedValue({
      meaning: "stop",
      piece_id: null,
      source: "rules",
    });
    await heardApprovalWords(KEY, "stopp");
    expect(connections).toHaveLength(1);
    expect(useApprovalListening.getState().quiet).toBe(KEY);
    expect(useApprovalSpeech.getState().closed).toBe(false);
  });

  it("noise is ignored and the card keeps listening", async () => {
    const { heardApprovalWords, useApprovalListening } = await heardCard();
    fetchCommand.mockResolvedValue({
      meaning: "noise",
      piece_id: null,
      source: "rules",
    });
    await heardApprovalWords(KEY, "mhm");
    expect(connections).toHaveLength(1);
    expect(useApprovalListening.getState()).toEqual({
      pending: null,
      quiet: null,
    });
  });

  it("a failing endpoint is said once; the card waits on screen and stops listening", async () => {
    const { heardApprovalWords, useApprovalListening } = await heardCard();
    fetchCommand.mockRejectedValue({ status: 500, payload: "" });
    await heardApprovalWords(KEY, "was noch?");
    expect(sentences(connections[1])).toEqual([
      "Sprachbefehle gehen gerade nicht. Die Karte wartet auf dem Bildschirm.",
    ]);
    expect(useApprovalListening.getState().quiet).toBe(KEY);
  });

  it("an endpoint that does not answer in time is treated as failing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const {
      heardApprovalWords,
      useApprovalListening,
      VOICE_COMMAND_TIMEOUT_MS,
    } = await heardCard();
    fetchCommand.mockImplementation(
      (_variables: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new Error("Network error (aborted)")),
          );
        }),
    );
    const heard = heardApprovalWords(KEY, "was noch?");
    expect(useApprovalListening.getState().pending).toBe(KEY);
    await vi.advanceTimersByTimeAsync(VOICE_COMMAND_TIMEOUT_MS);
    await heard;
    expect(useApprovalListening.getState().pending).toBeNull();
    expect(useApprovalListening.getState().quiet).toBe(KEY);
    expect(sentences(connections[1])[0]).toMatch(/^Sprachbefehle/);
  });

  it("says nothing for a card decided on screen while the words were understood", async () => {
    const { heardApprovalWords, forgetApprovalCards } = await heardCard();
    let answer: (value: unknown) => void = () => {};
    fetchCommand.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const heard = heardApprovalWords(KEY, "nochmal");
    forgetApprovalCards([KEY]);
    answer({ meaning: "repeat", piece_id: CARD[0].id, source: "rules" });
    await heard;
    expect(connections).toHaveLength(1);
  });

  it("says nothing once audio mode was left", async () => {
    const { heardApprovalWords, useSpeechPlayback } = await heardCard();
    let answer: (value: unknown) => void = () => {};
    fetchCommand.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const heard = heardApprovalWords(KEY, "nochmal");
    useSpeechPlayback.setState({ conversational: false });
    answer({ meaning: "repeat", piece_id: CARD[0].id, source: "rules" });
    await heard;
    expect(connections).toHaveLength(1);
  });

  it("a card decided meanwhile (409) says nothing", async () => {
    const { heardApprovalWords } = await heardCard();
    fetchCommand.mockRejectedValue({ status: 409, payload: "" });
    await heardApprovalWords(KEY, "nochmal");
    expect(connections).toHaveLength(1);
  });

  it.each([
    ["unclear", null],
    ["stop", null],
    ["skip", null],
    ["repeat", "request"],
  ] as const)(
    "review 3: a late %s does not steer a reading restarted by tap",
    async (meaning, piece) => {
      const {
        heardApprovalWords,
        replayApprovalCard,
        useApprovalListening,
        useApprovalSpeech,
      } = await heardCard();
      let answer: (value: unknown) => void = () => {};
      fetchCommand.mockReturnValue(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      const heard = heardApprovalWords(KEY, "hm, wie bitte");
      replayApprovalCard();
      await vi.waitFor(() => expect(connections).toHaveLength(2));
      audio(connections[1], 0);
      answer({
        meaning,
        piece_id: piece === null ? null : CARD.at(-1)?.id,
        source: "model",
      });
      await heard;
      // The new reading goes on from its first piece, nothing else is said.
      expect(connections).toHaveLength(2);
      expect(useApprovalSpeech.getState().current).toBe(0);
      expect(useApprovalSpeech.getState().speaking).toBe(true);
      expect(useApprovalListening.getState().quiet).toBeNull();
    },
  );

  it("review 3: a timeout after a restarted reading says nothing and keeps listening on", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const {
      heardApprovalWords,
      replayApprovalCard,
      useApprovalListening,
      VOICE_COMMAND_TIMEOUT_MS,
    } = await heardCard();
    fetchCommand.mockImplementation(
      (_variables: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new Error("Network error (aborted)")),
          );
        }),
    );
    const heard = heardApprovalWords(KEY, "was noch?");
    replayApprovalCard();
    await vi.waitFor(() => expect(connections).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(VOICE_COMMAND_TIMEOUT_MS);
    await heard;
    expect(connections).toHaveLength(2);
    expect(useApprovalListening.getState()).toEqual({
      pending: null,
      quiet: null,
    });
  });

  it("review 4: 'again' right after a read-out text reads the text again", async () => {
    const { heardApprovalWords, useApprovalSpeech } = await heardCard();
    const text = CARD.findIndex(namesLongText);
    fetchCommand.mockResolvedValueOnce({
      meaning: "read_text",
      piece_id: CARD[text].id,
      source: "rules",
    });
    await heardApprovalWords(KEY, "lies den Text vor");
    // The text is read, then the request again; the voice falls quiet.
    sentences(connections[1]).forEach((_, part) => {
      audio(connections[1], part);
      playOut();
    });
    audio(connections[0], CARD.length - 1);
    playOut();
    expect(useApprovalSpeech.getState().speaking).toBe(false);

    fetchCommand.mockImplementationOnce(
      (variables: { body: { current_piece_id: string } }) =>
        Promise.resolve({
          meaning: "repeat",
          piece_id: variables.body.current_piece_id,
          source: "rules",
        }),
    );
    await heardApprovalWords(KEY, "nochmal");
    const [variables] = fetchCommand.mock.calls[1] as [
      { body: { current_piece_id: string } },
    ];
    expect(variables.body.current_piece_id).toBe(CARD[text].id);
    expect(connections).toHaveLength(3);
    expect(sentences(connections[2])).toEqual(sentences(connections[1]));
  });

  describe("a change asked for by voice", () => {
    const answer = (meaning: string) =>
      fetchCommand.mockResolvedValue({
        meaning,
        piece_id: null,
        source: "model",
      });
    /** Plays the confirmation out, so the change goes out. */
    const confirm = async () => {
      await vi.waitFor(() => expect(connections).toHaveLength(2));
      expect(sentences(connections[1])).toEqual([
        "In Ordnung, ich ändere das.",
      ]);
      audio(connections[1], 0);
      playOut();
    };

    it("confirms, then sends the change for this card's approval with the user's words", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { change, send } = changeable();
      const { heardApprovalWords, useApprovalChanges, useApprovalListening } =
        await heardCard(change);
      answer("change");
      const heard = heardApprovalWords(KEY, "  nimm den 22.  ");
      await confirm();
      await heard;
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith("nimm den 22.");
      const record = useApprovalChanges.getState().records["call-7"];
      expect(record).toMatchObject({
        messageId: "message-1",
        approvalId: "call-7",
        words: "  nimm den 22.  ",
        state: "sent",
        round: 1,
      });
      expect(record.heard).toEqual(CARD.map((piece) => piece.id));
      expect(useApprovalListening.getState().quiet).toBe(KEY);
      // No decision went anywhere but through the card's own change.
      expect(fetchSpy).not.toHaveBeenCalled();
      for (const connection of connections)
        expect(connection.url).toMatch(/\/approval-speech$/);
      fetchSpy.mockRestore();
    });

    it("sends long dictated words up to the change request's limit", async () => {
      const { change, send } = changeable();
      const { heardApprovalWords } = await heardCard(change);
      answer("change");
      const words = `nimm den 22. ${"und noch etwas dazu ".repeat(80)}`;
      const heard = heardApprovalWords(KEY, words);
      await confirm();
      await heard;
      const [{ body }] = fetchCommand.mock.calls[0] as [
        { body: { transcript: string } },
      ];
      expect(body.transcript).toHaveLength(300);
      expect(send.mock.calls[0][0]).toHaveLength(1000);
      expect(send.mock.calls[0][0]).toBe(words.slice(0, 1000));
    });

    it("a card the voice cannot change says so and keeps listening", async () => {
      const { heardApprovalWords, useApprovalListening, useApprovalChanges } =
        await heardCard();
      answer("change");
      await heardApprovalWords(KEY, "nimm den 22.");
      expect(sentences(connections[1])).toEqual([
        "Diese Karte lässt sich nicht per Sprache ändern. Bitte auf dem Bildschirm entscheiden.",
      ]);
      expect(useApprovalListening.getState().quiet).toBeNull();
      expect(useApprovalChanges.getState().records).toEqual({});
    });

    it("with other approvals still open, asks for those first and sends nothing", async () => {
      const { change, send } = changeable("sent", false);
      const { heardApprovalWords } = await heardCard(change);
      answer("change");
      await heardApprovalWords(KEY, "nimm den 22.");
      expect(sentences(connections[1])[0]).toMatch(
        /^Bitte zuerst über die anderen Freigaben/,
      );
      expect(send).not.toHaveBeenCalled();
    });

    it("a failed request is said once; the card keeps waiting and stops listening", async () => {
      const { change, send } = changeable("failed");
      const {
        heardApprovalWords,
        useApprovalChanges,
        useApprovalListening,
        useApprovalSpeech,
      } = await heardCard(change);
      answer("change");
      const heard = heardApprovalWords(KEY, "nimm den 22.");
      await confirm();
      await heard;
      expect(send).toHaveBeenCalledTimes(1);
      expect(connections).toHaveLength(3);
      expect(sentences(connections[2])).toEqual([
        "Die Änderung ließ sich nicht senden. Die Karte wartet auf dem Bildschirm.",
      ]);
      expect(useApprovalSpeech.getState().closed).toBe(false);
      expect(useApprovalListening.getState().quiet).toBe(KEY);
      expect(useApprovalChanges.getState().records).toEqual({});
    });

    it("a request that throws counts as failed", async () => {
      const { change } = changeable();
      change.send = () => Promise.reject(new Error("offline"));
      const { heardApprovalWords } = await heardCard(change);
      answer("change");
      const heard = heardApprovalWords(KEY, "nimm den 22.");
      await confirm();
      await heard;
      expect(sentences(connections[2])[0]).toMatch(/^Die Änderung ließ sich/);
    });

    it("a card changed elsewhere meanwhile (409) says so, though the card is gone", async () => {
      const { change } = changeable();
      const { heardApprovalWords, forgetApprovalCards } =
        await heardCard(change);
      change.send = () => {
        forgetApprovalCards([KEY]);
        return Promise.resolve("conflict");
      };
      answer("change");
      const heard = heardApprovalWords(KEY, "nimm den 22.");
      await confirm();
      await heard;
      expect(sentences(connections[2])).toEqual([
        "Die Karte hat sich inzwischen geändert. Bitte auf dem Bildschirm nachsehen.",
      ]);
    });

    it("sends nothing for a card decided on screen during the confirmation", async () => {
      const { change, send } = changeable();
      const { heardApprovalWords, forgetApprovalCards, useApprovalChanges } =
        await heardCard(change);
      answer("change");
      const heard = heardApprovalWords(KEY, "nimm den 22.");
      await vi.waitFor(() => expect(connections).toHaveLength(2));
      forgetApprovalCards([KEY]);
      await heard;
      expect(send).not.toHaveBeenCalled();
      expect(useApprovalChanges.getState().records).toEqual({});
    });

    it("sends nothing once audio mode was left during the confirmation", async () => {
      const { change, send } = changeable();
      const { heardApprovalWords, useSpeechPlayback } = await heardCard(change);
      answer("change");
      const heard = heardApprovalWords(KEY, "nimm den 22.");
      await vi.waitFor(() => expect(connections).toHaveLength(2));
      useSpeechPlayback.setState({ conversational: false });
      await heard;
      expect(send).not.toHaveBeenCalled();
    });

    it("goes out after a confirmation that never ends", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { change, send } = changeable();
      const { heardApprovalWords, CONFIRMATION_WAIT_MS } =
        await heardCard(change);
      answer("change");
      const heard = heardApprovalWords(KEY, "nimm den 22.");
      await vi.waitFor(() => expect(connections).toHaveLength(2));
      await vi.advanceTimersByTimeAsync(CONFIRMATION_WAIT_MS);
      await heard;
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("a change said before any piece was heard records nothing as heard", async () => {
      const { change } = changeable();
      const speech = await import("./approvalSpeech");
      const listening = await import("./approvalListening");
      const { useApprovalChanges } = await import("./approvalChanges");
      const { useSpeechPlayback } = await import("./speechPlayback");
      useSpeechPlayback.setState({ conversational: true, enabled: true });
      speech.speakApprovalCard({
        key: KEY,
        messageId: "message-1",
        pieces: CARD,
        language: "de",
        change,
      });
      await vi.waitFor(() => expect(connections).toHaveLength(1));
      speech.stopApprovalSpeech();
      answer("change");
      const heard = listening.heardApprovalWords(KEY, "nimm den 22.");
      await confirm();
      await heard;
      expect(useApprovalChanges.getState().records["call-7"].heard).toEqual([]);
    });

    it("a new request keeps the card waiting and says what can be done", async () => {
      const { change, send } = changeable();
      const { heardApprovalWords, useApprovalListening } =
        await heardCard(change);
      answer("new_request");
      await heardApprovalWords(KEY, "wie wird das Wetter morgen?");
      expect(sentences(connections[1])).toEqual([
        "Zuerst diese Karte: auf dem Bildschirm entscheiden oder sagen, was anders sein soll. Danach die neue Bitte einfach noch einmal sagen.",
      ]);
      expect(send).not.toHaveBeenCalled();
      expect(useApprovalListening.getState().quiet).toBeNull();
    });

    it.each(["approve", "reject"] as const)(
      "%s on a changeable card sends nothing through it",
      async (meaning) => {
        const { change, send } = changeable();
        const { heardApprovalWords } = await heardCard(change);
        answer(meaning);
        await heardApprovalWords(KEY, meaning === "approve" ? "ja" : "nein");
        expect(send).not.toHaveBeenCalled();
      },
    );
  });

  it("words for another card do nothing", async () => {
    const { heardApprovalWords } = await heardCard();
    await heardApprovalWords("message-1:stop-0", "nochmal");
    expect(fetchCommand).not.toHaveBeenCalled();
  });

  describe("talking over the voice", () => {
    const DELETE = expected["delete-01-task-created-earlier"].de[0];
    const CONSEQUENCE = DELETE.findIndex(
      (piece) => piece.role === "consequence",
    );
    const TEXT = CARD.findIndex(namesLongText);

    /**
     * The voice is in the middle of piece `at`: the pieces before it were
     * heard, and the card's audio has arrived only up to that piece.
     */
    async function talkedOverAt(pieces: SpokenPiece[], at: number) {
      const speech = await import("./approvalSpeech");
      const listening = await import("./approvalListening");
      const { useSpeechPlayback } = await import("./speechPlayback");
      useSpeechPlayback.setState({ conversational: true, enabled: true });
      speech.speakApprovalCard({
        key: KEY,
        messageId: "message-1",
        pieces,
        language: "de",
        approval: { type: "pointer" },
      });
      await vi.waitFor(() => expect(connections).toHaveLength(1));
      for (let index = 0; index <= at; index += 1) {
        audio(connections[0], index);
        if (index < at) playOut();
      }
      expect(speech.useApprovalSpeech.getState().current).toBe(at);
      listening.talkOverApprovalCard(KEY);
      return { ...speech, ...listening, useSpeechPlayback };
    }

    const answer = (meaning: string, piece_id: string | null = null) =>
      fetchCommand.mockResolvedValue({ meaning, piece_id, source: "model" });

    it("cuts the piece being said short and stops the voice; the card keeps waiting", async () => {
      const { useApprovalSpeech, spokenApprovalCardNow } = await talkedOverAt(
        CARD,
        TEXT,
      );
      const state = useApprovalSpeech.getState();
      expect(state.speaking).toBe(false);
      expect(state.closed).toBe(false);
      expect(state.pieces.map((piece) => piece.state)).toEqual([
        "heard",
        "cut",
        "pending",
      ]);
      expect(spokenApprovalCardNow()?.flow.heard[TEXT]).toBe(false);
    });

    it("sends the cut piece as cut short with the words, and says only what is left", async () => {
      const { heardApprovalWords } = await talkedOverAt(CARD, TEXT);
      answer("rest");
      await heardApprovalWords(KEY, "hab ich, was noch?");
      const [variables] = fetchCommand.mock.calls[0] as [
        { body: { pieces: { state: string }[]; current_piece_id: string } },
      ];
      expect(variables.body.pieces.map((piece) => piece.state)).toEqual([
        "heard",
        "cut_short",
        "not_said",
      ]);
      expect(variables.body.current_piece_id).toBe(CARD[TEXT].id);
      expect(sentences(connections.at(-1) as Connection)).toEqual([
        "Das war alles.",
      ]);
    });

    it("a must-say piece cut over the voice stays owed: skipping says it before the request", async () => {
      const { heardApprovalWords, spokenApprovalCardNow, useApprovalSpeech } =
        await talkedOverAt(DELETE, CONSEQUENCE);
      expect(spokenApprovalCardNow()?.flow.owed).toEqual([CONSEQUENCE]);
      answer("skip");
      await heardApprovalWords(KEY, "weiter");
      expect(useApprovalSpeech.getState().current).toBe(CONSEQUENCE);
      expect(useApprovalSpeech.getState().speaking).toBe(true);
    });

    it("reads the long text when asked over the voice", async () => {
      const { heardApprovalWords } = await talkedOverAt(CARD, 0);
      answer("read_text");
      await heardApprovalWords(KEY, "lies den Text vor");
      expect(sentences(connections.at(-1) as Connection).join(" ")).toContain(
        CARD[TEXT].readOut?.text.slice(0, 40) ?? "",
      );
    });

    it("'stopp' over the voice: the voice stays quiet and the card stops listening", async () => {
      const { heardApprovalWords, useApprovalListening, useApprovalSpeech } =
        await talkedOverAt(CARD, TEXT);
      answer("stop");
      await heardApprovalWords(KEY, "stopp");
      expect(useApprovalSpeech.getState().speaking).toBe(false);
      expect(useApprovalListening.getState().quiet).toBe(KEY);
      expect(connections).toHaveLength(1);
    });

    it.each(["approve", "reject"] as const)(
      "%s over the voice only says that deciding is on screen",
      async (meaning) => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const { heardApprovalWords, useApprovalSpeech } = await talkedOverAt(
          DELETE,
          CONSEQUENCE,
        );
        answer(meaning);
        await heardApprovalWords(KEY, meaning === "approve" ? "ja" : "nein");
        expect(sentences(connections.at(-1) as Connection)[0]).toMatch(
          /nur auf dem Bildschirm/,
        );
        expect(useApprovalSpeech.getState().closed).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
      },
    );

    it("a sound with no meaning ('mhm') goes on with the cut piece from its start", async () => {
      const { heardApprovalWords, useApprovalSpeech } = await talkedOverAt(
        CARD,
        TEXT,
      );
      answer("noise");
      await heardApprovalWords(KEY, "mhm");
      expect(useApprovalSpeech.getState().current).toBe(TEXT);
      expect(useApprovalSpeech.getState().speaking).toBe(true);
    });

    it("no words at all (a cough) go on with the cut piece from its start", async () => {
      const { resumeTalkedOverCard, useApprovalSpeech } = await talkedOverAt(
        DELETE,
        CONSEQUENCE,
      );
      resumeTalkedOverCard(KEY);
      expect(fetchCommand).not.toHaveBeenCalled();
      expect(useApprovalSpeech.getState().current).toBe(CONSEQUENCE);
      expect(useApprovalSpeech.getState().speaking).toBe(true);
    });

    it("noise without talking over the voice still changes nothing", async () => {
      const { heardApprovalWords, resumeTalkedOverCard, useApprovalSpeech } =
        await heardCard();
      answer("noise");
      await heardApprovalWords(KEY, "mhm");
      resumeTalkedOverCard(KEY);
      expect(useApprovalSpeech.getState().speaking).toBe(false);
      expect(connections).toHaveLength(1);
    });

    it("review 2: the card's stream breaking after the cut says nothing", async () => {
      const { useApprovalSpeech, useSpeechPlayback } = await talkedOverAt(
        CARD,
        0,
      );
      connections[0].options.onError?.(new Error("network"));
      connections[0].options.onClose?.();
      expect(useApprovalSpeech.getState()).toMatchObject({
        speaking: false,
        failed: false,
      });
      expect(useSpeechPlayback.getState().failed).toBe(false);
      expect(connections).toHaveLength(1);
    });

    it("review 3: a late answer does not steer a reading restarted by tap", async () => {
      const { heardApprovalWords, replayApprovalCard, useApprovalSpeech } =
        await talkedOverAt(CARD, TEXT);
      let reply: (value: unknown) => void = () => {};
      fetchCommand.mockReturnValue(
        new Promise((resolve) => {
          reply = resolve;
        }),
      );
      const heard = heardApprovalWords(KEY, "mhm");
      replayApprovalCard();
      await vi.waitFor(() => expect(connections).toHaveLength(2));
      reply({ meaning: "noise", piece_id: null, source: "model" });
      await heard;
      expect(useApprovalSpeech.getState().current).toBe(0);
      expect(connections).toHaveLength(2);
    });

    it("a reading restarted by tap is not resumed at the old cut", async () => {
      const { replayApprovalCard, resumeTalkedOverCard, useApprovalSpeech } =
        await talkedOverAt(CARD, TEXT);
      replayApprovalCard();
      await vi.waitFor(() => expect(connections).toHaveLength(2));
      resumeTalkedOverCard(KEY);
      expect(useApprovalSpeech.getState().current).toBe(0);
    });

    it("talking over a card that has since closed does nothing", async () => {
      const speech = await import("./approvalSpeech");
      const { talkOverApprovalCard } = await import("./approvalListening");
      const { useSpeechPlayback } = await import("./speechPlayback");
      useSpeechPlayback.setState({ conversational: true, enabled: true });
      speech.speakApprovalCard({
        key: KEY,
        messageId: "message-1",
        pieces: CARD,
        language: "de",
      });
      await vi.waitFor(() => expect(connections).toHaveLength(1));
      speech.forgetApprovalCards([KEY]);
      talkOverApprovalCard(KEY);
      expect(speech.useApprovalSpeech.getState().closed).toBe(true);
      talkOverApprovalCard("message-1:other");
      expect(speech.useApprovalSpeech.getState().speaking).toBe(false);
    });
  });
});
