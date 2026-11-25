import { hostShellWithCapability } from "@/lib/hostShell";

// eslint-disable-next-line lingui/no-unlocalized-strings
const AUDIO_WHILE_HIDDEN_CAPABILITY = "audioWhileHidden";

/**
 * The host keeps the page's microphone and voice running while the page is
 * hidden, as an app may with the phone locked or in the background. A
 * browser mutes a hidden page's microphone, so without this the page gives it
 * back when hidden.
 */
export function audioContinuesWhileHidden(): boolean {
  return hostShellWithCapability(AUDIO_WHILE_HIDDEN_CAPABILITY, 1) !== null;
}

/** WebKit's audio session of the page; other engines have none. */
type PageAudioSession = { type: string };

function pageAudioSession(): PageAudioSession | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { audioSession?: PageAudioSession })
    .audioSession;
}

/**
 * Says the page plays and records for as long as a conversation that may go
 * on hidden runs. Left to choose by itself, WebKit changed the session as a
 * turn ended with the phone locked, and the voice's context was interrupted
 * until the phone was unlocked (iPhone 15, iOS 27.2). Returns the release.
 */
export function holdPlayAndRecordSession(): () => void {
  const session = pageAudioSession();
  if (!session) return () => {};
  const before = session.type;
  session.type = "play-and-record";
  return () => {
    if (session.type === "play-and-record") session.type = before;
  };
}
