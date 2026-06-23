/**
 * Dev-only diagnostics for the guided-capture pipeline (ERMAIN-380).
 *
 * Every function is a no-op unless `import.meta.env.DEV` is true, so this is
 * dead-code-eliminated from production builds. In dev, messages go through
 * `console.*` and are forwarded to `.agent-dev.log` by the console-forward
 * plugin (run via `just dev_logged`), so the rate/clock evidence for the
 * Safari capture fix is greppable from the log file with the `[mic-check]`
 * prefix — no Safari Web Inspector needed.
 *
 * These intentionally log raw sample rates / counts (programmatic, not
 * user-facing) — hence the file-level lingui disable.
 */
/* eslint-disable lingui/no-unlocalized-strings */

const PREFIX = "[mic-check]";

function devEnabled(): boolean {
  return Boolean(import.meta.env.DEV);
}

/**
 * Logged once the AudioContext is running. `rateHonored: false` means WebKit
 * ignored the pinned rate (track rate ≠ context rate) — the cross-rate path
 * that, before the fix, produced stretched/robotic playback.
 */
export function logCaptureContextReady(info: {
  deviceId: string;
  trackSampleRate: number | undefined;
  contextSampleRate: number;
  contextState: string;
}): void {
  if (!devEnabled()) {
    return;
  }
  console.info(`${PREFIX} context ready`, {
    deviceId: info.deviceId || "(default)",
    trackSampleRate: info.trackSampleRate ?? "(unknown)",
    contextSampleRate: info.contextSampleRate,
    rateHonored: info.trackSampleRate === info.contextSampleRate,
    contextState: info.contextState,
  });
}

/**
 * Logged on successful capture. Proves whether a wall-clock sample deficit is
 * a benign artifact or a real time/pitch distortion, by reconciling THREE
 * clocks:
 *  - wall clock (`elapsedMs`, contaminated by worklet startup latency),
 *  - the AudioContext's own audio clock (`contextElapsedSec` from
 *    `audioContext.currentTime`), and
 *  - the delivered sample count.
 *
 * Derived signals:
 *  - `correctedRate` — delivered/(wall − firstFrameDelay): startup-latency-
 *    corrected throughput.
 *  - `clockRatio` — contextElapsed / wall: ≈1 means the context audio clock
 *    ran at real time; <1 means the render thread genuinely under-ran.
 *  - `bufferVsClock` — totalSamples / (contextElapsed × rate): ≈1 means the
 *    buffer holds every sample the context clock implies (no drops between
 *    worklet and buffer); <1 means frames were dropped in our pipeline.
 *
 * `clockVerdict` reads these out:
 *  - "faithful-realtime": clock ≈ wall AND buffer ≈ clock → samples are
 *    correctly-spaced 1/rate audio; tagging+resampling is correct, NO pitch/
 *    time distortion. The wall-clock `measuredRate` deficit was measurement
 *    noise. (Case 1, benign.)
 *  - "dropped-frames": clock ≈ wall but buffer < clock → gaps in the buffer
 *    (glitchy/lossy), but retained audio is correct-pitch.
 *  - "slow-context-clock": clock < wall → the context under-ran real time;
 *    investigate, this is the case that can mislabel/distort. (Case 2 risk.)
 */
export function logCaptureComplete(info: {
  contextSampleRate: number;
  deliveredSamples: number;
  elapsedMs: number;
  firstFrameDelayMs: number;
  contextElapsedSec: number;
  totalSamples: number;
  quietSamples: number;
  speechSamples: number;
}): void {
  if (!devEnabled()) {
    return;
  }
  const rate = (denominatorMs: number) =>
    denominatorMs > 0
      ? Math.round((info.deliveredSamples / denominatorMs) * 1000)
      : 0;
  const measuredRate = rate(info.elapsedMs);
  const correctedRate = rate(info.elapsedMs - info.firstFrameDelayMs);
  const wallSec = info.elapsedMs / 1000;
  const clockRatio =
    wallSec > 0 ? +(info.contextElapsedSec / wallSec).toFixed(2) : 0;
  const expectedFromClock = info.contextElapsedSec * info.contextSampleRate;
  const bufferVsClock =
    expectedFromClock > 0
      ? +(info.totalSamples / expectedFromClock).toFixed(2)
      : 0;
  const clockVerdict =
    clockRatio < 0.95
      ? "slow-context-clock"
      : bufferVsClock < 0.95
        ? "dropped-frames"
        : "faithful-realtime";
  console.info(`${PREFIX} capture complete`, {
    contextSampleRate: info.contextSampleRate,
    measuredRate,
    correctedRate,
    firstFrameDelayMs: Math.round(info.firstFrameDelayMs),
    rateDeltaPct:
      info.contextSampleRate > 0
        ? Math.round(
            ((correctedRate - info.contextSampleRate) /
              info.contextSampleRate) *
              100,
          )
        : 0,
    clockRatio,
    bufferVsClock,
    clockVerdict,
    durationSec:
      info.contextSampleRate > 0
        ? +(info.totalSamples / info.contextSampleRate).toFixed(2)
        : 0,
    quietSamples: info.quietSamples,
    speechSamples: info.speechSamples,
  });
}

export function logCaptureError(message: string): void {
  if (!devEnabled()) {
    return;
  }
  console.info(`${PREFIX} capture error: ${message}`);
}

/**
 * Logged after each `enumerateDevices()`. Proves whether the browser is
 * exposing real device names (`hasResolvedLabels`) — and an empty `id` is the
 * tell-tale of a pre-permission placeholder device. `trigger` distinguishes
 * the mount load from a devicechange, a manual refresh, or the re-enumeration
 * that runs while a stream is live (the WebKit label-reveal path).
 */
export function logDeviceEnumeration(info: {
  trigger: string;
  deviceCount: number;
  hasResolvedLabels: boolean;
  devices: { deviceId: string; label: string }[];
}): void {
  if (!devEnabled()) {
    return;
  }
  console.info(`${PREFIX} devices [${info.trigger}]`, {
    deviceCount: info.deviceCount,
    hasResolvedLabels: info.hasResolvedLabels,
    devices: info.devices.map((device) => ({
      id: device.deviceId ? `${device.deviceId.slice(0, 8)}…` : "(empty)",
      label: device.label,
    })),
  });
}

/**
 * Traces the on-demand label reveal so we can see, in the log, whether the
 * gesture opened a `getUserMedia` stream and how it resolved — i.e. whether
 * the WebKit permission path is reached and granted/denied/blocked.
 */
export function logDeviceReveal(
  phase: "skip" | "unsupported" | "requesting" | "granted" | "denied" | "error",
  detail?: string,
): void {
  if (!devEnabled()) {
    return;
  }
  console.info(`${PREFIX} reveal: ${phase}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Logged after acoustic analysis. Surfaces the level/SNR numbers behind the
 * traffic-light verdict so a "very quiet" / "noisy" result can be confirmed
 * against the actual dBFS — and compared across browsers.
 */
export function logMicAssessment(info: {
  verdict: string;
  primaryIssue: string | null;
  speechLevelDbfs: number;
  noiseFloorDbfs: number;
  snrDb: number;
  clipEvents: number;
}): void {
  if (!devEnabled()) {
    return;
  }
  console.info(`${PREFIX} assessment`, {
    verdict: info.verdict,
    primaryIssue: info.primaryIssue ?? "(none)",
    speechLevelDbfs: +info.speechLevelDbfs.toFixed(1),
    noiseFloorDbfs: +info.noiseFloorDbfs.toFixed(1),
    snrDb: +info.snrDb.toFixed(1),
    clipEvents: info.clipEvents,
  });
}
