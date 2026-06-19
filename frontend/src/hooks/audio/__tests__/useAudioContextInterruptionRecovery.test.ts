import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAudioContextInterruptionRecovery } from "../useAudioContextInterruptionRecovery";

const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type FakeContext = {
  state: AudioContextState;
  resume: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  emit: (type: string) => void;
};

function makeContext(state: AudioContextState): FakeContext {
  const handlers: Record<string, Array<() => void>> = {};
  return {
    state,
    resume: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn((type: string, handler: () => void) => {
      (handlers[type] ??= []).push(handler);
    }),
    removeEventListener: vi.fn((type: string, handler: () => void) => {
      handlers[type] = (handlers[type] ?? []).filter((h) => h !== handler);
    }),
    emit: (type: string) => (handlers[type] ?? []).forEach((h) => h()),
  };
}

function renderRecovery(context: FakeContext, processor: unknown) {
  const audioContextRef = { current: context as unknown as AudioContext };
  const audioProcessorRef = {
    current: processor as AudioWorkletNode | null,
  };
  const hook = renderHook(() =>
    useAudioContextInterruptionRecovery({ audioContextRef, audioProcessorRef }),
  );
  return { hook, audioContextRef, audioProcessorRef };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAudioContextInterruptionRecovery on WebKit", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { userAgent: SAFARI_UA });
  });

  it("resumes a suspended context on statechange during an active capture", () => {
    const ctx = makeContext("suspended");
    const { hook } = renderRecovery(ctx, {});
    hook.result.current.attachStateChangeListener(
      ctx as unknown as AudioContext,
    );

    expect(ctx.addEventListener).toHaveBeenCalledWith(
      "statechange",
      expect.any(Function),
    );
    ctx.emit("statechange");
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("does NOT resume when no capture is active (processor null)", () => {
    const ctx = makeContext("suspended");
    const { hook } = renderRecovery(ctx, null);
    hook.result.current.attachStateChangeListener(
      ctx as unknown as AudioContext,
    );

    ctx.emit("statechange");
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it("does NOT resume when the context is already running", () => {
    const ctx = makeContext("running");
    const { hook } = renderRecovery(ctx, {});
    hook.result.current.attachStateChangeListener(
      ctx as unknown as AudioContext,
    );

    ctx.emit("statechange");
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it("resumes on visibilitychange when suspended + active", () => {
    const ctx = makeContext("suspended");
    renderRecovery(ctx, {});

    document.dispatchEvent(new Event("visibilitychange"));
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("removes both listeners on unmount and stops resuming", () => {
    const ctx = makeContext("suspended");
    const { hook } = renderRecovery(ctx, {});
    hook.result.current.attachStateChangeListener(
      ctx as unknown as AudioContext,
    );

    hook.unmount();
    expect(ctx.removeEventListener).toHaveBeenCalledWith(
      "statechange",
      expect.any(Function),
    );

    ctx.resume.mockClear();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(ctx.resume).not.toHaveBeenCalled();
  });
});

describe("useAudioContextInterruptionRecovery on non-WebKit", () => {
  it("attaches no listeners on Chromium", () => {
    vi.stubGlobal("navigator", { userAgent: CHROME_UA });
    const documentAdd = vi.spyOn(document, "addEventListener");

    const ctx = makeContext("suspended");
    const { hook } = renderRecovery(ctx, {});
    hook.result.current.attachStateChangeListener(
      ctx as unknown as AudioContext,
    );

    expect(ctx.addEventListener).not.toHaveBeenCalled();
    expect(documentAdd).not.toHaveBeenCalledWith(
      "visibilitychange",
      expect.anything(),
    );
  });
});
