import { useCallback, useEffect, useEffectEvent, useRef } from "react";

import { MUTE_GRACE_MS } from "./audioTuning";
import { ShellVoiceAudio } from "./shellVoiceAudio";

/** A timer this much later than asked for was not run by a live page. */
const FROZEN_PAGE_SLACK_MS = 2_000;

/**
 * `hidden`: the track went quiet because the page was hidden; a phone mutes
 * capture on lock or on the home screen. Not a microphone failure.
 */
export type TrackLossReason = "ended" | "muted" | "hidden";

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
 *   - A track that is muted while the page is hidden is reported as
 *     `hidden` at once, whichever of the two came first: the page is not
 *     shown, so nobody is talking to it, and the timers of a locked phone
 *     may only run again after unlocking, too late to tell a lock apart.
 *   - The app shell's voice audio is watched the same way: a close by the
 *     shell is `ended` at once, an interruption (a call, another app) is a
 *     mute. It keeps listening while the page is hidden.
 *
 * No re-acquire: re-running getUserMedia can return a different sample rate
 * that collides with the rate-coupled `new AudioContext({ sampleRate })`, so
 * the safe baseline is a clean stop with a surfaced error. Engine-agnostic —
 * `ended` is reliable everywhere and the grace window is harmless off-WebKit.
 *
 * `onTrackLost` is invoked through a stable Effect Event, so the returned
 * `watchTrack` / `unwatchTrack` stay referentially stable and the consumer
 * can pass a freshly-bound (inline) handler each render without re-attaching
 * listeners or going stale.
 */
export function useMediaStreamTrackWatchdog({
  onTrackLost,
}: {
  onTrackLost: (reason: TrackLossReason) => void;
}): {
  watchTrack: (track: MediaStreamTrack | ShellVoiceAudio) => void;
  unwatchTrack: () => void;
} {
  const watchedTrackRef = useRef<MediaStreamTrack | ShellVoiceAudio | null>(
    null,
  );
  // Detaches the listeners from the currently-watched track. Held in a ref
  // (rather than re-derived) so watchTrack/unwatchTrack stay stable and the
  // closed-over handlers are released exactly once.
  const detachRef = useRef<(() => void) | null>(null);
  // Backs both the mute grace timer and the deferred already-ended report,
  // so a teardown that lands first can cancel either via unwatchTrack.
  const pendingLossTimerRef = useRef<number | null>(null);

  // Effect Event: always sees the latest `onTrackLost` without making it a
  // reactive dependency, and is only ever called locally from the loss
  // handlers below (never passed across a hook boundary), so it replaces the
  // old `onTrackLostRef` + sync-effect trampoline.
  const onTrackLostEvent = useEffectEvent((reason: TrackLossReason) => {
    onTrackLost(reason);
  });

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
      onTrackLostEvent(reason);
    },
    // `onTrackLostEvent` is a stable Effect Event, so listing it never
    // re-creates this callback; it's listed only because the loss path runs
    // through this imperative `useCallback` (not a `useEffect`), where
    // exhaustive-deps treats it as an ordinary reference.
    [unwatchTrack, onTrackLostEvent],
  );

  const watchTrack = useCallback(
    (track: MediaStreamTrack | ShellVoiceAudio) => {
      if (watchedTrackRef.current === track) {
        return;
      }
      unwatchTrack();
      if (track instanceof ShellVoiceAudio) {
        const follow = () => {
          clearPendingLossTimer();
          if (track.state === "closed") reportLost("ended");
          else if (track.interrupted)
            pendingLossTimerRef.current = window.setTimeout(() => {
              pendingLossTimerRef.current = null;
              if (track.interrupted) reportLost("muted");
            }, MUTE_GRACE_MS);
        };
        detachRef.current = track.onStateChange(follow);
        watchedTrackRef.current = track;
        // As for a track: never back into the start that is still running.
        if (track.state === "closed" || track.interrupted)
          pendingLossTimerRef.current = window.setTimeout(follow, 0);
        return;
      }

      const handleEnded = () => reportLost("ended");
      const reportIfHidden = () => {
        if (track.muted && document.visibilityState === "hidden") {
          reportLost("hidden");
          return true;
        }
        return false;
      };
      const handleMute = () => {
        clearPendingLossTimer();
        if (reportIfHidden()) return;
        const armedAt = Date.now();
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
          if (!track.muted || reportIfHidden()) {
            return;
          }
          // Far too late: the page was frozen, as a locked phone freezes it,
          // and the hide may only be told after this.
          if (Date.now() - armedAt > MUTE_GRACE_MS + FROZEN_PAGE_SLACK_MS) {
            reportLost("hidden");
            return;
          }
          reportLost("muted");
        }, MUTE_GRACE_MS);
      };
      const handleUnmute = () => clearPendingLossTimer();

      track.addEventListener("ended", handleEnded);
      track.addEventListener("mute", handleMute);
      track.addEventListener("unmute", handleUnmute);
      document.addEventListener("visibilitychange", reportIfHidden);
      detachRef.current = () => {
        track.removeEventListener("ended", handleEnded);
        track.removeEventListener("mute", handleMute);
        track.removeEventListener("unmute", handleUnmute);
        document.removeEventListener("visibilitychange", reportIfHidden);
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
      } else if (track.muted) {
        // Muted already, it fires no `mute` of its own.
        pendingLossTimerRef.current = window.setTimeout(() => {
          pendingLossTimerRef.current = null;
          if (watchedTrackRef.current === track && track.muted) handleMute();
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
