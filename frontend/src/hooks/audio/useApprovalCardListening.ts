import { useEffect, useRef, useState } from "react";

import {
  heardApprovalWords,
  listensIn,
  quietApprovalListening,
  useApprovalListening,
} from "./approvalListening";
import { useApprovalSpeech } from "./approvalSpeech";

/** How long the last words of a turn may still be on their way. */
const LAST_WORDS_GRACE_MS = 3_000;
const LAST_WORDS_POLL_MS = 100;

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
  readTurn: () => { ended: boolean; words: string };
}): { listeningFor: string | null } {
  const key = useApprovalSpeech((state) => state.key);
  const language = useApprovalSpeech((state) =>
    state.available !== null && state.available.key === state.key
      ? state.available.language
      : undefined,
  );
  const quietVoice = useApprovalSpeech(
    (state) => !state.speaking && !state.failed && !state.closed,
  );
  const pending = useApprovalListening((state) => state.pending);
  const quiet = useApprovalListening((state) => state.quiet);

  const want =
    enabled &&
    key !== null &&
    quietVoice &&
    listensIn(language) &&
    pending !== key &&
    quiet !== key;

  const [listeningFor, setListeningFor] = useState<string | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (!want || listeningFor !== null || !recorderIdle) return;
    opened.current = false;
    setListeningFor(key);
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

  // The turn is over: its words go to the card. A recording that ended on
  // its own (the time limit, silence, an error) ends listening for the card.
  useEffect(() => {
    if (listeningFor === null || !recorderIdle || !opened.current) return;
    const card = listeningFor;
    if (!readTurn().ended) {
      setListeningFor(null);
      quietApprovalListening(card);
      return;
    }
    let waited = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hand = () => {
      const { words } = readTurn();
      if (words.trim().length === 0 && waited < LAST_WORDS_GRACE_MS) {
        waited += LAST_WORDS_POLL_MS;
        timer = setTimeout(hand, LAST_WORDS_POLL_MS);
        return;
      }
      setListeningFor(null);
      if (words.trim().length > 0) void heardApprovalWords(card, words);
    };
    hand();
    return () => clearTimeout(timer);
  }, [listeningFor, readTurn, recorderIdle]);

  return { listeningFor };
}
