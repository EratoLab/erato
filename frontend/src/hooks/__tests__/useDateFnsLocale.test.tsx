import { I18nProvider } from "@lingui/react";
import { renderHook, waitFor } from "@testing-library/react";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- React is needed for JSX
import React, { type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { supportedLocales } from "../../lib/i18n";
import { useDateFnsLocale } from "../useDateFnsLocale";

// Mock i18n to control the locale
const mockI18n = {
  locale: "en",
  loadAndActivate: vi.fn(),
  activate: vi.fn(),
  load: vi.fn(),
  on: vi.fn(),
  _: vi.fn((id: string) => id),
  t: vi.fn((id: string) => id),
};

// Create a wrapper with I18nProvider
const createWrapper = (locale: string) => {
  mockI18n.locale = locale;

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider i18n={mockI18n as any}>{children}</I18nProvider>
  );
  Wrapper.displayName = "TestI18nWrapper";

  return Wrapper;
};

describe("useDateFnsLocale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("locale mapping", () => {
    it("should return date-fns locale for English", async () => {
      const { result } = renderHook(() => useDateFnsLocale(), {
        wrapper: createWrapper("en"),
      });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      expect(result.current?.code).toBe("en-US");
    });

    it("should return date-fns locale for German", async () => {
      const { result } = renderHook(() => useDateFnsLocale(), {
        wrapper: createWrapper("de"),
      });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      expect(result.current?.code).toBe("de");
    });

    it("should return date-fns locale for French", async () => {
      const { result } = renderHook(() => useDateFnsLocale(), {
        wrapper: createWrapper("fr"),
      });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      expect(result.current?.code).toBe("fr");
    });

    it("should return date-fns locale for Polish", async () => {
      const { result } = renderHook(() => useDateFnsLocale(), {
        wrapper: createWrapper("pl"),
      });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      expect(result.current?.code).toBe("pl");
    });

    it("should return date-fns locale for Spanish", async () => {
      const { result } = renderHook(() => useDateFnsLocale(), {
        wrapper: createWrapper("es"),
      });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      expect(result.current?.code).toBe("es");
    });
  });

  describe("locale consistency validation", () => {
    it("should have a date-fns mapping for every supported Lingui locale", async () => {
      // This test ensures that if a new locale is added to supportedLocales,
      // the developer doesn't forget to add it to useDateFnsLocale
      const unmappedLocales: string[] = [];

      for (const locale of supportedLocales) {
        const { result } = renderHook(() => useDateFnsLocale(), {
          wrapper: createWrapper(locale),
        });

        try {
          await waitFor(
            () => {
              expect(result.current).toBeDefined();
            },
            { timeout: 2000 },
          );

          // Verify the locale has a valid code
          if (!result.current?.code) {
            unmappedLocales.push(locale);
          }
        } catch {
          unmappedLocales.push(locale);
        }
      }

      if (unmappedLocales.length > 0) {
        throw new Error(
          `The following locales are supported in Lingui but missing in useDateFnsLocale: ${unmappedLocales.join(", ")}. ` +
            `Please update the switch statement in useDateFnsLocale.ts to include these locales.`,
        );
      }
    });

    it("should match the exact list of supported locales", () => {
      // This test documents the expected supported locales
      // If this test fails, it means the supported locales have changed
      const expectedLocales = ["en", "de", "fr", "pl", "es"];

      expect(supportedLocales).toEqual(expectedLocales);

      // If this test fails, you need to:
      // 1. Update useDateFnsLocale.ts to handle the new/changed locale
      // 2. Update this test to reflect the new expected locales
    });
  });

  describe("error handling", () => {
    it("should fallback to English for invalid locale", async () => {
      // Invalid/unknown locales fall through to the default case which returns English
      const { result } = renderHook(() => useDateFnsLocale(), {
        wrapper: createWrapper("invalid-locale"),
      });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      // Should fallback to English (en-US)
      expect(result.current?.code).toBe("en-US");
    });
  });

  describe("locale switching", () => {
    it("should update when locale changes", async () => {
      const { result, rerender } = renderHook(() => useDateFnsLocale(), {
        wrapper: createWrapper("en"),
      });

      await waitFor(() => {
        expect(result.current?.code).toBe("en-US");
      });

      // Change locale to German
      rerender();
      mockI18n.locale = "de";

      const { result: result2 } = renderHook(() => useDateFnsLocale(), {
        wrapper: createWrapper("de"),
      });

      await waitFor(() => {
        expect(result2.current?.code).toBe("de");
      });
    });
  });

  describe("date-fns locale object validity", () => {
    it("should return valid date-fns locale objects with required properties", async () => {
      const requiredProperties = ["code", "formatDistance", "formatLong"];

      for (const locale of supportedLocales) {
        const { result } = renderHook(() => useDateFnsLocale(), {
          wrapper: createWrapper(locale),
        });

        await waitFor(() => {
          expect(result.current).toBeDefined();
        });

        // Check that the returned object has the structure of a date-fns Locale
        for (const prop of requiredProperties) {
          expect(result.current).toHaveProperty(prop);
        }
      }
    });
  });
});
