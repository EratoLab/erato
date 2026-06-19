import { afterEach, describe, expect, it, vi } from "vitest";

import {
  audioEnvironmentForEngine,
  detectBrowserEngine,
  getAudioEnvironment,
} from "../audioEnvironment";

const UA = {
  desktopSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  chromeOnIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  desktopFirefox:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
};

describe("detectBrowserEngine", () => {
  it("classifies desktop Safari and all iOS browsers as webkit", () => {
    expect(detectBrowserEngine(UA.desktopSafari)).toBe("webkit");
    expect(detectBrowserEngine(UA.iphoneSafari)).toBe("webkit");
    expect(detectBrowserEngine(UA.chromeOnIos)).toBe("webkit");
  });

  it("classifies desktop/Android Chrome as chromium and Firefox as firefox", () => {
    expect(detectBrowserEngine(UA.desktopChrome)).toBe("chromium");
    expect(detectBrowserEngine(UA.androidChrome)).toBe("chromium");
    expect(detectBrowserEngine(UA.desktopFirefox)).toBe("firefox");
  });
});

describe("audioEnvironmentForEngine", () => {
  it("sets WebKit capture-quirk flags only for webkit", () => {
    const webkit = audioEnvironmentForEngine("webkit");
    expect(webkit.warmUpEmitsNoiseFloor).toBe(true);
    expect(webkit.mayReturnStereoWithoutEchoCancellation).toBe(true);
    expect(webkit.needsGestureResume).toBe(true);

    for (const engine of ["chromium", "firefox", "unknown"] as const) {
      const env = audioEnvironmentForEngine(engine);
      expect(env.warmUpEmitsNoiseFloor).toBe(false);
      expect(env.mayReturnStereoWithoutEchoCancellation).toBe(false);
      expect(env.needsGestureResume).toBe(false);
    }
  });
});

describe("getAudioEnvironment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses an explicitly passed userAgent over navigator", () => {
    expect(getAudioEnvironment(UA.iphoneSafari).engine).toBe("webkit");
    expect(getAudioEnvironment(UA.desktopChrome).engine).toBe("chromium");
  });

  it("falls back to navigator.userAgent when no argument is given", () => {
    vi.stubGlobal("navigator", { userAgent: UA.desktopSafari });
    expect(getAudioEnvironment().engine).toBe("webkit");
    expect(getAudioEnvironment().needsGestureResume).toBe(true);
  });

  it("returns the all-false 'unknown' environment with no resolvable UA", () => {
    const env = getAudioEnvironment("");
    expect(env.engine).toBe("unknown");
    expect(env.warmUpEmitsNoiseFloor).toBe(false);
    expect(env.mayReturnStereoWithoutEchoCancellation).toBe(false);
    expect(env.needsGestureResume).toBe(false);
  });
});
