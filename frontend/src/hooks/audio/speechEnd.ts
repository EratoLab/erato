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
