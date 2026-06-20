import { useCallback, useEffect, useRef } from "react";

import { MUTE_GRACE_MS } from "./audioTuning";

export type TrackLossReason = "ended" | "muted";

/**
 * Watches the live capture `MediaStreamTrack` for mid-session device-loss:
 * a Bluetooth route change (AirPods connect/disconnect), an incoming call,
 * or an unplugged device can end or mute the track, after which the audio
 * graph silently produces nothing — no frames, no error, no recovery. This
 * is the signal the AudioContext interruption recovery
 * (`useAudioContextInterruptionRecovery`) does not cover.
 *
 *   - `ended` is the authoritative "dead" signal → reported immediately.
 *   - `mute`/`unmute` are browser-controlled (distinct from the
 *     app-controlled `enabled`) and fire transiently on iOS during route
 *     changes, so "mute → lost" would false-positive. A `mute` arms a grace
 *     timer (`MUTE_GRACE_MS`); an `unmute` cancels it. Only a mute that
 *     outlives the window is treated as lost. `unmute` is not guaranteed to
 *     arrive, so grace-expiry escalation is the intended fallback; the timer
 *     re-reads live track state rather than trusting the stale event.
 *
 * No re-acquire: re-running getUserMedia can return a different sample rate
 * that collides with the rate-coupled `new AudioContext({ sampleRate })`, so
 * the safe baseline is a clean stop with a surfaced error. Engine-agnostic —
 * `ended` is reliable everywhere and the grace window is harmless off-WebKit.
 *
 * `onTrackLost` is read through an internal ref, so the returned
 * `watchTrack` / `unwatchTrack` are stable and the consumer can pass a
 * freshly-bound handler each render without re-attaching listeners.
 */
export function useMediaStreamTrackWatchdog({
  onTrackLost,
}: {
  onTrackLost: (reason: TrackLossReason) => void;
}): {
  watchTrack: (track: MediaStreamTrack) => void;
  unwatchTrack: () => void;
} {
  const watchedTrackRef = useRef<MediaStreamTrack | null>(null);
  // Detaches the listeners from the currently-watched track. Held in a ref
  // (rather than re-derived) so watchTrack/unwatchTrack stay stable and the
  // closed-over handlers are released exactly once.
  const detachRef = useRef<(() => void) | null>(null);
  // Backs both the mute grace timer and the deferred already-ended report,
  // so a teardown that lands first can cancel either via unwatchTrack.
  const pendingLossTimerRef = useRef<number | null>(null);
  const onTrackLostRef = useRef(onTrackLost);

  useEffect(() => {
    onTrackLostRef.current = onTrackLost;
  }, [onTrackLost]);

  const clearPendingLossTimer = useCallback(() => {
    if (pendingLossTimerRef.current !== null) {
      window.clearTimeout(pendingLossTimerRef.current);
      pendingLossTimerRef.current = null;
    }
  }, []);

  const unwatchTrack = useCallback(() => {
    clearPendingLossTimer();
    detachRef.current?.();
    detachRef.current = null;
    watchedTrackRef.current = null;
  }, [clearPendingLossTimer]);

  const reportLost = useCallback(
    (reason: TrackLossReason) => {
      // Detach FIRST so a follow-up event on the same track (e.g. `ended`
      // arriving after a grace-window `muted`) can't fire onTrackLost twice.
      unwatchTrack();
      onTrackLostRef.current(reason);
    },
    [unwatchTrack],
  );

  const watchTrack = useCallback(
    (track: MediaStreamTrack) => {
      if (watchedTrackRef.current === track) {
        return;
      }
      unwatchTrack();

      const handleEnded = () => reportLost("ended");
      const handleMute = () => {
        clearPendingLossTimer();
        pendingLossTimerRef.current = window.setTimeout(() => {
          pendingLossTimerRef.current = null;
          if (watchedTrackRef.current !== track) {
            return;
          }
          // Re-read live state at decision time rather than trusting the
          // stale `mute` event. If the track fully died during the window
          // (a mute that progressed to `ended` without us hearing the
          // event), report the authoritative `ended` reason, not a soft
          // `muted`. A recovered (unmuted) track is a benign transient.
          if (track.readyState === "ended") {
            reportLost("ended");
            return;
          }
          if (!track.muted) {
            return;
          }
          reportLost("muted");
        }, MUTE_GRACE_MS);
      };
      const handleUnmute = () => clearPendingLossTimer();

      track.addEventListener("ended", handleEnded);
      track.addEventListener("mute", handleMute);
      track.addEventListener("unmute", handleUnmute);
      detachRef.current = () => {
        track.removeEventListener("ended", handleEnded);
        track.removeEventListener("mute", handleMute);
        track.removeEventListener("unmute", handleUnmute);
      };
      watchedTrackRef.current = track;

      // A device change can race between getUserMedia resolving and this
      // attach, so the track may already be dead — and a track that's
      // already `ended` will never dispatch the event we just bound. Report
      // it, but on a fresh task so we never re-enter the still-running start
      // path synchronously (the caller wires onTrackLost to a full stop).
      if (track.readyState === "ended") {
        pendingLossTimerRef.current = window.setTimeout(() => {
          pendingLossTimerRef.current = null;
          if (watchedTrackRef.current === track) {
            reportLost("ended");
          }
        }, 0);
      }
    },
    [clearPendingLossTimer, reportLost, unwatchTrack],
  );

  useEffect(() => {
    return () => {
      unwatchTrack();
    };
  }, [unwatchTrack]);

  return { watchTrack, unwatchTrack };
}
