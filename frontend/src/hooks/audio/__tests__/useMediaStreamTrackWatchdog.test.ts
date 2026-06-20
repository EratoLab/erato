import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MUTE_GRACE_MS } from "../audioTuning";
import {
  useMediaStreamTrackWatchdog,
  type TrackLossReason,
} from "../useMediaStreamTrackWatchdog";

/**
 * Minimal MediaStreamTrack stand-in: a real EventTarget (so add/remove +
 * dispatch behave like the browser) plus the mutable `readyState` / `muted`
 * the watchdog reads. `stop()` flips `readyState` WITHOUT dispatching
 * `ended`, matching the spec — that's why an intentional teardown never
 * trips the watchdog.
 */
class FakeTrack extends EventTarget {
  readyState: MediaStreamTrackState = "live";
  muted = false;

  stop() {
    this.readyState = "ended";
  }

  end() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }

  mute() {
    this.muted = true;
    this.dispatchEvent(new Event("mute"));
  }

  unmute() {
    this.muted = false;
    this.dispatchEvent(new Event("unmute"));
  }
}

function renderWatchdog() {
  const onTrackLost = vi.fn<(reason: TrackLossReason) => void>();
  const hook = renderHook(() => useMediaStreamTrackWatchdog({ onTrackLost }));
  return { hook, onTrackLost };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useMediaStreamTrackWatchdog", () => {
  it("reports `ended` immediately as the authoritative dead signal", () => {
    const { hook, onTrackLost } = renderWatchdog();
    const track = new FakeTrack();
    hook.result.current.watchTrack(track as unknown as MediaStreamTrack);

    track.end();
    expect(onTrackLost).toHaveBeenCalledExactlyOnceWith("ended");
  });

  it("does NOT report a transient mute that recovers within the grace window", () => {
    const { hook, onTrackLost } = renderWatchdog();
    const track = new FakeTrack();
    hook.result.current.watchTrack(track as unknown as MediaStreamTrack);

    track.mute();
    vi.advanceTimersByTime(MUTE_GRACE_MS - 1);
    track.unmute();
    vi.advanceTimersByTime(MUTE_GRACE_MS);

    expect(onTrackLost).not.toHaveBeenCalled();
  });

  it("reports `muted` only once the mute outlives the grace window", () => {
    const { hook, onTrackLost } = renderWatchdog();
    const track = new FakeTrack();
    hook.result.current.watchTrack(track as unknown as MediaStreamTrack);

    track.mute();
    vi.advanceTimersByTime(MUTE_GRACE_MS - 1);
    expect(onTrackLost).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTrackLost).toHaveBeenCalledExactlyOnceWith("muted");
  });

  it("does not escalate a mute that has already unmuted by the time the timer fires", () => {
    const { hook, onTrackLost } = renderWatchdog();
    const track = new FakeTrack();
    hook.result.current.watchTrack(track as unknown as MediaStreamTrack);

    track.mute();
    // Clear `muted` without dispatching `unmute` (defensive: the timer
    // re-reads live track state, not just the cancelled-timer path).
    track.muted = false;
    vi.advanceTimersByTime(MUTE_GRACE_MS);

    expect(onTrackLost).not.toHaveBeenCalled();
  });

  it("escalates a mute that progressed to `ended` during the window as `ended`", () => {
    const { hook, onTrackLost } = renderWatchdog();
    const track = new FakeTrack();
    hook.result.current.watchTrack(track as unknown as MediaStreamTrack);

    track.mute();
    // Track fully dies during the grace window without us hearing `ended`
    // (readyState flips, no event dispatched). The decision-time re-read
    // should report the authoritative `ended`, not a soft `muted`.
    track.readyState = "ended";
    vi.advanceTimersByTime(MUTE_GRACE_MS);

    expect(onTrackLost).toHaveBeenCalledExactlyOnceWith("ended");
  });

  it("fires at most once when `ended` follows a grace-window mute", () => {
    const { hook, onTrackLost } = renderWatchdog();
    const track = new FakeTrack();
    hook.result.current.watchTrack(track as unknown as MediaStreamTrack);

    track.mute();
    vi.advanceTimersByTime(MUTE_GRACE_MS);
    expect(onTrackLost).toHaveBeenCalledExactlyOnceWith("muted");

    // A late `ended` on the same (now detached) track must not re-fire.
    track.end();
    expect(onTrackLost).toHaveBeenCalledTimes(1);
  });

  it("reports a track that is already `ended` at attach time (async, no re-entrancy)", () => {
    const { hook, onTrackLost } = renderWatchdog();
    const track = new FakeTrack();
    track.stop(); // ended before we attach; `ended` will never dispatch

    hook.result.current.watchTrack(track as unknown as MediaStreamTrack);
    // Deferred onto a fresh task so it can't re-enter the caller's start.
    expect(onTrackLost).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(onTrackLost).toHaveBeenCalledExactlyOnceWith("ended");
  });

  it("does not fire after unwatchTrack, including a pending mute timer", () => {
    const { hook, onTrackLost } = renderWatchdog();
    const track = new FakeTrack();
    hook.result.current.watchTrack(track as unknown as MediaStreamTrack);

    track.mute();
    hook.result.current.unwatchTrack();
    vi.advanceTimersByTime(MUTE_GRACE_MS);
    track.end();

    expect(onTrackLost).not.toHaveBeenCalled();
  });

  it("detaches the previous track when a new one is watched", () => {
    const { hook, onTrackLost } = renderWatchdog();
    const first = new FakeTrack();
    const second = new FakeTrack();
    hook.result.current.watchTrack(first as unknown as MediaStreamTrack);
    hook.result.current.watchTrack(second as unknown as MediaStreamTrack);

    first.end();
    expect(onTrackLost).not.toHaveBeenCalled();

    second.end();
    expect(onTrackLost).toHaveBeenCalledExactlyOnceWith("ended");
  });

  it("stops reporting once the host unmounts", () => {
    const { hook, onTrackLost } = renderWatchdog();
    const track = new FakeTrack();
    hook.result.current.watchTrack(track as unknown as MediaStreamTrack);

    hook.unmount();
    track.mute();
    vi.advanceTimersByTime(MUTE_GRACE_MS);
    track.end();

    expect(onTrackLost).not.toHaveBeenCalled();
  });
});
