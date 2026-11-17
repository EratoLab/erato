import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpokenPiece } from "@/lib/toolCallGist/spokenCard";
import type { SSEOptions } from "@/utils/sse/sseClient";

interface MockSource {
  onended: (() => void) | null;
}
interface Connection {
  url: string;
  options: SSEOptions;
  close: ReturnType<typeof vi.fn>;
}

const sources: MockSource[] = [];
const connections: Connection[] = [];

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

vi.mock("@/utils/sse/sseClient", () => ({
  createSSEConnection: (url: string, options: SSEOptions) => {
    const connection: Connection = { url, options, close: vi.fn() };
    connections.push(connection);
    return connection.close;
  },
}));

const piece = (
  role: SpokenPiece["role"],
  text: string,
  mustSay = false,
): SpokenPiece => ({ id: text, role, text, mustSay });

const CARD = [
  piece("what", "Ich möchte den Datensatz Line 4 Retrofit ändern."),
  piece("detail", "Das Feld Telefon wird geleert.", true),
  piece("detail", "Probability: von 10 auf 60 Prozent."),
  piece("request", "Bitte auf dem Bildschirm bestätigen."),
];

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

/** Lets the newest scheduled audio play to its end. */
const playOut = () => sources.at(-1)?.onended?.();

async function speak(pieces = CARD) {
  const module = await import("./approvalSpeech");
  const { useSpeechPlayback } = await import("./speechPlayback");
  useSpeechPlayback.setState({ conversational: true, enabled: true });
  module.speakApprovalCard({
    key: "message-1:stop-1",
    messageId: "message-1",
    pieces,
    fallback: [
      piece("pointer", "Auf dem Bildschirm wartet eine Entscheidung."),
    ],
  });
  await vi.waitFor(() => expect(connections).toHaveLength(1));
  const connection = connections[0];
  return {
    ...module,
    connection,
    states: () =>
      module.useApprovalSpeech.getState().pieces.map((entry) => entry.state),
  };
}

beforeEach(() => {
  vi.resetModules();
  sources.length = 0;
  connections.length = 0;
  sequence = 0;
  vi.stubGlobal("AudioContext", MockAudioContext);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("speaking an approval card", () => {
  it("asks for the pieces of the card's message and plays them one after another", async () => {
    const { connection, states, useApprovalSpeech } = await speak();
    expect(connection.url).toBe(
      "/api/v1beta/me/messages/message-1/approval-speech",
    );
    expect(JSON.parse(connection.options.body as string)).toEqual({
      pieces: CARD.map((entry) => entry.text),
    });
    expect(states()).toEqual(["playing", "pending", "pending", "pending"]);

    // A later piece arrives first: it waits for its turn.
    audio(connection, 0);
    audio(connection, 1);
    expect(sources).toHaveLength(1);
    playOut();
    expect(states()).toEqual(["heard", "playing", "pending", "pending"]);
    expect(sources).toHaveLength(2);

    playOut();
    expect(states()).toEqual(["heard", "heard", "playing", "pending"]);
    audio(connection, 2);
    playOut();
    audio(connection, 3);
    playOut();
    expect(states()).toEqual(["heard", "heard", "heard", "heard"]);
    expect(useApprovalSpeech.getState().speaking).toBe(false);
  });

  it("skips the piece being said and goes on with the rest", async () => {
    const { connection, states, skipApprovalPiece } = await speak();
    audio(connection, 0);
    audio(connection, 1);
    audio(connection, 2);
    audio(connection, 3);
    playOut();
    expect(states()).toEqual(["heard", "playing", "pending", "pending"]);

    // The loss is cut short, the next piece plays, and before the request
    // the loss is said once more.
    skipApprovalPiece();
    expect(states()).toEqual(["heard", "cut", "playing", "pending"]);
    playOut();
    expect(states()).toEqual(["heard", "playing", "heard", "pending"]);
    playOut();
    expect(states()).toEqual(["heard", "heard", "heard", "playing"]);
  });

  it("stops at once and decides nothing; the card's audio keeps loading", async () => {
    const {
      connection,
      states,
      stopApprovalSpeech,
      steerApprovalCard,
      useApprovalSpeech,
    } = await speak();
    audio(connection, 0);
    stopApprovalSpeech();
    expect(states()).toEqual(["cut", "pending", "pending", "pending"]);
    expect(useApprovalSpeech.getState().speaking).toBe(false);
    expect(useApprovalSpeech.getState().closed).toBe(false);
    expect(connection.close).not.toHaveBeenCalled();
    // Audio that still arrives is not played, but kept: "go on" plays it.
    const before = sources.length;
    audio(connection, 1);
    expect(sources).toHaveLength(before);
    steerApprovalCard("message-1:stop-1", { type: "skip" });
    expect(states()).toEqual(["cut", "playing", "pending", "pending"]);
    expect(sources).toHaveLength(before + 1);
  });

  it("review 2: a break in the card's audio after a stop says nothing; going on asks again", async () => {
    const {
      connection,
      states,
      stopApprovalSpeech,
      steerApprovalCard,
      useApprovalSpeech,
    } = await speak();
    const { useSpeechPlayback } = await import("./speechPlayback");
    audio(connection, 0);
    stopApprovalSpeech();
    connection.options.onError?.(new Error("network"));
    // No fallback, no notice, the card still waits and can be steered.
    expect(connections).toHaveLength(1);
    expect(connection.close).toHaveBeenCalled();
    expect(useApprovalSpeech.getState().speaking).toBe(false);
    expect(useApprovalSpeech.getState().failed).toBe(false);
    expect(useSpeechPlayback.getState().failed).toBe(false);

    // "weiter": the pieces that did not load are asked for again.
    steerApprovalCard("message-1:stop-1", { type: "skip" });
    await vi.waitFor(() => expect(connections).toHaveLength(2));
    expect(JSON.parse(connections[1].options.body as string)).toEqual({
      pieces: CARD.slice(1).map((entry) => entry.text),
    });
    expect(states()).toEqual(["cut", "playing", "pending", "pending"]);
    const before = sources.length;
    audio(connections[1], 0);
    expect(sources).toHaveLength(before + 1);

    // A break while a piece that did not load plays fails, as before.
    playOut();
    expect(states()).toEqual(["cut", "heard", "playing", "pending"]);
    connections[1].options.onClose?.();
    expect(useApprovalSpeech.getState().failed).toBe(true);
  });

  it("review 2: a break while a loaded piece plays goes on; a later piece is asked for again", async () => {
    const { connection, states, useApprovalSpeech } = await speak();
    audio(connection, 0);
    connection.options.onClose?.();
    expect(useApprovalSpeech.getState().failed).toBe(false);
    expect(states()[0]).toBe("playing");
    playOut();
    await vi.waitFor(() => expect(connections).toHaveLength(2));
    expect(JSON.parse(connections[1].options.body as string).pieces).toEqual(
      CARD.slice(1).map((entry) => entry.text),
    );
  });

  it("1.6: a card that cannot be spoken falls back, then says so, and stays to be asked for", async () => {
    const {
      connection,
      useApprovalSpeech,
      approvalSpoken,
      replayApprovalCard,
    } = await speak();
    const { useSpeechPlayback } = await import("./speechPlayback");
    // The endpoint refuses the card: the pointer sentence is asked for.
    connection.options.onError?.(new Error("413"));
    await vi.waitFor(() => expect(connections).toHaveLength(2));
    expect(JSON.parse(connections[1].options.body as string)).toEqual({
      pieces: ["Auf dem Bildschirm wartet eine Entscheidung."],
    });
    expect(useSpeechPlayback.getState().failed).toBe(false);
    // The voice is down: the notice shows, and nothing counts as spoken.
    connections[1].options.onError?.(new Error("502"));
    expect(useSpeechPlayback.getState().failed).toBe(true);
    expect(approvalSpoken("message-1:stop-1")).toBe(false);
    expect(useApprovalSpeech.getState().available?.key).toBe(
      "message-1:stop-1",
    );
    // The control that reads the card tries the whole card again.
    replayApprovalCard();
    await vi.waitFor(() => expect(connections).toHaveLength(3));
    expect(
      JSON.parse(connections[2].options.body as string).pieces,
    ).toHaveLength(CARD.length);
  });

  it("4.1: forgetting one approval keeps another card of the same message speaking", async () => {
    const { forgetApprovalCards, useApprovalSpeech } = await speak();
    // An earlier card of the same message goes away, say the one a change
    // replaced: the card being spoken keeps its voice.
    forgetApprovalCards(["message-1:stop-0"]);
    expect(useApprovalSpeech.getState().speaking).toBe(true);
    expect(useApprovalSpeech.getState().available?.key).toBe(
      "message-1:stop-1",
    );
    forgetApprovalCards(["message-1:stop-1"]);
    expect(useApprovalSpeech.getState().speaking).toBe(false);
    expect(useApprovalSpeech.getState().available).toBeNull();
  });

  it("ends when conversational mode stops reading back", async () => {
    const { useApprovalSpeech } = await speak();
    const { useSpeechPlayback } = await import("./speechPlayback");
    useSpeechPlayback.setState({ enabled: false });
    expect(useApprovalSpeech.getState().speaking).toBe(false);
  });

  it("waits before the request of a delete", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { connection, states } = await speak([
        piece("what", "Ich möchte die Aufgabe löschen.", true),
        {
          ...piece("request", "Bitte auf dem Bildschirm bestätigen."),
          pauseBeforeMs: 400,
        },
      ]);
      audio(connection, 0);
      audio(connection, 1);
      playOut();
      expect(states()).toEqual(["heard", "playing"]);
      const before = sources.length;
      expect(sources).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(400);
      expect(sources).toHaveLength(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says what came of a change without offering a card to listen to", async () => {
    const module = await import("./approvalSpeech");
    const { useSpeechPlayback } = await import("./speechPlayback");
    useSpeechPlayback.setState({ conversational: true, enabled: true });
    module.announceApprovalNotice(
      "message-1",
      { kind: "change_no_card", several: false },
      "en",
    );
    await vi.waitFor(() => expect(connections).toHaveLength(1));
    expect(connections[0].url).toMatch(/message-1\/approval-speech$/);
    expect(
      (
        JSON.parse(connections[0].options.body as string) as {
          pieces: string[];
        }
      ).pieces,
    ).toEqual([
      "No new card came, and nothing was run. Just say how to go on.",
    ]);
    expect(module.useApprovalSpeech.getState().available).toBeNull();
    expect(module.useApprovalSpeech.getState().speaking).toBe(true);
    audio(connections[0], 0);
    playOut();
    expect(module.useApprovalSpeech.getState().speaking).toBe(false);
  });

  it("says nothing of a change once audio mode was left", async () => {
    const module = await import("./approvalSpeech");
    const { useSpeechPlayback } = await import("./speechPlayback");
    useSpeechPlayback.setState({ conversational: false, enabled: true });
    module.announceApprovalNotice(
      "message-1",
      { kind: "change_no_card", several: false },
      "en",
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(connections).toHaveLength(0);
  });
});
