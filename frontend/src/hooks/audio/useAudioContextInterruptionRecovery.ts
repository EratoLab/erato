import { useCallback, useEffect, useRef } from "react";

import { getAudioEnvironment } from "./audioEnvironment";

/**
 * iOS/WebKit recovery for a wedged AudioContext, shared by both recorder
 * hooks (ERMAIN-379). WebKit can drop a context into an `"interrupted"` /
 * `"suspended"` state on a phone call, Siri, or tab backgrounding and not
 * auto-resume, leaving a dead capture graph (WebAudio #2585). We re-resume
 * on `statechange` and on `visibilitychange` (page returning to the
 * foreground), but ONLY while a capture is active — between sessions the
 * context is deliberately suspended to stay warm, and recovery must never
 * wake that intentionally-idle context. Other engines auto-resume, so the
 * listeners are skipped there entirely.
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
    if (
      typeof document === "undefined" ||
      !getAudioEnvironment().needsGestureResume
    ) {
      return;
    }
    document.addEventListener("visibilitychange", resumeIfInterrupted);
    return () => {
      document.removeEventListener("visibilitychange", resumeIfInterrupted);
      boundContextRef.current?.removeEventListener(
        "statechange",
        resumeIfInterrupted,
      );
      boundContextRef.current = null;
    };
  }, [resumeIfInterrupted]);

  return { attachStateChangeListener };
}
