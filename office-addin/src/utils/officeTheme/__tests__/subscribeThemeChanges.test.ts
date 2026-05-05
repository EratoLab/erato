import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../../test/mocks/outlook/mailbox";
import { subscribeThemeChanges } from "../subscribeThemeChanges";

type OfficeThemeLike = {
  bodyBackgroundColor: string;
  bodyForegroundColor: string;
  controlBackgroundColor: string;
  controlForegroundColor: string;
  isDarkTheme: boolean;
};

const darkTheme: OfficeThemeLike = {
  bodyBackgroundColor: "#1F1F1F",
  bodyForegroundColor: "#FFFFFF",
  controlBackgroundColor: "#2B2B2B",
  controlForegroundColor: "#FFFFFF",
  isDarkTheme: true,
};

const lightTheme: OfficeThemeLike = {
  bodyBackgroundColor: "#FFFFFF",
  bodyForegroundColor: "#444444",
  controlBackgroundColor: "#F5F5F5",
  controlForegroundColor: "#444444",
  isDarkTheme: false,
};

function installOfficeTheme(theme: OfficeThemeLike) {
  (Office.context as unknown as Record<string, unknown>).officeTheme = theme;
}

function uninstallOfficeTheme() {
  delete (Office.context as unknown as Record<string, unknown>).officeTheme;
}

interface MockMediaQueryList {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  dispatchChange: (matches: boolean) => void;
}

function installMockMatchMedia(initialDark: boolean): MockMediaQueryList {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mq: MockMediaQueryList = {
    matches: initialDark,
    addEventListener: vi.fn(
      (_evt: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
    ),
    removeEventListener: vi.fn(
      (_evt: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
    ),
    dispatchChange: (matches: boolean) => {
      mq.matches = matches;
      const event = { matches } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => mq),
  });
  return mq;
}

function uninstallMockMatchMedia() {
  delete (window as unknown as Record<string, unknown>).matchMedia;
}

describe("subscribeThemeChanges", () => {
  describe("Outlook host", () => {
    beforeEach(() => {
      installMockMailbox();
      installOfficeTheme(darkTheme);
    });

    afterEach(() => {
      uninstallOfficeTheme();
      uninstallMockMailbox();
    });

    it("registers an OfficeThemeChanged handler on the mailbox", () => {
      const handler = vi.fn();

      subscribeThemeChanges("Outlook", handler);

      expect(Office.context.mailbox.addHandlerAsync).toHaveBeenCalledTimes(1);
      const [eventType, registered, callback] = (
        Office.context.mailbox.addHandlerAsync as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock.calls[0];
      expect(eventType).toBe(Office.EventType.OfficeThemeChanged);
      expect(typeof registered).toBe("function");
      expect(typeof callback).toBe("function");
    });

    it("invokes the consumer handler with a parsed snapshot when the event fires", () => {
      const handler = vi.fn();

      subscribeThemeChanges("Outlook", handler);

      const [, registered] = (
        Office.context.mailbox.addHandlerAsync as unknown as {
          mock: { calls: [unknown, (args: unknown) => void, unknown][] };
        }
      ).mock.calls[0];

      registered({
        officeTheme: darkTheme,
        type: "officeThemeChanged",
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        mode: "dark",
        colors: {
          bodyBackground: "#1F1F1F",
          bodyForeground: "#FFFFFF",
          controlBackground: "#2B2B2B",
          controlForeground: "#FFFFFF",
        },
      });
    });

    it("calls removeHandlerAsync when the returned unsubscribe runs", () => {
      const unsubscribe = subscribeThemeChanges("Outlook", vi.fn());

      expect(Office.context.mailbox.removeHandlerAsync).not.toHaveBeenCalled();

      unsubscribe();

      expect(Office.context.mailbox.removeHandlerAsync).toHaveBeenCalledTimes(
        1,
      );
      const [eventType] = (
        Office.context.mailbox.removeHandlerAsync as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock.calls[0];
      expect(eventType).toBe(Office.EventType.OfficeThemeChanged);
    });
  });

  describe("Outlook host with prefers-color-scheme fallback", () => {
    beforeEach(() => {
      installMockMailbox();
    });

    afterEach(() => {
      uninstallOfficeTheme();
      uninstallMockMailbox();
      uninstallMockMatchMedia();
    });

    it("subscribes to matchMedia when Office theme + OS preference agree (both dark)", () => {
      installOfficeTheme(darkTheme);
      const mq = installMockMatchMedia(true);

      subscribeThemeChanges("Outlook", vi.fn());

      expect(mq.addEventListener).toHaveBeenCalledTimes(1);
      expect(mq.addEventListener.mock.calls[0][0]).toBe("change");
    });

    it("does NOT subscribe to matchMedia when signals disagree (explicit Outlook theme)", () => {
      installOfficeTheme(darkTheme);
      const mq = installMockMatchMedia(false); // OS says light, Outlook says dark

      subscribeThemeChanges("Outlook", vi.fn());

      expect(mq.addEventListener).not.toHaveBeenCalled();
    });

    it("invokes handler with new mode when OS preference flips and signals agreed", () => {
      installOfficeTheme(darkTheme);
      const mq = installMockMatchMedia(true);
      const handler = vi.fn();

      subscribeThemeChanges("Outlook", handler);

      mq.dispatchChange(false); // OS flips to light

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].mode).toBe("light");
    });

    it("ignores OS changes when initial signals disagreed", () => {
      installOfficeTheme(lightTheme);
      const mq = installMockMatchMedia(true); // OS dark, Outlook light → disagreement
      const handler = vi.fn();

      subscribeThemeChanges("Outlook", handler);

      mq.dispatchChange(false); // listener was never installed; no-op

      expect(handler).not.toHaveBeenCalled();
    });

    it("removeEventListener is called on unsubscribe when matchMedia was installed", () => {
      installOfficeTheme(darkTheme);
      const mq = installMockMatchMedia(true);

      const unsubscribe = subscribeThemeChanges("Outlook", vi.fn());
      unsubscribe();

      expect(mq.removeEventListener).toHaveBeenCalledTimes(1);
    });

    it("does not break when matchMedia is unavailable", () => {
      installOfficeTheme(darkTheme);
      uninstallMockMatchMedia();

      expect(() =>
        subscribeThemeChanges("Outlook", vi.fn()),
      ).not.toThrow();
    });
  });

  describe("non-Outlook hosts", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    beforeEach(() => {
      debugSpy.mockClear();
    });

    afterEach(() => {
      // Ensure no mailbox stub leaked in from another test.
      uninstallMockMailbox();
    });

    it("returns a no-op unsubscribe and does not touch Office for Excel", () => {
      const handler = vi.fn();

      const unsubscribe = subscribeThemeChanges("Excel", handler);

      expect(typeof unsubscribe).toBe("function");
      expect(debugSpy).toHaveBeenCalledTimes(1);

      // Unsubscribe should be safe even without any registered handler.
      expect(() => unsubscribe()).not.toThrow();
      expect(handler).not.toHaveBeenCalled();
    });

    it("returns a no-op for null host", () => {
      const unsubscribe = subscribeThemeChanges(null, vi.fn());

      expect(typeof unsubscribe).toBe("function");
      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(() => unsubscribe()).not.toThrow();
    });
  });
});
