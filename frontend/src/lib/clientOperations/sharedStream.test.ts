import { afterEach, describe, expect, it, vi } from "vitest";

import { browserTabSignals } from "./sharedStream";

afterEach(() => {
  Reflect.deleteProperty(document, "visibilityState");
});

describe("browserTabSignals", () => {
  it("follows the document's visibility and carries announcements between tabs", async () => {
    const changed = vi.fn();
    const wanted = vi.fn();
    const tab = browserTabSignals.connect(changed, wanted);
    const other = browserTabSignals.connect(vi.fn(), vi.fn());
    try {
      expect(browserTabSignals.inUse()).toBe(true);
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(changed).toHaveBeenCalledOnce();
      expect(browserTabSignals.inUse()).toBe(false);
      other.announce("binding");
      await vi.waitFor(() => expect(wanted).toHaveBeenCalledWith("binding"));
    } finally {
      tab.close();
      other.close();
    }
    document.dispatchEvent(new Event("visibilitychange"));
    expect(changed).toHaveBeenCalledOnce();
  });
});
