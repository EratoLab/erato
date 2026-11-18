import { useEffect, useRef, useState } from "react";

import {
  heardApprovalWords,
  listensIn,
  quietApprovalListening,
  resumeTalkedOverCard,
  useApprovalListening,
} from "./approvalListening";
import { useApprovalSpeech } from "./approvalSpeech";

/**
 * Opens the microphone for a spoken approval card once the voice has said
 * something about it and fallen silent, and closes it whenever the voice
 * speaks, the card is decided or replaced, or listening is switched off.
 * What is heard goes to the card, never into the composer.
 *
 * With `overVoice`, the microphone also opens while the voice speaks: the
 * recorder then waits for speech over the voice before it transcribes. A
 * recording that already transcribes is still closed when the voice starts,
 * and opens again to wait over it.
 *
 * The recorder is the composer's own; the caller routes what it hears for
 * the card: `open` starts it for a card, and `readTurn` says whether the
 * end-of-turn silence ended the turn and what was heard so far.
 */
export function useApprovalCardListening({
  enabled,
  overVoice = false,
  recorderOpen,
  recorderLive = false,
  recorderIdle,
  open,
  close,
  readTurn,
}: {
  /** Audio mode reads back, voice commands are on and a card waits. */
  enabled: boolean;
  /** The user may talk over the voice. */
  overVoice?: boolean;
  /** The microphone transcribes what it hears. */
  recorderLive?: boolean;
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
  const speaking = useApprovalSpeech((state) => state.speaking);
  const voiceAllows = useApprovalSpeech(
    (state) => (overVoice || !state.speaking) && !state.failed && !state.closed,
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
    if (!want || listeningFor !== null || !recorderIdle) return;
    opened.current = false;
    setListeningFor(key);
    open(key);
  }, [key, listeningFor, open, recorderIdle, want]);

  useEffect(() => {
    if (recorderOpen) opened.current = true;
  }, [recorderOpen]);

  // The voice speaks, the card goes, or listening ends: the microphone closes.
  // Over the voice it stays open, unless it already transcribes: the voice
  // would be heard as the user's words.
  const voiceOverLive = speaking && recorderLive;
  useEffect(() => {
    if (
      listeningFor === null ||
      (want && key === listeningFor && !voiceOverLive)
    )
      return;
    if (recorderOpen) close();
    setListeningFor(null);
  }, [close, key, listeningFor, recorderOpen, voiceOverLive, want]);

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
    const { words } = readTurn();
    setListeningFor(null);
    if (words.trim().length > 0) void heardApprovalWords(card, words);
    else resumeTalkedOverCard(card);
  }, [listeningFor, readTurn, recorderIdle]);

  return { listeningFor };
}
