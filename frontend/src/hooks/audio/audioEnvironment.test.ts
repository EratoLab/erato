import { afterEach, describe, expect, it, vi } from "vitest";

import { detectBrowserEngine, getAudioEnvironment } from "./audioEnvironment";

describe("detectBrowserEngine", () => {
  it("classifies iOS browsers as webkit regardless of their vendor token", () => {
    expect(
      detectBrowserEngine(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/120.0",
      ),
    ).toBe("webkit");
    expect(
      detectBrowserEngine("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) FxiOS/120"),
    ).toBe("webkit");
  });

  it("classifies desktop engines from their vendor token", () => {
    expect(detectBrowserEngine("Mozilla/5.0 ... Firefox/128.0")).toBe(
      "firefox",
    );
    expect(detectBrowserEngine("Mozilla/5.0 ... Chrome/120.0 Safari/537")).toBe(
      "chromium",
    );
  });
});

describe("getAudioEnvironment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to the unknown environment when navigator exposes no userAgent", () => {
    // Embedded contexts (the Storybook iframe among them) hand back a
    // navigator whose userAgent is undefined.
    vi.stubGlobal("navigator", {});

    expect(() => getAudioEnvironment()).not.toThrow();
    expect(getAudioEnvironment().engine).toBe("unknown");
  });

  it("falls back to the unknown environment when there is no navigator at all", () => {
    vi.stubGlobal("navigator", undefined);

    expect(getAudioEnvironment().engine).toBe("unknown");
  });

  it("prefers an explicitly supplied userAgent over the live navigator", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 ... Firefox/128.0" });

    expect(getAudioEnvironment("Mozilla/5.0 ... Chrome/120.0").engine).toBe(
      "chromium",
    );
  });
});
