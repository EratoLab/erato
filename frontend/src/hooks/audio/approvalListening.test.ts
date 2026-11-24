import { i18n } from "@lingui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import data from "@/lib/toolCallGist/fixtures/spokenCards/calls.json";
import expectedPieces from "@/lib/toolCallGist/fixtures/spokenCards/expected.json";
import visitReportCalls from "@/lib/toolCallGist/fixtures/spokenCards/visitReport.json";
import {
  spokenApprovalFor,
  spokenApprovalPieces,
  spokenPieceField,
} from "@/lib/toolCallGist/spokenCard";
import {
  currentPiece,
  longTexts,
  namesLongText,
  piecesAhead,
  spokenCardFlow,
  spokenCardStep,
  voiceDecisionGate,
} from "@/lib/toolCallGist/spokenCardFlow";
import { spokenWordsFor } from "@/lib/toolCallGist/spokenCardWords";
import { messages as deMessages } from "@/locales/de/messages.json";

import { commandPieces, stepForMeaning } from "./approvalListening";

import type {
  VoiceChange,
  VoiceChangeOutcome,
  VoiceDecision,
} from "./approvalChanges";
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
    // After a stop it listens on for commands.
    expect(listen).toBe(meaning !== "change");
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
      case "read_text": {
        const texts = longTexts(pieces);
        expect(said[0]).toEqual(
          texts.length === 0
            ? { type: "notice", notice: { kind: "no_text" } }
            : current !== null && namesLongText(pieces[current])
              ? { type: "text", index: current }
              : texts.length === 1
                ? { type: "text", index: texts[0] }
                : {
                    type: "notice",
                    notice: {
                      kind: "which_text",
                      fields: texts.map(
                        (index) => spokenPieceField(pieces[index]) ?? "",
                      ),
                    },
                  },
        );
        break;
      }
      case "repeat":
        expect(said[0]).toEqual(
          current === null
            ? { type: "piece", index: 0 }
            : current === before.lastRead
              ? { type: "text", index: current }
              : {
                  type: "piece",
                  // Again at the request is the whole card, from its start.
                  index: current === request ? 0 : current,
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
  fetchWaitLines: () => Promise.reject(new Error("no wait lines in tests")),
}));

interface Connection {
  url: string;
  options: SSEOptions;
  close: ReturnType<typeof vi.fn>;
}
const connections: Connection[] = [];
const sources: { onended: (() => void) | null; stop: () => void }[] = [];

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
async function heardCard(
  change?: VoiceChange,
  pieces: SpokenPiece[] = CARD,
  decision?: VoiceDecision,
) {
  const speech = await import("./approvalSpeech");
  const listening = await import("./approvalListening");
  const changes = await import("./approvalChanges");
  const { useSpeechPlayback } = await import("./speechPlayback");
  useSpeechPlayback.setState({ conversational: true, enabled: true });
  speech.speakApprovalCard({
    key: KEY,
    messageId: "message-1",
    pieces,
    language: "de",
    approval: { type: "pointer" },
    ...(change ? { change } : {}),
    ...(decision ? { decision } : {}),
  });
  await vi.waitFor(() => expect(connections).toHaveLength(1));
  pieces.forEach((_, index) => {
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

  describe("ERMAIN-1241: reading a text when the card has several", () => {
    // The staging visit report: a dictated summary and a text said by its length.
    const DICTATED: SpokenPiece = {
      ...CARD[1],
      id: "text:erato_summary",
      text: "Zusammenfassung: ein Teil des diktierten Textes, wörtlich.",
      values: [
        { slot: "field", value: { kind: "text", text: "Zusammenfassung" } },
        { slot: "dictated", value: { kind: "text", text: "part" } },
      ],
      readOut: {
        text: "Kunde will die Mischstation bis Dezember, Budget ist freigegeben.",
        cut: false,
        dictated: "part",
      },
    };
    const NEED: SpokenPiece = {
      ...CARD[1],
      id: "text:erato_customerneed",
      text: "Kundenbedarf: ein Text von etwa 16 Wörtern, er steht auf dem Bildschirm.",
      values: [
        { slot: "field", value: { kind: "text", text: "Kundenbedarf" } },
        { slot: "words", value: { kind: "number", value: 16, percent: false } },
      ],
      readOut: {
        text: "Zweite Variante der Mischstation mit größerem Durchsatz.",
        cut: false,
      },
    };
    const TWO_TEXTS = [CARD[0], DICTATED, NEED, CARD.at(-1) as SpokenPiece];
    const ONE_DICTATED = [CARD[0], DICTATED, CARD.at(-1) as SpokenPiece];
    const answer = (meaning: ApprovalVoiceMeaning, pieceId?: string) =>
      fetchCommand.mockResolvedValueOnce({
        meaning,
        piece_id: pieceId ?? null,
        source: "rules",
      });
    const bodyOf = (call: number) =>
      (fetchCommand.mock.calls[call] as [{ body: Record<string, unknown> }])[0]
        .body;

    it("one text, the dictated one: 'Lies den Text vor' reads it", async () => {
      const { heardApprovalWords } = await heardCard(undefined, ONE_DICTATED);
      answer("read_text");
      await heardApprovalWords(KEY, "Lies den Text vor");
      expect(sentences(connections[1]).join(" ")).toContain(
        "Kunde will die Mischstation",
      );
    });

    it("several texts, none named: the voice asks which, naming them", async () => {
      const { heardApprovalWords, useApprovalListening, useApprovalSpeech } =
        await heardCard(undefined, TWO_TEXTS);
      const heardBefore = useApprovalSpeech.getState();
      answer("read_text");
      await heardApprovalWords(KEY, "Lies den Text vor");
      expect(sentences(connections[1])).toEqual([
        "Welchen Text: Zusammenfassung oder Kundenbedarf?",
      ]);
      expect(useApprovalListening.getState().askedWhichText).toBe(KEY);
      // The question is no piece of the card: nothing counts as heard by it.
      audio(connections[1], 0);
      playOut();
      const { spokenApprovalCardNow } = await import("./approvalSpeech");
      expect(spokenApprovalCardNow()?.flow.heard).toEqual(
        TWO_TEXTS.map(() => true),
      );
      expect(heardBefore.closed).toBe(false);
    });

    it("several texts, one named: it is read without a question", async () => {
      const { heardApprovalWords } = await heardCard(undefined, TWO_TEXTS);
      answer("read_text", NEED.id);
      await heardApprovalWords(KEY, "Lies den Kundenbedarf vor");
      expect(sentences(connections[1]).join(" ")).toContain(
        "Zweite Variante der Mischstation",
      );
    });

    it.each(["read_text", "repeat"] as const)(
      "the answer to the question, understood as %s, reads the named text",
      async (meaning) => {
        const { heardApprovalWords, useApprovalListening } = await heardCard(
          undefined,
          TWO_TEXTS,
        );
        answer("read_text");
        await heardApprovalWords(KEY, "Lies den Text vor");
        audio(connections[1], 0);
        playOut();
        answer(meaning, DICTATED.id);
        await heardApprovalWords(KEY, "die Zusammenfassung");
        // The answer goes to the endpoint saying what was asked.
        expect(bodyOf(1).question).toBe("which_text");
        expect(bodyOf(0).question).toBeUndefined();
        expect(sentences(connections[2]).join(" ")).toContain(
          "Kunde will die Mischstation",
        );
        expect(useApprovalListening.getState().askedWhichText).toBeNull();
      },
    );

    it("an answer that names no text is not taken as one", async () => {
      const { heardApprovalWords } = await heardCard(undefined, TWO_TEXTS);
      answer("read_text");
      await heardApprovalWords(KEY, "Lies den Text vor");
      audio(connections[1], 0);
      playOut();
      answer("read_text");
      await heardApprovalWords(KEY, "egal");
      expect(sentences(connections[2])).toEqual([
        "Welchen Text: Zusammenfassung oder Kundenbedarf?",
      ]);
    });

    it("in English the question names them the same way", () => {
      const step = stepForMeaning("read_text", null, TWO_TEXTS);
      expect(step.event).toEqual({
        type: "notice",
        notice: {
          kind: "which_text",
          fields: ["Zusammenfassung", "Kundenbedarf"],
        },
      });
      const previous = i18n.locale;
      i18n.activate("en");
      try {
        expect(
          spokenWordsFor("en", { now: new Date() }).notice({
            kind: "which_text",
            fields: ["Summary", "Customer need"],
          }),
        ).toBe("Which text: Summary or Customer need?");
      } finally {
        i18n.activate(previous);
      }
    });
  });

  describe("after a stop the card listens on, silent to what it cannot use", () => {
    const stopped = async (change?: VoiceChange, pieces = CARD) => {
      const card = await heardCard(change, pieces);
      fetchCommand.mockResolvedValueOnce({
        meaning: "stop",
        piece_id: null,
        source: "rules",
      });
      await card.heardApprovalWords(KEY, "stopp");
      return card;
    };
    const answer = (meaning: ApprovalVoiceMeaning, pieceId?: string) =>
      fetchCommand.mockResolvedValueOnce({
        meaning,
        piece_id: pieceId ?? null,
        source: "rules",
      });

    it("stop: the voice stays quiet and the card keeps listening", async () => {
      const { useApprovalListening, useApprovalSpeech } = await stopped();
      expect(connections).toHaveLength(1);
      expect(useApprovalListening.getState().quiet).toBeNull();
      expect(useApprovalListening.getState().stopped).toBe(KEY);
      expect(useApprovalSpeech.getState().closed).toBe(false);
    });

    it.each([
      ["weiter", "skip"],
      ["nochmal", "repeat"],
      ["was noch?", "rest"],
    ] as const)("'%s' after a stop is acted on", async (words, meaning) => {
      const { heardApprovalWords, useApprovalListening, useApprovalSpeech } =
        await stopped();
      answer(meaning, meaning === "repeat" ? CARD.at(-1)?.id : undefined);
      await heardApprovalWords(KEY, words);
      // The voice speaks about the card again: the stop is over.
      expect(useApprovalSpeech.getState().speaking).toBe(true);
      expect(useApprovalListening.getState().stopped).toBeNull();
      // Again at the end of the card is the card from its start; its sound
      // was fetched before.
      if (meaning === "repeat")
        expect(useApprovalSpeech.getState().current).toBe(0);
      else expect(connections).toHaveLength(2);
    });

    it.each([
      ["noise", "mhm"],
      ["unclear", "warte mal, ich muss kurz was klären"],
      ["new_request", "Kannst du mir die Unterlagen rüberreichen?"],
    ] as const)(
      "%s after a stop is let be: no sentence, and the card listens on",
      async (meaning, words) => {
        const { heardApprovalWords, useApprovalListening } = await stopped();
        answer(meaning);
        await heardApprovalWords(KEY, words);
        expect(connections).toHaveLength(1);
        expect(useApprovalListening.getState().quiet).toBeNull();
        expect(useApprovalListening.getState().stopped).toBe(KEY);
      },
    );

    it.each(["approve", "reject"] as const)(
      "%s after a stop is let be: no sentence, no decision, the stop goes on",
      async (meaning) => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const { heardApprovalWords, useApprovalListening, useApprovalSpeech } =
          await stopped();
        answer(meaning);
        await heardApprovalWords(KEY, meaning === "approve" ? "ja" : "nein");
        expect(connections).toHaveLength(1);
        expect(useApprovalSpeech.getState().closed).toBe(false);
        expect(useApprovalListening.getState().stopped).toBe(KEY);
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
      },
    );

    it("stop, then 'Ja' to a colleague, then words not understood: silent throughout", async () => {
      const { heardApprovalWords, useApprovalListening } = await stopped();
      answer("approve");
      await heardApprovalWords(KEY, "Ja.");
      answer("unclear");
      await heardApprovalWords(KEY, "Dann machen wir das nachher zusammen.");
      answer("new_request");
      await heardApprovalWords(KEY, "Hast du die Unterlagen dabei?");
      expect(connections).toHaveLength(1);
      expect(useApprovalListening.getState().stopped).toBe(KEY);
      expect(useApprovalListening.getState().quiet).toBeNull();
    });

    it("a notice said to words heard while stopped does not end the stop", async () => {
      const { heardApprovalWords, useApprovalListening, useApprovalSpeech } =
        await stopped(undefined, [CARD[0], CARD.at(-1) as SpokenPiece]);
      answer("read_text");
      await heardApprovalWords(KEY, "lies den Text vor");
      expect(sentences(connections[1])).toEqual([
        "Diese Karte hat keinen langen Text.",
      ]);
      expect(useApprovalSpeech.getState().speaking).toBe(true);
      expect(useApprovalListening.getState().stopped).toBe(KEY);
    });

    it("a change after a stop sends nothing and says nothing", async () => {
      const { change, send } = changeable();
      const { heardApprovalWords, useApprovalListening, useApprovalSpeech } =
        await stopped(change);
      answer("change");
      await heardApprovalWords(
        KEY,
        "Lass uns das lieber auf Freitag schieben.",
      );
      expect(send).not.toHaveBeenCalled();
      expect(connections).toHaveLength(1);
      expect(useApprovalSpeech.getState().closed).toBe(false);
      expect(useApprovalListening.getState().stopped).toBe(KEY);
    });

    it("without a stop, words not understood are answered", async () => {
      const { heardApprovalWords } = await heardCard();
      answer("unclear");
      await heardApprovalWords(KEY, "warte mal");
      expect(sentences(connections[1])[0]).toMatch(/nicht verstanden/);
    });
  });

  it("shows that words were heard, then the words, then what they were understood as", async () => {
    const { heardApprovalWords, noteApprovalWordsEnded, useApprovalListening } =
      await heardCard();
    let answer!: (value: unknown) => void;
    fetchCommand.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    noteApprovalWordsEnded(KEY);
    expect(useApprovalListening.getState().heard).toEqual({
      key: KEY,
      words: null,
      meaning: null,
    });
    const understood = heardApprovalWords(KEY, "weiter");
    expect(useApprovalListening.getState().heard).toEqual({
      key: KEY,
      words: "weiter",
      meaning: null,
    });
    answer({ meaning: "skip", piece_id: null, source: "rules" });
    await understood;
    expect(useApprovalListening.getState().heard).toEqual({
      key: KEY,
      words: "weiter",
      meaning: "skip",
    });
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
    expect(useApprovalListening.getState()).toMatchObject({
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
      await vi.waitFor(() => expect(connections).toHaveLength(3));
      // What is said if no new card comes is asked for first, while the
      // card still waits.
      expect(sentences(connections[1]).join(" ")).toMatch(/keine neue Karte/);
      expect(sentences(connections[2])).toEqual([
        "In Ordnung, ich ändere das.",
      ]);
      audio(connections[2], 0);
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
      expect(connections).toHaveLength(4);
      expect(sentences(connections[3])).toEqual([
        "Die Änderung ließ sich nicht senden. Die Karte wartet auf dem Bildschirm.",
      ]);
      // What was prepared for "no new card" is not said and stops loading.
      expect(connections[1].close).toHaveBeenCalled();
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
      expect(sentences(connections[3])[0]).toMatch(/^Die Änderung ließ sich/);
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
      expect(sentences(connections[3])).toEqual([
        "Die Karte hat sich inzwischen geändert. Bitte auf dem Bildschirm nachsehen.",
      ]);
    });

    it("sends nothing for a card decided on screen during the confirmation", async () => {
      const { change, send } = changeable();
      const { heardApprovalWords, forgetApprovalCards, useApprovalChanges } =
        await heardCard(change);
      answer("change");
      const heard = heardApprovalWords(KEY, "nimm den 22.");
      await vi.waitFor(() => expect(connections).toHaveLength(3));
      forgetApprovalCards([KEY]);
      await heard;
      expect(send).not.toHaveBeenCalled();
      expect(useApprovalChanges.getState().records).toEqual({});
      expect(connections[1].close).toHaveBeenCalled();
    });

    it("sends nothing once audio mode was left during the confirmation", async () => {
      const { change, send } = changeable();
      const { heardApprovalWords, useSpeechPlayback } = await heardCard(change);
      answer("change");
      const heard = heardApprovalWords(KEY, "nimm den 22.");
      await vi.waitFor(() => expect(connections).toHaveLength(3));
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
      await vi.waitFor(() => expect(connections).toHaveLength(3));
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

  describe("ERMAIN-1259: deciding by voice", () => {
    const RECORDING = {
      startedAt: Date.now() + 50,
      endedAt: Date.now() + 2_000,
      firstSpeechAt: Date.now() + 600,
      speechMs: 900,
      recordedMs: 1_950,
      overVoice: false,
      audioAt: Date.now() + 50,
    };
    const deciding = (
      approves = true,
      outcome: VoiceChangeOutcome = "sent",
    ) => {
      const send = vi.fn(
        (_decision: "approve" | "reject", _receipt: string | undefined) =>
          Promise.resolve(outcome),
      );
      const decision: VoiceDecision = { approvalId: "call-7", approves, send };
      return { decision, send };
    };
    const answer = (
      meaning: ApprovalVoiceMeaning,
      decision?: { status: string; receipt?: string },
    ) =>
      fetchCommand.mockResolvedValueOnce({
        meaning,
        piece_id: null,
        source: "rules",
        ...(decision ? { decision } : {}),
      });
    /** The sentence that an approval by voice was taken, loaded with the words. */
    const ACK = "Gut, ich führe das jetzt aus.";
    const isAck = (connection: Connection) => sentences(connection)[0] === ACK;
    /** What the voice was asked to say after the card, besides that sentence. */
    const notices = () => connections.slice(1).filter((entry) => !isAck(entry));
    const body = (call = 0) =>
      (
        fetchCommand.mock.calls[call] as [
          {
            body: Record<string, unknown> & {
              signals?: Record<string, unknown>;
            };
          },
        ]
      )[0].body;

    it("the phrase approves with its receipt; the voice says nothing on the card", async () => {
      const { decision, send } = deciding();
      const { heardApprovalWords, useApprovalListening } = await heardCard(
        undefined,
        CARD,
        decision,
      );
      answer("approve", { status: "accepted", receipt: "receipt-1" });
      await heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
      expect(body().approval_id).toBe("call-7");
      expect(body().signals).toMatchObject({
        recording_started_at_ms: RECORDING.startedAt,
        first_speech_at_ms: RECORDING.firstSpeechAt,
        speech_ms: 900,
        recorded_ms: 1_950,
        over_voice: false,
      });
      expect(body().signals?.request_heard_at_ms).toEqual(expect.any(Number));
      expect(send).toHaveBeenCalledWith("approve", "receipt-1");
      expect(notices()).toHaveLength(0);
      expect(useApprovalListening.getState().quiet).toBe(KEY);
    });

    it("a plain yes teaches the phrase once, then points to the screen", async () => {
      const { decision, send } = deciding();
      const { heardApprovalWords, useApprovalListening } = await heardCard(
        undefined,
        CARD,
        decision,
      );
      answer("approve", { status: "phrase_needed" });
      await heardApprovalWords(KEY, "Ja, mach das.", RECORDING);
      expect(sentences(notices()[0])).toEqual(["Bitte „Ich bestätige“ sagen."]);
      audio(notices()[0], 0);
      playOut();
      answer("approve", { status: "phrase_needed" });
      await heardApprovalWords(KEY, "okay ja", RECORDING);
      expect(sentences(notices()[1])).toEqual([
        "Dann bitte auf dem Bildschirm bestätigen.",
      ]);
      expect(send).not.toHaveBeenCalled();
      expect(useApprovalListening.getState().misses[KEY]).toBe(2);
    });

    it("the phrase from a recording that cannot approve is asked for once more", async () => {
      const { decision, send } = deciding();
      const { heardApprovalWords } = await heardCard(undefined, CARD, decision);
      answer("approve", { status: "say_again" });
      await heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
      expect(sentences(notices()[0])).toEqual([
        "Bitte noch einmal „Ich bestätige“ sagen.",
      ]);
      expect(send).not.toHaveBeenCalled();
    });

    it("an accepted approval without a receipt is decided on screen", async () => {
      const { decision, send } = deciding();
      const { heardApprovalWords } = await heardCard(undefined, CARD, decision);
      answer("approve", { status: "accepted" });
      await heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
      expect(sentences(notices()[0])).toEqual([
        "Bitte auf dem Bildschirm bestätigen.",
      ]);
      expect(send).not.toHaveBeenCalled();
    });

    it("'nein' is confirmed, then refused with its receipt", async () => {
      const { decision, send } = deciding();
      const { heardApprovalWords } = await heardCard(undefined, CARD, decision);
      answer("reject", { status: "accepted", receipt: "receipt-2" });
      const heard = heardApprovalWords(KEY, "Nein.", RECORDING);
      await vi.waitFor(() => expect(notices()).toHaveLength(1));
      expect(sentences(notices()[0])).toEqual(["Gut, ich mache nichts."]);
      expect(send).not.toHaveBeenCalled();
      audio(notices()[0], 0);
      playOut();
      await heard;
      expect(send).toHaveBeenCalledWith("reject", "receipt-2");
    });

    it("a card approved on screen says so, whatever the words", async () => {
      for (const [approves, status] of [
        [true, "screen_only"],
        [false, "phrase_needed"],
        [false, "accepted"],
      ] as const) {
        connections.length = 0;
        vi.resetModules();
        const { decision, send } = deciding(approves);
        const { heardApprovalWords } = await heardCard(
          undefined,
          CARD,
          decision,
        );
        answer("approve", { status, receipt: "receipt-3" });
        await heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
        expect(sentences(notices()[0]), status).toEqual([
          "Bitte auf dem Bildschirm bestätigen.",
        ]);
        expect(send).not.toHaveBeenCalled();
      }
    });

    it("a refusal on a card decided on screen says so, without 'for now'", async () => {
      const { decision, send } = deciding();
      const { heardApprovalWords } = await heardCard(undefined, CARD, decision);
      answer("reject", { status: "screen_only" });
      await heardApprovalWords(KEY, "Nein.", RECORDING);
      expect(sentences(notices()[0])).toEqual([
        "Ablehnen geht bei dieser Karte nur auf dem Bildschirm.",
      ]);
      expect(send).not.toHaveBeenCalled();
    });

    it("a 'nein' from a recording that cannot decide is asked for again, not taken", async () => {
      const { decision, send } = deciding();
      const { heardApprovalWords } = await heardCard(undefined, CARD, decision);
      answer("reject", { status: "say_again" });
      await heardApprovalWords(KEY, "Nein.", RECORDING);
      expect(sentences(notices()[0])).toEqual([
        "Das habe ich nicht sicher gehört. Bitte noch einmal sagen.",
      ]);
      expect(send).not.toHaveBeenCalled();
    });

    /** The sentences of what the voice said last. */
    const lastSaid = () => {
      const said = notices();
      const last = said[said.length - 1];
      audio(last, 0);
      playOut();
      return sentences(last);
    };
    const SAY_AGAIN = {
      approve: {
        words: "Ich bestätige.",
        again: "Bitte noch einmal „Ich bestätige“ sagen.",
        screen: "Dann bitte auf dem Bildschirm bestätigen.",
        receipt: "receipt-ok",
      },
      reject: {
        words: "Nein.",
        again: "Das habe ich nicht sicher gehört. Bitte noch einmal sagen.",
        screen: "Das ging nicht durch. Bitte auf dem Bildschirm entscheiden.",
        receipt: "receipt-no",
      },
    } as const;

    describe.each(["approve", "reject"] as const)(
      "ERMAIN-1340: %s from a recording that could not carry it",
      (meaning) => {
        const { words, again, screen, receipt } = SAY_AGAIN[meaning];

        it("is asked for once more, and the next good try decides", async () => {
          const { decision, send } = deciding();
          const { heardApprovalWords } = await heardCard(
            undefined,
            CARD,
            decision,
          );
          answer(meaning, { status: "say_again" });
          await heardApprovalWords(KEY, words, RECORDING);
          expect(lastSaid()).toEqual([again]);
          answer(meaning, { status: "accepted", receipt });
          const heard = heardApprovalWords(KEY, words, RECORDING);
          if (meaning === "reject") {
            await vi.waitFor(() => expect(notices()).toHaveLength(2));
            expect(lastSaid()).toEqual(["Gut, ich mache nichts."]);
          }
          await heard;
          expect(send).toHaveBeenCalledWith(meaning, receipt);
        });

        it("a second failed try points to the screen, and the card listens on", async () => {
          const { decision, send } = deciding();
          const {
            heardApprovalWords,
            useApprovalListening,
            useApprovalSpeech,
          } = await heardCard(undefined, CARD, decision);
          for (const expected of [again, screen, screen]) {
            answer(meaning, { status: "say_again" });
            await heardApprovalWords(KEY, words, RECORDING);
            expect(lastSaid()).toEqual([expected]);
          }
          expect(send).not.toHaveBeenCalled();
          expect(useApprovalListening.getState().quiet).toBeNull();
          // Navigation still works after the screen was named.
          answer("repeat");
          await heardApprovalWords(KEY, "nochmal", RECORDING);
          expect(useApprovalSpeech.getState().speaking).toBe(true);
        });

        it("a near miss and a failed recording count together", async () => {
          const { decision, send } = deciding();
          const { heardApprovalWords } = await heardCard(
            undefined,
            CARD,
            decision,
          );
          answer("approve", { status: "phrase_needed" });
          await heardApprovalWords(KEY, "Ja.", RECORDING);
          expect(lastSaid()).toEqual(["Bitte „Ich bestätige“ sagen."]);
          answer(meaning, { status: "say_again" });
          await heardApprovalWords(KEY, words, RECORDING);
          expect(lastSaid()).toEqual([screen]);
          expect(send).not.toHaveBeenCalled();
        });
      },
    );

    it("failed tries count per card: the next card asks again first", async () => {
      const { decision, send } = deciding();
      const { heardApprovalWords, speakApprovalCard, useApprovalListening } =
        await heardCard(undefined, CARD, decision);
      answer("approve", { status: "say_again" });
      await heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
      expect(lastSaid()).toEqual([SAY_AGAIN.approve.again]);
      const NEXT = "message-1:stop-2";
      speakApprovalCard({
        key: NEXT,
        messageId: "message-1",
        pieces: CARD,
        language: "de",
        approval: { type: "pointer" },
        decision: { ...decision, approvalId: "call-8" },
      });
      const before = connections.length;
      await vi.waitFor(() => expect(connections.length).toBe(before + 1));
      CARD.forEach((_, index) => {
        audio(connections[before], index);
        playOut();
      });
      answer("approve", { status: "say_again" });
      await heardApprovalWords(NEXT, "Ich bestätige.", RECORDING);
      expect(lastSaid()).toEqual([SAY_AGAIN.approve.again]);
      expect(useApprovalListening.getState().misses).toMatchObject({
        [KEY]: 1,
        [NEXT]: 1,
      });
      expect(send).not.toHaveBeenCalled();
    });

    it("with deciding by voice off, a failed recording changes nothing", async () => {
      const { heardApprovalWords, useApprovalListening } = await heardCard();
      for (let i = 0; i < 2; i += 1) {
        answer("approve", { status: "say_again" });
        await heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
        expect(lastSaid()).toEqual([
          "Zustimmen geht im Moment nur auf dem Bildschirm.",
        ]);
      }
      expect(useApprovalListening.getState().misses[KEY] ?? 0).toBe(0);
    });

    it("words before the card asked bring the rest of it, not a decision", async () => {
      const { decision, send } = deciding();
      const { heardApprovalWords } = await heardCard(undefined, CARD, decision);
      answer("approve", { status: "not_yet" });
      await heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
      expect(sentences(notices()[0])).toEqual(["Das war alles."]);
      expect(send).not.toHaveBeenCalled();
    });

    it("a decision that does not go through is said once", async () => {
      const { decision } = deciding(true, "failed");
      const { heardApprovalWords } = await heardCard(undefined, CARD, decision);
      answer("approve", { status: "accepted", receipt: "receipt-4" });
      await heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
      expect(sentences(notices()[0])).toEqual([
        "Das ging nicht durch. Bitte auf dem Bildschirm entscheiden.",
      ]);
    });

    it("without deciding by voice nothing about it is sent, and decisions stay on screen", async () => {
      const { heardApprovalWords } = await heardCard();
      answer("approve");
      await heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
      expect(body().approval_id).toBeUndefined();
      expect(body().signals).toBeUndefined();
      expect(sentences(notices()[0])).toEqual([
        "Zustimmen geht im Moment nur auf dem Bildschirm.",
      ]);
      expect(connections.some(isAck)).toBe(false);
    });

    describe("the voice says that an approval by voice was taken", () => {
      /**
       * A decision whose sending starts the turn read back, as the chat does,
       * and ends only when the test says so.
       */
      let turnModules: {
        playback: typeof import("./speechPlayback");
        lines: typeof import("./waitLines");
      } | null = null;
      beforeEach(async () => {
        turnModules = {
          playback: await import("./speechPlayback"),
          lines: await import("./waitLines"),
        };
      });
      const pending = () => {
        let release: (outcome: VoiceChangeOutcome) => void = () => {};
        const send = vi.fn(
          (_decision: "approve" | "reject", _receipt?: string) => {
            turnModules?.playback.beginSpeechResponse("chat");
            turnModules?.lines.beginWaitTurn("chat", { continuation: true });
            return new Promise<VoiceChangeOutcome>((resolve) => {
              release = resolve;
            });
          },
        );
        const decision: VoiceDecision = {
          approvalId: "call-7",
          approves: true,
          send,
        };
        return {
          decision,
          send,
          release: (o: VoiceChangeOutcome) => release(o),
        };
      };
      const ackConnection = () => {
        const found = connections.find(isAck);
        if (!found) throw new Error("the sentence was not loaded");
        return found;
      };
      /** Heard "Ich bestätige" on a card whose sending waits for the test. */
      const approvedPending = async () => {
        const { decision, send, release } = pending();
        const { heardApprovalWords } = await heardCard(
          undefined,
          CARD,
          decision,
        );
        const lines = await import("./waitLines");
        answer("approve", { status: "accepted", receipt: "receipt-1" });
        const heard = heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
        await vi.waitFor(() => expect(send).toHaveBeenCalled());
        return { lines, heard, release };
      };

      it("is loaded with the words while the card waits, and said once the server took the approval, which does not wait for it", async () => {
        const { decision, send, release } = pending();
        const { heardApprovalWords } = await heardCard(
          undefined,
          CARD,
          decision,
        );
        const lines = await import("./waitLines");
        fetchCommand.mockImplementationOnce(() => {
          // Asked for before the words are understood: the voice speaks
          // only while the card waits.
          expect(connections.filter(isAck)).toHaveLength(1);
          return Promise.resolve({
            meaning: "approve",
            piece_id: null,
            source: "rules",
            decision: { status: "accepted", receipt: "receipt-1" },
          });
        });
        const heard = heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
        await vi.waitFor(() =>
          expect(send).toHaveBeenCalledWith("approve", "receipt-1"),
        );
        const ack = ackConnection();
        expect(ack.url).toBe(
          "/api/v1beta/me/messages/message-1/approval-speech",
        );
        expect(JSON.parse(ack.options.body as string)).toEqual({
          pieces: [ACK],
          language: "de",
        });
        audio(ack, 0);
        await Promise.resolve();
        // The audio is there, the server has not taken it yet.
        expect(lines.waitLinePlaying()).toBe(false);
        release("sent");
        await heard;
        await vi.waitFor(() => expect(lines.waitLinePlaying()).toBe(true));
        expect(notices()).toHaveLength(0);
        playOut();
        await vi.waitFor(() => expect(lines.waitLinePlaying()).toBe(false));
      });

      it("a sending the server refuses never says it, and the failure is said", async () => {
        const { lines, heard, release } = await approvedPending();
        audio(ackConnection(), 0);
        release("failed");
        await heard;
        expect(sources.some((source) => source.onended === null)).toBe(false);
        expect(lines.waitLinePlaying()).toBe(false);
        expect(ackConnection().close).toHaveBeenCalled();
        expect(sentences(notices()[0])).toEqual([
          "Das ging nicht durch. Bitte auf dem Bildschirm entscheiden.",
        ]);
      });

      it.each([
        ["the voice is stopped", "stop"],
        ["a microphone opens without the echo-cancelling hold", "microphone"],
      ] as const)(
        "%s while its audio loads: it is not said afterwards",
        async (_, what) => {
          const { lines, heard, release } = await approvedPending();
          release("sent");
          await heard;
          if (what === "stop") {
            const playback = await import("./speechPlayback");
            playback.stopSpeechPlayback();
          } else {
            const speechEnd = await import("./speechEnd");
            speechEnd.microphoneOpened();
          }
          audio(ackConnection(), 0);
          await new Promise((resolve) => setTimeout(resolve, 20));
          expect(lines.waitLinePlaying()).toBe(false);
        },
      );

      it("a sending that fails before its audio came never says it", async () => {
        const { decision } = deciding(true, "failed");
        const { heardApprovalWords } = await heardCard(
          undefined,
          CARD,
          decision,
        );
        const lines = await import("./waitLines");
        answer("approve", { status: "accepted", receipt: "receipt-1" });
        await heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
        audio(ackConnection(), 0);
        await Promise.resolve();
        expect(lines.waitLinePlaying()).toBe(false);
        expect(ackConnection().close).toHaveBeenCalled();
        expect(sentences(notices()[0])).toEqual([
          "Das ging nicht durch. Bitte auf dem Bildschirm entscheiden.",
        ]);
      });

      it("audio that comes late is left out", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { decision, send } = deciding();
        const { heardApprovalWords } = await heardCard(
          undefined,
          CARD,
          decision,
        );
        const lines = await import("./waitLines");
        const { ACKNOWLEDGEMENT_LATE_MS } = await import(
          "./approvalAcknowledgement"
        );
        answer("approve", { status: "accepted", receipt: "receipt-1" });
        await heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
        expect(send).toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(ACKNOWLEDGEMENT_LATE_MS + 10);
        audio(ackConnection(), 0);
        await Promise.resolve();
        expect(lines.waitLinePlaying()).toBe(false);
        expect(ackConnection().close).toHaveBeenCalled();
      });

      it("a refusal drops it unsaid; the refusal's own sentence is said", async () => {
        const { decision, send } = deciding();
        const { heardApprovalWords } = await heardCard(
          undefined,
          CARD,
          decision,
        );
        const lines = await import("./waitLines");
        answer("reject", { status: "accepted", receipt: "receipt-2" });
        const heard = heardApprovalWords(KEY, "Nein.", RECORDING);
        await vi.waitFor(() => expect(notices()).toHaveLength(1));
        expect(ackConnection().close).toHaveBeenCalled();
        audio(notices()[0], 0);
        playOut();
        await heard;
        expect(send).toHaveBeenCalledWith("reject", "receipt-2");
        expect(lines.waitLinePlaying()).toBe(false);
      });

      it("is loaded once per card, however many words came", async () => {
        const { decision } = deciding();
        const { heardApprovalWords } = await heardCard(
          undefined,
          CARD,
          decision,
        );
        answer("repeat");
        await heardApprovalWords(KEY, "nochmal", RECORDING);
        answer("approve", { status: "accepted", receipt: "receipt-1" });
        await heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
        expect(connections.filter(isAck)).toHaveLength(1);
      });

      it("a card approved on screen loads nothing", async () => {
        const { decision } = deciding(false);
        const { heardApprovalWords } = await heardCard(
          undefined,
          CARD,
          decision,
        );
        answer("approve", { status: "phrase_needed" });
        await heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
        expect(connections.some(isAck)).toBe(false);
      });

      it("a deployment's wording that holds a confirmation phrase is never loaded", async () => {
        i18n.load("de", {
          ...(deMessages as unknown as Messages),
          "spokenCard.notice.approved": "Ich bestätige, das läuft.",
        });
        i18n.activate("de");
        const { decision, send } = deciding();
        const { heardApprovalWords } = await heardCard(
          undefined,
          CARD,
          decision,
        );
        answer("approve", { status: "accepted", receipt: "receipt-1" });
        await heardApprovalWords(KEY, "Ich bestätige.", RECORDING);
        expect(send).toHaveBeenCalled();
        const asked = connections.filter((entry) =>
          sentences(entry)[0]?.startsWith("Ich bestätige"),
        );
        expect(asked.every((entry) => entry.close.mock.calls.length > 0)).toBe(
          true,
        );
      });
    });
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

    it("'stopp' over the voice: the voice stays quiet and the card listens on", async () => {
      const { heardApprovalWords, useApprovalListening, useApprovalSpeech } =
        await talkedOverAt(CARD, TEXT);
      answer("stop");
      await heardApprovalWords(KEY, "stopp");
      expect(useApprovalSpeech.getState().speaking).toBe(false);
      expect(useApprovalListening.getState().quiet).toBeNull();
      expect(useApprovalListening.getState().stopped).toBe(KEY);
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

describe("asking the card for one field", () => {
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
  });

  // The visit report create from MS staging: three details said, six
  // fields behind "more", each said only on request.
  const visitReport = () =>
    spokenApprovalPieces(
      spokenApprovalFor(
        "mcp_tool",
        (
          visitReportCalls as unknown as Parameters<
            typeof spokenApprovalFor
          >[1][]
        )[1],
      ),
      {
        language: "de",
        now: new Date("2026-11-23T17:00:00Z"),
        timeZone: "Europe/Berlin",
        voiceApproval: true,
      },
    );

  /** The card read to its end; what is said only on request is not loaded. */
  const heardVisitReport = async () => {
    const pieces = visitReport();
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
    const card = pieces.filter((piece) => !piece.onRequest);
    expect(sentences(connections[0])).toEqual(card.map((piece) => piece.text));
    card.forEach((_, index) => {
      audio(connections[0], index);
      playOut();
    });
    expect(speech.useApprovalSpeech.getState().speaking).toBe(false);
    return { pieces, ...speech, ...listening };
  };
  const answer = (
    meaning: ApprovalVoiceMeaning,
    pieceId: string | null = null,
    candidates?: string[],
  ) =>
    fetchCommand.mockResolvedValueOnce({
      meaning,
      piece_id: pieceId,
      source: "rules",
      ...(candidates ? { candidates } : {}),
    });
  const bodyOf = (call: number) =>
    (
      fetchCommand.mock.calls[call] as [
        { body: { pieces: Record<string, unknown>[]; question?: string } },
      ]
    )[0].body;

  it("tells the endpoint which fields are said only on request", async () => {
    const { heardApprovalWords } = await heardVisitReport();
    answer("repeat", "detail:Summary");
    await heardApprovalWords(KEY, "what was the summary again?");
    const summary = bodyOf(0).pieces.find(
      (piece) => piece.id === "detail:Summary",
    );
    expect(summary).toMatchObject({
      role: "detail",
      field: "Summary",
      state: "not_said",
      on_request: true,
    });
  });

  it("says the field asked for, loaded on its own, then is quiet", async () => {
    const { heardApprovalWords, useApprovalSpeech, pieces } =
      await heardVisitReport();
    answer("repeat", "detail:Summary");
    await heardApprovalWords(KEY, "what was the summary again?");
    expect(connections).toHaveLength(2);
    expect(sentences(connections[1])).toEqual([
      "Summary: Budget in Höhe von 1.200.000 EUR bestätigt. Kundenentscheidung ist für den 14.12.2026 vorgesehen.",
    ]);
    expect(useApprovalSpeech.getState().current).toBe(
      pieces.findIndex((piece) => piece.id === "detail:Summary"),
    );
    audio(connections[1], 0);
    playOut();
    expect(useApprovalSpeech.getState().speaking).toBe(false);
    expect(useApprovalSpeech.getState().closed).toBe(false);
  });

  it("asks which field when the words fit several, and the answer is said", async () => {
    const { heardApprovalWords } = await heardVisitReport();
    answer("repeat", null, ["detail:Visitedon", "detail:Followupdate"]);
    await heardApprovalWords(KEY, "das Datum nochmal");
    expect(sentences(connections[1])).toEqual([
      "Welches Feld: Visitedon oder Followupdate?",
    ]);
    audio(connections[1], 0);
    playOut();
    answer("repeat", "detail:Followupdate");
    await heardApprovalWords(KEY, "Followupdate");
    expect(bodyOf(1).question).toBe("which_field");
    expect(sentences(connections[2])).toEqual([
      "Followupdate: 25. September 2026.",
    ]);
  });

  it("a short text asked for by name is said, not another text read", () => {
    const short = {
      ...CARD[CARD.findIndex(namesLongText)],
      id: "text:Note",
      readOut: undefined,
      values: [],
    };
    const pieces = [...CARD, short];
    expect(stepForMeaning("read_text", "text:Note", pieces).event).toEqual({
      type: "repeat",
      index: pieces.length - 1,
    });
  });

  it("a long text asked for by name is read, not only named", () => {
    const step = stepForMeaning(
      "repeat",
      CARD[CARD.findIndex(namesLongText)].id,
      CARD,
      {
        current: null,
      },
    );
    expect(step.event).toEqual({
      type: "read",
      index: CARD.findIndex(namesLongText),
    });
    // While the voice says it, "again" is that piece again.
    const at = CARD.findIndex(namesLongText);
    expect(
      stepForMeaning("repeat", CARD[at].id, CARD, { current: at }).event,
    ).toEqual({ type: "repeat", index: at });
  });
});
