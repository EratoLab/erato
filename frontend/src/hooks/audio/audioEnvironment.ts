/**
 * Browser-engine → named audio-capture capability flags.
 *
 * The goal is no raw `if (isSafari)` at call sites in the recorder hooks:
 * every engine quirk is a named flag, paired with its evidence and an
 * expiry/removal condition, so a future reader knows *why* the branch
 * exists and *when* it can be deleted. Pure and userAgent-injectable, so
 * it unit-tests without a DOM. Mirrors the `isAudioCaptureSupportedPlatform`
 * capability-probe precedent in `office-addin/src/providers/OfficeProvider.tsx`.
 *
 * Scope note (ERMAIN-379): this module covers *audio-capture* engine
 * quirks only. The Firefox `NetworkError` check in `hooks/files/errors.ts`
 * is a file-upload concern (opaque NetworkError → treat as HTTP 413), not
 * audio, so it deliberately stays put rather than being folded in here.
 */

export type BrowserEngine = "webkit" | "firefox" | "chromium" | "unknown";

export type AudioEnvironment = {
  engine: BrowserEngine;

  /**
   * The raw-capture path (echoCancellation/noiseSuppression/autoGainControl
   * all off) emits a low-level noise floor / DC bias at stream start
   * instead of bit-exact zeros. An exact-zero onset predicate trips on
   * this warm-up floor ~1 s before real speech; the RMS onset detector
   * calibrates above it.
   *
   * Evidence: ERMAIN-379 `[AUDIO_DICT]` instrumentation, Chrome vs desktop
   * Safari, 2026-06. Chrome warm-up is bit-exact zeros; WebKit is not.
   * Remove if WebKit ships bit-exact-zero warm-up (re-validate on a real
   * device before deleting — the simulator can emit synthetic zeros).
   */
  warmUpEmitsNoiseFloor: boolean;

  /**
   * May hand back a stereo MediaStream even when `channelCount: { ideal: 1 }`
   * is requested with echoCancellation disabled. The worklet down-mixes
   * mean-of-channels unconditionally, so this is informational/diagnostic.
   *
   * Evidence: WebKit raw-capture behaviour, observed 2026-06 (ERMAIN-379
   * Step 2). Remove if WebKit honours the mono constraint with AEC off.
   */
  mayReturnStereoWithoutEchoCancellation: boolean;

  /**
   * An AudioContext can wedge in an `"interrupted"` / `"suspended"` state
   * (phone call, Siri, tab backgrounding) and not auto-resume, leaving a
   * dead capture graph. A `statechange` / `visibilitychange` re-resume is
   * the cheap mitigation (gated to an active session so it never wakes an
   * intentionally idle-suspended context).
   *
   * Evidence: WebKit `"interrupted"` state — WebAudio issue #2585 (2024),
   * https://github.com/WebAudio/web-audio-api/issues/2585. Android Chrome
   * is at desktop parity and does not need this. Remove when WebKit
   * reliably auto-resumes after interruption.
   */
  needsGestureResume: boolean;
};

/**
 * Classifies a userAgent string into a rendering engine. All browsers on
 * iOS are WebKit regardless of brand, so iOS device tokens classify as
 * `webkit` even for "Chrome"/"Firefox" on iOS.
 */
export function detectBrowserEngine(userAgent: string): BrowserEngine {
  const ua = userAgent.toLowerCase();
  const isIos = /\bip(?:hone|ad|od)\b/.test(ua);

  if (ua.includes("firefox") || ua.includes("fxios")) {
    return isIos ? "webkit" : "firefox";
  }
  if (ua.includes("chrome") || ua.includes("chromium") || ua.includes("crios")) {
    return isIos ? "webkit" : "chromium";
  }
  // Any remaining Safari token classifies as WebKit. This also covers
  // iPadOS 13+ "desktop" Safari, which reports a Macintosh UA but still
  // carries the Safari token — so no maxTouchPoints disambiguation is
  // needed (every real iOS/iPadOS browser's UA contains a Safari token).
  if (ua.includes("safari") || isIos) {
    return "webkit";
  }
  return "unknown";
}

/** Derives the capability flags for a given engine. Pure. */
export function audioEnvironmentForEngine(
  engine: BrowserEngine,
): AudioEnvironment {
  const isWebKit = engine === "webkit";
  return {
    engine,
    warmUpEmitsNoiseFloor: isWebKit,
    mayReturnStereoWithoutEchoCancellation: isWebKit,
    needsGestureResume: isWebKit,
  };
}

/**
 * Resolves the audio environment from a userAgent string (defaults to the
 * live `navigator`). Returns the `unknown` (all-flags-false) environment in
 * a non-browser context.
 */
export function getAudioEnvironment(userAgent?: string): AudioEnvironment {
  const ua =
    userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return audioEnvironmentForEngine(detectBrowserEngine(ua));
}
