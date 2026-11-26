import { useEffect, useRef, useState } from "react";

import {
  clearApprovalWordsHeard,
  heardApprovalWords,
  listensIn,
  noteApprovalListening,
  quietApprovalListening,
  useApprovalListening,
} from "./approvalListening";
import { useApprovalSpeech } from "./approvalSpeech";

import type { RecordingSignals } from "./recordingSignals";

/**
 * Opens the microphone for a spoken approval card once the voice has said
 * something about it and fallen silent, and closes it whenever the voice
 * speaks, the card is decided or replaced, or listening is switched off.
 * What is heard goes to the card, never into the composer.
 *
 * The recorder is the composer's own; the caller routes what it hears for
 * the card: `open` starts it for a card, and `readTurn` says whether the
 * end-of-turn silence ended the turn and what was heard so far.
 */
export function useApprovalCardListening({
  enabled,
  recorderOpen,
  recorderIdle,
  open,
  close,
  readTurn,
}: {
  /** Audio mode reads back, voice commands are on and a card waits. */
  enabled: boolean;
  /** The microphone records or is starting to. */
  recorderOpen: boolean;
  /** The microphone neither records nor finishes a recording. */
  recorderIdle: boolean;
  open: (key: string) => void;
  /** Closes the microphone; what it heard is dropped. */
  close: () => void;
  /** With what the recorder measured, which deciding by voice needs. */
  readTurn: () => {
    ended: boolean;
    words: string;
    recording?: RecordingSignals;
  };
}): { listeningFor: string | null } {
  const key = useApprovalSpeech((state) => state.key);
  const language = useApprovalSpeech((state) =>
    state.available !== null && state.available.key === state.key
      ? state.available.language
      : undefined,
  );
  const voiceAllows = useApprovalSpeech(
    (state) => !state.speaking && !state.failed && !state.closed,
  );
  const pending = useApprovalListening((state) => state.pending);
  const quiet = useApprovalListening((state) => state.quiet);

  const want =
    enabled &&
    key !== null &&
    voiceAllows &&
    listensIn(language) &&
    pending !== key &&
    quiet !== key;

  const [listeningFor, setListeningFor] = useState<string | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    noteApprovalListening(listeningFor);
  }, [listeningFor]);
  useEffect(() => () => noteApprovalListening(null), []);

  useEffect(() => {
    if (!want || listeningFor !== null || !recorderIdle) return;
    opened.current = false;
    setListeningFor(key);
    clearApprovalWordsHeard(key);
    open(key);
  }, [key, listeningFor, open, recorderIdle, want]);

  useEffect(() => {
    if (recorderOpen) opened.current = true;
  }, [recorderOpen]);

  // The voice speaks, the card goes, or listening ends: the microphone closes.
  useEffect(() => {
    if (listeningFor === null || (want && key === listeningFor)) return;
    if (recorderOpen) close();
    setListeningFor(null);
  }, [close, key, listeningFor, recorderOpen, want]);

  // The turn is over: its words go to the card. The recorder is idle only
  // after the last transcript arrived, so the words are complete; none at all
  // (a cough) listens again at once. A recording that ended on its own (the
  // time limit, an error) ends listening for the card.
  useEffect(() => {
    if (listeningFor === null || !recorderIdle || !opened.current) return;
    const card = listeningFor;
    if (!readTurn().ended) {
      setListeningFor(null);
      quietApprovalListening(card);
      return;
    }
    const { words, recording } = readTurn();
    setListeningFor(null);
    if (words.trim().length > 0)
      void heardApprovalWords(card, words, recording);
  }, [listeningFor, readTurn, recorderIdle]);

  return { listeningFor };
}
