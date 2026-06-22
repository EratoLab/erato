import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRunningAudioContext } from "../createRunningAudioContext";

type StateListener = () => void;

/**
 * Minimal AudioContext stand-in covering exactly what the helper touches:
 * the `{ sampleRate }` constructor option (which Safari may reject), `state`,
 * `resume()`, and `statechange` listeners.
 */
class MockAudioContext {
  static rejectOptions = false;
  static resumeRunsContext = true;

  state: "suspended" | "running" | "closed";
  sampleRate: number;
  resume = vi.fn(async () => {
    if (MockAudioContext.resumeRunsContext) {
      this.setState("running");
    }
  });

  private listeners = new Set<StateListener>();

  constructor(options?: { sampleRate?: number }) {
    if (options?.sampleRate !== undefined) {
      if (MockAudioContext.rejectOptions) {
        throw new Error("sampleRate not supported");
      }
      this.sampleRate = options.sampleRate;
    } else {
      this.sampleRate = 44_100;
    }
    this.state = "suspended";
  }

  addEventListener(type: string, listener: StateListener) {
    if (type === "statechange") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: StateListener) {
    if (type === "statechange") {
      this.listeners.delete(listener);
    }
  }

  setState(next: "suspended" | "running" | "closed") {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}

beforeEach(() => {
  MockAudioContext.rejectOptions = false;
  MockAudioContext.resumeRunsContext = true;
  vi.stubGlobal("AudioContext", MockAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createRunningAudioContext", () => {
  it("pins the context to the preferred sample rate", async () => {
    const ctx = (await createRunningAudioContext(
      48_000,
    )) as unknown as MockAudioContext;
    expect(ctx.sampleRate).toBe(48_000);
    expect(ctx.state).toBe("running");
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("falls back to a default-rate context when the option is rejected (Safari)", async () => {
    MockAudioContext.rejectOptions = true;
    const ctx = (await createRunningAudioContext(
      48_000,
    )) as unknown as MockAudioContext;
    // Construction with options threw → helper retried without them.
    expect(ctx.sampleRate).toBe(44_100);
    expect(ctx.state).toBe("running");
  });

  it("creates a default-rate context when no preferred rate is given", async () => {
    const ctx =
      (await createRunningAudioContext()) as unknown as MockAudioContext;
    expect(ctx.sampleRate).toBe(44_100);
  });

  it("resolves once a late statechange flips the context to running", async () => {
    MockAudioContext.resumeRunsContext = false; // resume() does not run it
    const created: MockAudioContext[] = [];
    const Spy = new Proxy(MockAudioContext, {
      construct(target, args: [{ sampleRate?: number }?]) {
        const instance = new target(...args);
        created.push(instance);
        return instance;
      },
    });
    vi.stubGlobal("AudioContext", Spy);

    const promise = createRunningAudioContext(48_000);
    // Flip to running asynchronously, as WebKit does shortly after resume().
    await Promise.resolve();
    created[0].setState("running");

    const ctx = (await promise) as unknown as MockAudioContext;
    expect(ctx.state).toBe("running");
  });

  it("resolves best-effort (does not hang) if the context never runs", async () => {
    MockAudioContext.resumeRunsContext = false;
    const ctx = (await createRunningAudioContext(48_000, {
      runningTimeoutMs: 20,
    })) as unknown as MockAudioContext;
    // Still suspended, but the helper resolved rather than hanging forever.
    expect(ctx.state).toBe("suspended");
  });
});
