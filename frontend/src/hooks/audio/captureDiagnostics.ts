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
 * Logged on successful capture. The key signal is `measuredRate` vs
 * `contextSampleRate`: if they diverge, frames arrived at a different rate
 * than the buffer is tagged with → the buffer would play back stretched.
 * They should match closely when the fix is working.
 */
export function logCaptureComplete(info: {
  contextSampleRate: number;
  deliveredSamples: number;
  elapsedMs: number;
  totalSamples: number;
  quietSamples: number;
  speechSamples: number;
}): void {
  if (!devEnabled()) {
    return;
  }
  const measuredRate =
    info.elapsedMs > 0
      ? Math.round((info.deliveredSamples / info.elapsedMs) * 1000)
      : 0;
  console.info(`${PREFIX} capture complete`, {
    contextSampleRate: info.contextSampleRate,
    measuredRate,
    rateDeltaPct:
      info.contextSampleRate > 0
        ? Math.round(
            ((measuredRate - info.contextSampleRate) / info.contextSampleRate) *
              100,
          )
        : 0,
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
