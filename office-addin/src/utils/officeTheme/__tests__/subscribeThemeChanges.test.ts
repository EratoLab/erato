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

function installOfficeTheme(theme: OfficeThemeLike) {
  (Office.context as unknown as Record<string, unknown>).officeTheme = theme;
}

function uninstallOfficeTheme() {
  delete (Office.context as unknown as Record<string, unknown>).officeTheme;
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
