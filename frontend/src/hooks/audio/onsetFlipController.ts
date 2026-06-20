/**
 * Wires the pure `onsetDetector` to the UI "speak now" cue with the
 * `MIN_AUDIO_CAPTURE_DELAY_MS` deferral floor, so both recorder hooks
 * share one onset implementation instead of a copy-pasted message-handler
 * block. The hook supplies the guarded `onFlip` (it knows
 * about `isMounted` / the live processor ref) and an optional diagnostics
 * sink; everything else — detection, debounce, the deferral timer, and
 * fire-once semantics — lives here.
 */

import { MIN_AUDIO_CAPTURE_DELAY_MS, ONSET_TUNING } from "./audioTuning";
import { createOnsetDetector } from "./onsetDetector";

export type OnsetDiagnostics = {
  rms: number;
  epsilon: number | null;
  phase: string;
};

export type SpeechOnsetController = {
  /** Feed one received PCM frame. No-op after the cue has flipped. */
  acceptFrame: (frame: Float32Array) => void;
  /** Cancel any pending deferred flip. Call on capture teardown. */
  dispose: () => void;
};

export function createSpeechOnsetController(options: {
  sampleRate: number;
  /** Flip the cue. Must itself guard against stale/torn-down pipelines. */
  onFlip: () => void;
  /** Optional per-frame diagnostics sink (dev-gated by the caller). */
  log?: (diagnostics: OnsetDiagnostics) => void;
}): SpeechOnsetController {
  const detector = createOnsetDetector({ sampleRate: options.sampleRate });
  const pipelineReadyAt = Date.now();
  let onsetReached = false;
  let flipTimerId: number | null = null;
  let backstopTimerId: number | null = null;

  const clearBackstop = () => {
    if (backstopTimerId !== null) {
      window.clearTimeout(backstopTimerId);
      backstopTimerId = null;
    }
  };

  // Wall-clock backstop: the detector's max-hold is measured in audio
  // time and only advances while frames arrive, so a capture that stalls
  // before onset would hang the cue forever. This frame-independent timer
  // guarantees the cue resolves regardless of frame delivery. It normally
  // never fires — the audio-time path wins under live frame flow.
  backstopTimerId = window.setTimeout(() => {
    backstopTimerId = null;
    if (!onsetReached) {
      onsetReached = true;
      options.onFlip();
    }
  }, ONSET_TUNING.wallClockBackstopMs);

  return {
    acceptFrame(frame) {
      if (onsetReached) {
        return;
      }
      const outcome = detector.accept(frame);
      options.log?.({
        rms: outcome.frameRms,
        epsilon: outcome.epsilon,
        phase: outcome.phase,
      });
      if (!outcome.onset) {
        return;
      }
      onsetReached = true;
      // Onset reached on its own — the backstop is no longer needed.
      clearBackstop();

      // Honor the MIN_AUDIO_CAPTURE_DELAY_MS floor: hold the cue at least
      // this long after pipeline-ready so a warm
      // device doesn't blink the spinner. In real-time delivery onset
      // already trails calibration past this floor; the deferral remains
      // for buffered-burst delivery and to keep the invariant intact.
      const elapsed = Date.now() - pipelineReadyAt;
      const remaining = MIN_AUDIO_CAPTURE_DELAY_MS - elapsed;
      if (remaining > 0) {
        flipTimerId = window.setTimeout(() => {
          flipTimerId = null;
          options.onFlip();
        }, remaining);
      } else {
        options.onFlip();
      }
    },
    dispose() {
      clearBackstop();
      if (flipTimerId !== null) {
        window.clearTimeout(flipTimerId);
        flipTimerId = null;
      }
    },
  };
}
