/**
 * When the recorder last heard the user stop speaking. Waiting is counted
 * from there, not from when the words were sent: the end-of-turn silence and
 * the transcription are part of the wait the user feels.
 */
let endedAt: number | undefined;

export function markSpeechEnded(at: number) {
  endedAt = at;
}

/** The last end of speech, once: the next turn starts without it. */
export function takeSpeechEnd(): number | undefined {
  const at = endedAt;
  endedAt = undefined;
  return at;
}

const openListeners = new Set<() => void>();

/**
 * The recorder opens the microphone without the echo-cancelling hold used
 * over the voice. Nothing the voice says may play into such a recording.
 */
export function microphoneOpened() {
  for (const listener of openListeners) listener();
}

export function onMicrophoneOpened(listener: () => void): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}
