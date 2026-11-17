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
): SpokenPiece => ({ role, text, mustSay });

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
    expect(connection.close).toHaveBeenCalled();
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

  it("stops at once and decides nothing", async () => {
    const { connection, states, stopApprovalSpeech, useApprovalSpeech } =
      await speak();
    audio(connection, 0);
    stopApprovalSpeech();
    expect(states()).toEqual(["cut", "pending", "pending", "pending"]);
    expect(useApprovalSpeech.getState().speaking).toBe(false);
    expect(connection.close).toHaveBeenCalled();
    // Audio that still arrives is not played.
    const before = sources.length;
    audio(connection, 1);
    expect(sources).toHaveLength(before);
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
});
