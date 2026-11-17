import { i18n } from "@lingui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import data from "@/lib/toolCallGist/fixtures/spokenCards/calls.json";
import expectedPieces from "@/lib/toolCallGist/fixtures/spokenCards/expected.json";
import {
  namesLongText,
  piecesAhead,
  spokenCardFlow,
  spokenCardStep,
  voiceDecisionGate,
} from "@/lib/toolCallGist/spokenCardFlow";
import { messages as deMessages } from "@/locales/de/messages.json";

import { commandPieces, stepForMeaning } from "./approvalListening";

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

const KINDS = ["read", "create", "update", "delete"] as const;
type Kind = (typeof KINDS)[number];

const LONG_TEXT: SpokenPiece = {
  id: "text:Description",
  role: "text",
  text: "Description: ein Text von etwa 120 Wörtern, er steht auf dem Bildschirm.",
  mustSay: false,
  values: [
    { slot: "field", value: { kind: "text", text: "Description" } },
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

const cardsOf = (kind: Kind, longText: boolean) =>
  scenarios
    .filter(
      (scenario) => scenario.kind.length === 1 && scenario.kind[0] === kind,
    )
    .flatMap((scenario) =>
      (["de", "en"] as const).map((language) => {
        const pieces = expected[scenario.id][language][0];
        return {
          name: `${scenario.id} ${language}`,
          pieces: longText
            ? withLongText(pieces)
            : pieces.filter((piece) => !namesLongText(piece)),
        };
      }),
    )
    .filter(({ pieces }) => pieces[0].role !== "pointer");

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
    for (const kind of KINDS)
      for (const longText of [false, true])
        expect(
          combinations.some(
            (entry) => entry.kind === kind && entry.longText === longText,
          ),
          `${kind} ${longText}`,
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
    const current = before.previous;
    const pieceId = current === null ? null : pieces[current].id;
    const { event, listen } = stepForMeaning(meaning, pieceId, pieces);

    const after = event ? step(pieces, before, event) : before;
    const said: SpokenUtterance[] =
      after.started !== before.started && after.playing ? [after.playing] : [];
    const end = finishAll(pieces, after);
    said.push(...end.said);

    // Nothing a listener says decides or withdraws the card.
    expect(end.flow.closed).toBe(false);
    expect(listen).toBe(meaning !== "stop");
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
      case "new_request":
        expect(said).toEqual([
          {
            type: "notice",
            notice: {
              kind:
                meaning === "change"
                  ? "change_on_screen"
                  : "new_request_on_screen",
            },
          },
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
const audio = (connection: Connection, index: number) => {
  connection.options.onMessage?.({
    type: "audio_delta",
    data: JSON.stringify({
      message_type: "audio_delta",
      sequence: sequence++,
      audio: "AQIDBA==",
      sample_rate: 24000,
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
async function heardCard() {
  const speech = await import("./approvalSpeech");
  const listening = await import("./approvalListening");
  const { useSpeechPlayback } = await import("./speechPlayback");
  useSpeechPlayback.setState({ conversational: true, enabled: true });
  speech.speakApprovalCard({
    key: KEY,
    messageId: "message-1",
    pieces: CARD,
    language: "de",
  });
  await vi.waitFor(() => expect(connections).toHaveLength(1));
  CARD.forEach((_, index) => {
    audio(connections[0], index);
    playOut();
  });
  expect(speech.useApprovalSpeech.getState().speaking).toBe(false);
  return { ...speech, ...listening, useSpeechPlayback };
}

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

  it("words for another card do nothing", async () => {
    const { heardApprovalWords } = await heardCard();
    await heardApprovalWords("message-1:stop-0", "nochmal");
    expect(fetchCommand).not.toHaveBeenCalled();
  });
});
