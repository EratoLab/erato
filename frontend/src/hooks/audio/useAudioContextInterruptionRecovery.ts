import { useCallback, useEffect, useRef } from "react";

import { getAudioEnvironment } from "./audioEnvironment";

/** Long enough for a running clock to move on by several render quanta. */
export const CLOCK_CHECK_MS = 300;
/** Right after unlocking the audio output may still be waking up. */
const CLOCK_REVIVE_ATTEMPTS = 3;

/**
 * Starts the clock of a context that says `"running"` but stands still, as
 * WebKit leaves one after a phone lock (`clockMayStandStillWhileRunning`):
 * only a suspend followed by a resume moves it on. A context whose clock
 * moves, or that is not running, is left alone.
 */
export async function reviveStandingClock(context: AudioContext) {
  if (!getAudioEnvironment().clockMayStandStillWhileRunning) return;
  // A call, not a narrowed property: the state changes across the awaits.
  const running = () => context.state === "running";
  for (let attempt = 0; attempt < CLOCK_REVIVE_ATTEMPTS; attempt++) {
    if (!running() || document.visibilityState === "hidden") return;
    const before = context.currentTime;
    await new Promise((resolve) => setTimeout(resolve, CLOCK_CHECK_MS));
    if (!running() || context.currentTime !== before) return;
    try {
      await context.suspend();
      await context.resume();
    } catch {
      return;
    }
  }
}

/**
 * iOS/WebKit recovery for a wedged AudioContext, shared by both recorder
 * hooks (ERMAIN-379). WebKit can drop a context into an `"interrupted"` /
 * `"suspended"` state on a phone call, Siri, or tab backgrounding and not
 * auto-resume, leaving a dead capture graph (WebAudio #2585). We re-resume
 * on `statechange` and on `visibilitychange` (page returning to the
 * foreground), but ONLY while a capture is active — between sessions the
 * context is deliberately suspended to stay warm, and recovery must never
 * wake that intentionally-idle context. Other engines auto-resume, so the
 * listeners are skipped there entirely. On return a capture's clock that
 * stands still while "running" is started again too (`reviveStandingClock`).
 *
 * Known narrow gap (#2, intentionally not closed here): on session 2+ the
 * processor ref is null between teardown and the post-`getUserMedia`
 * reassignment. An interruption landing in that window is gated out, and if
 * the page never backgrounds no `visibilitychange` fires either — so the
 * processor can connect to a still-interrupted context. The common path is
 * covered by `ensureAudioContextReady`'s own `await resume()`; this is a
 * pre-existing-class edge (no resume listener existed before this branch),
 * not a regression, so it's documented rather than papered over.
 */
export function useAudioContextInterruptionRecovery({
  audioContextRef,
  audioProcessorRef,
}: {
  audioContextRef: React.MutableRefObject<AudioContext | null>;
  audioProcessorRef: React.MutableRefObject<AudioWorkletNode | null>;
}): { attachStateChangeListener: (context: AudioContext) => void } {
  // The context bound to `statechange`, tracked so we can detach on unmount
  // / context replacement. Avoids the leak of a property-assigned handler
  // on a long-lived suspended-not-closed context.
  const boundContextRef = useRef<AudioContext | null>(null);

  const resumeIfInterrupted = useCallback(() => {
    const audioContext = audioContextRef.current;
    if (
      !audioContext ||
      audioContext.state === "closed" ||
      audioContext.state === "running" ||
      // Active-capture gate: never wake an intentionally idle-suspended
      // context between sessions.
      audioProcessorRef.current === null
    ) {
      return;
    }
    void audioContext.resume().catch(() => {
      // Resume can reject if user activation has expired; the next gesture
      // (or ensureAudioContextReady on the next session) retries.
    });
  }, [audioContextRef, audioProcessorRef]);

  const recoverOnReturn = useCallback(() => {
    const audioContext = audioContextRef.current;
    if (
      audioContext?.state === "running" &&
      audioProcessorRef.current &&
      document.visibilityState === "visible"
    )
      void reviveStandingClock(audioContext);
    else resumeIfInterrupted();
  }, [audioContextRef, audioProcessorRef, resumeIfInterrupted]);

  const attachStateChangeListener = useCallback(
    (context: AudioContext) => {
      if (!getAudioEnvironment().needsGestureResume) {
        return;
      }
      if (boundContextRef.current === context) {
        return;
      }
      boundContextRef.current?.removeEventListener(
        "statechange",
        resumeIfInterrupted,
      );
      context.addEventListener("statechange", resumeIfInterrupted);
      boundContextRef.current = context;
    },
    [resumeIfInterrupted],
  );

  useEffect(() => {
    const environment = getAudioEnvironment();
    if (
      typeof document === "undefined" ||
      !(
        environment.needsGestureResume ||
        environment.clockMayStandStillWhileRunning
      )
    ) {
      return;
    }
    document.addEventListener("visibilitychange", recoverOnReturn);
    return () => {
      document.removeEventListener("visibilitychange", recoverOnReturn);
      boundContextRef.current?.removeEventListener(
        "statechange",
        resumeIfInterrupted,
      );
      boundContextRef.current = null;
    };
  }, [recoverOnReturn, resumeIfInterrupted]);

  return { attachStateChangeListener };
}
