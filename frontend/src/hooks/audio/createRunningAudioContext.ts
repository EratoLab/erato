/**
 * Creates an `AudioContext` that is pinned to a preferred sample rate and
 * confirmed to be in the `running` state before it is returned.
 *
 * Browser-agnostic by design, but it exists because of two WebKit/Safari
 * realities (Chromium/Firefox tolerate the naive path):
 *
 *  1. **Rate pinning.** Passing `{ sampleRate }` makes the mic source feed
 *     the graph WITHOUT a cross-rate resample. On WebKit that resample is
 *     unreliable when the input (mic) and output-device rates differ — e.g.
 *     a 48 kHz mic with 44.1 kHz headphones — which manifests as slowed,
 *     pitch-shifted ("robotic"/stretched) capture. Safari may *ignore* the
 *     option and use its own rate anyway, so callers MUST still read
 *     `audioContext.sampleRate` back as the authoritative rate; pinning only
 *     removes the mismatch when it is honored.
 *  2. **Running gate.** Safari often creates the context `suspended` and
 *     flips to `running` only shortly after `resume()`. Returning before it
 *     is running lets a sample-clock consumer start counting against frames
 *     that are not flowing yet. We `resume()` and wait (bounded) for the
 *     `statechange` to `running`.
 *
 * Best-effort: on timeout it resolves with the (possibly still-suspended)
 * context rather than rejecting, so capture can proceed and the caller's own
 * frame-flow backstop decides whether audio is actually arriving.
 */

const AUDIO_CONTEXT_RUNNING_TIMEOUT_MS = 3_000;

function waitForRunning(
  audioContext: AudioContext,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      audioContext.removeEventListener("statechange", handleStateChange);
    };
    const handleStateChange = () => {
      if (audioContext.state === "running") {
        cleanup();
        resolve();
      }
    };
    // Resolve (not reject) on timeout: some environments never flip to
    // running until the first real gesture-driven frame, and the caller
    // proceeds best-effort with its own stalled-frame backstop.
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    audioContext.addEventListener("statechange", handleStateChange);
  });
}

export async function createRunningAudioContext(
  preferredSampleRate?: number,
  options: { runningTimeoutMs?: number } = {},
): Promise<AudioContext> {
  let audioContext: AudioContext;
  try {
    audioContext =
      preferredSampleRate && preferredSampleRate > 0
        ? new AudioContext({ sampleRate: preferredSampleRate })
        : new AudioContext();
  } catch {
    // Browser refused the requested rate (outside its supported range, or
    // Safari rejecting the option) — fall back to the default-rate context.
    // The authoritative rate is read back from `audioContext.sampleRate` by
    // the caller regardless of which branch ran.
    audioContext = new AudioContext();
  }

  if (audioContext.state !== "running") {
    try {
      await audioContext.resume();
    } catch {
      // `resume()` can reject if user activation has lapsed across earlier
      // awaits; fall through and wait for a late statechange instead.
    }
  }

  if (audioContext.state !== "running") {
    await waitForRunning(
      audioContext,
      options.runningTimeoutMs ?? AUDIO_CONTEXT_RUNNING_TIMEOUT_MS,
    );
  }

  return audioContext;
}
