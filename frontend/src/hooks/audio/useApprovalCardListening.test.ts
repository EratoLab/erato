import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApprovalListening } from "./approvalListening";
import { useApprovalSpeech } from "./approvalSpeech";
import { useApprovalCardListening } from "./useApprovalCardListening";

const heardApprovalWords = vi.fn();
vi.mock("./approvalListening", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./approvalListening")>()),
  heardApprovalWords: (...args: unknown[]) => heardApprovalWords(...args),
}));

const KEY = "message-1:stop-1";

/** A recorder like the composer's: `open` starts it, the turn's end stops it. */
const recorder = () => {
  const state = {
    open: false,
    idle: true,
    turn: { ended: false, words: "" },
  };
  return {
    state,
    open: vi.fn(() => {
      state.open = true;
      state.idle = false;
      state.turn = { ended: false, words: "" };
    }),
    close: vi.fn(() => {
      state.open = false;
      state.idle = true;
    }),
    readTurn: () => state.turn,
  };
};

const cardSaid = (speaking: boolean, language = "de") =>
  act(() => {
    useApprovalSpeech.setState({
      key: KEY,
      available: { key: KEY, messageId: "message-1", pieces: [], language },
      speaking,
      failed: false,
      closed: false,
    });
  });

const render = (mic: ReturnType<typeof recorder>, enabled = true) =>
  renderHook(
    ({ on }: { on: boolean }) =>
      useApprovalCardListening({
        enabled: on,
        recorderOpen: mic.state.open,
        recorderIdle: mic.state.idle,
        open: mic.open,
        close: mic.close,
        readTurn: mic.readTurn,
      }),
    { initialProps: { on: enabled } },
  );

beforeEach(() => {
  heardApprovalWords.mockReset();
  // As the real one: the card waits for the answer before it listens again.
  heardApprovalWords.mockImplementation((key: string) =>
    useApprovalListening.setState({ pending: key }),
  );
  useApprovalListening.setState({ pending: null, quiet: null });
  useApprovalSpeech.setState({
    key: null,
    available: null,
    speaking: false,
    failed: false,
    closed: false,
  });
});

describe("listening while a spoken card waits", () => {
  it("never listens while the voice speaks; opens once it is silent", () => {
    const mic = recorder();
    cardSaid(true);
    const { rerender } = render(mic);
    expect(mic.open).not.toHaveBeenCalled();
    cardSaid(false);
    rerender({ on: true });
    expect(mic.open).toHaveBeenCalledWith(KEY);
  });

  it("closes when the voice speaks again, and drops what it heard", () => {
    const mic = recorder();
    cardSaid(false);
    const { rerender } = render(mic);
    rerender({ on: true });
    mic.state.turn.words = "ja";
    cardSaid(true);
    rerender({ on: true });
    expect(mic.close).toHaveBeenCalledTimes(1);
    expect(heardApprovalWords).not.toHaveBeenCalled();
  });

  it("hands the words of a finished turn to the card, and to nothing else", async () => {
    vi.useFakeTimers();
    try {
      const mic = recorder();
      cardSaid(false);
      const { rerender } = render(mic);
      rerender({ on: true });
      mic.state.turn = { ended: true, words: "hab ich, was noch?" };
      mic.state.open = false;
      mic.state.idle = true;
      rerender({ on: true });
      expect(heardApprovalWords).toHaveBeenCalledWith(
        KEY,
        "hab ich, was noch?",
        undefined,
      );
      expect(mic.open).toHaveBeenCalledTimes(1);
      // While the words are understood the card does not listen.
      expect(useApprovalListening.getState().pending).toBe(KEY);
      act(() => useApprovalListening.setState({ pending: null }));
      rerender({ on: true });
      expect(mic.open).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("review 5: listens again at once after a turn with no words", () => {
    vi.useFakeTimers();
    try {
      const mic = recorder();
      cardSaid(false);
      const { rerender } = render(mic);
      rerender({ on: true });
      mic.state.turn = { ended: true, words: "" };
      mic.state.open = false;
      mic.state.idle = true;
      rerender({ on: true });
      rerender({ on: true });
      // No time passes: the recorder is idle only once every word arrived.
      expect(heardApprovalWords).not.toHaveBeenCalled();
      expect(mic.open).toHaveBeenCalledTimes(2);
      expect(useApprovalListening.getState().quiet).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a recording that ends on its own (silence until the limit) stops listening for the card", () => {
    const mic = recorder();
    cardSaid(false);
    const { rerender } = render(mic);
    rerender({ on: true });
    mic.state.open = false;
    mic.state.idle = true;
    rerender({ on: true });
    rerender({ on: true });
    expect(mic.open).toHaveBeenCalledTimes(1);
    expect(useApprovalListening.getState().quiet).toBe(KEY);
    expect(heardApprovalWords).not.toHaveBeenCalled();
    // Saying the card again listens again.
    cardSaid(true);
    cardSaid(false);
    rerender({ on: true });
    expect(mic.open).toHaveBeenCalledTimes(2);
  });

  it("closes when the card is decided or audio mode is left", () => {
    const mic = recorder();
    cardSaid(false);
    const { rerender } = render(mic);
    rerender({ on: true });
    rerender({ on: false });
    expect(mic.close).toHaveBeenCalledTimes(1);
  });

  it("closes when the card is closed by a decision on screen", () => {
    const mic = recorder();
    cardSaid(false);
    const { rerender } = render(mic);
    rerender({ on: true });
    act(() => useApprovalSpeech.setState({ closed: true }));
    rerender({ on: true });
    expect(mic.close).toHaveBeenCalledTimes(1);
  });

  it("does not listen with voice commands off, after a failed voice, or in a language without the sentences", () => {
    const off = recorder();
    cardSaid(false);
    render(off, false);
    expect(off.open).not.toHaveBeenCalled();

    const failed = recorder();
    act(() => useApprovalSpeech.setState({ failed: true }));
    render(failed);
    expect(failed.open).not.toHaveBeenCalled();

    const french = recorder();
    cardSaid(false, "fr");
    render(french);
    expect(french.open).not.toHaveBeenCalled();
  });
});

describe("ERMAIN-1259: what deciding by voice needs from the turn", () => {
  it("says which card the microphone is open for, and hands on what the recorder measured", () => {
    const mic = recorder();
    cardSaid(false);
    const { rerender } = render(mic);
    rerender({ on: true });
    expect(useApprovalListening.getState().listening).toBe(KEY);
    const recording = {
      startedAt: 1_000,
      endedAt: 3_000,
      firstSpeechAt: 1_600,
      speechMs: 900,
      recordedMs: 2_000,
      overVoice: false,
      audioAt: 1_000,
    };
    mic.state.turn = {
      ended: true,
      words: "Ich bestätige.",
      recording,
    } as typeof mic.state.turn;
    mic.state.open = false;
    mic.state.idle = true;
    rerender({ on: true });
    expect(heardApprovalWords).toHaveBeenCalledWith(
      KEY,
      "Ich bestätige.",
      recording,
    );
    expect(useApprovalListening.getState().listening).toBeNull();
  });
});

describe("ERMAIN-1230: a decision tapped while the voice speaks", () => {
  it("does not open the microphone in the moment before the card closes", async () => {
    const { quietApprovalListening } = await import("./approvalListening");
    const mic = recorder();
    cardSaid(true);
    const { rerender } = render(mic);
    expect(mic.open).not.toHaveBeenCalled();

    // The tap: listening for the card ends, then its voice stops.
    act(() => {
      quietApprovalListening(KEY);
      useApprovalSpeech.setState({ speaking: false });
    });
    rerender({ on: true });
    expect(mic.open).not.toHaveBeenCalled();

    // A render later the decision is on its way and the card closes.
    rerender({ on: false });
    expect(mic.open).not.toHaveBeenCalled();
  });
});
