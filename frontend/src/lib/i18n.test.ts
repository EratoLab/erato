import { detect, fromNavigator } from "@lingui/detect-locale";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  detectLocale,
  getValidLocale,
  supportedLocales,
  defaultLocale,
} from "./i18n";

// Mock the @lingui/detect-locale module
vi.mock("@lingui/detect-locale", () => ({
  detect: vi.fn(),
  fromNavigator: vi.fn(),
}));

// Type the mocked functions
const mockedDetect = detect as ReturnType<typeof vi.fn>;
const mockedFromNavigator = fromNavigator as ReturnType<typeof vi.fn>;

describe("i18n Locale Detection (No Persistence)", () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Mock fromNavigator to return detector function
    mockedFromNavigator.mockReturnValue(() => null);
  });

  describe("getValidLocale", () => {
    it("should return supported locale when valid", () => {
      expect(getValidLocale("en")).toBe("en");
      expect(getValidLocale("de")).toBe("de");
      expect(getValidLocale("fr")).toBe("fr");
      expect(getValidLocale("pl")).toBe("pl");
      expect(getValidLocale("es")).toBe("es");
    });

    it("should return default locale for unsupported locales", () => {
      expect(getValidLocale("ja")).toBe(defaultLocale);
      expect(getValidLocale("zh")).toBe(defaultLocale);
      expect(getValidLocale("invalid")).toBe(defaultLocale);
    });

    it("should handle empty string", () => {
      expect(getValidLocale("")).toBe(defaultLocale);
    });
  });

  describe("detectLocale", () => {
    it("should detect locale from browser navigator when available", () => {
      // Mock detect to return German from navigator
      mockedDetect.mockReturnValue("de");

      const result = detectLocale();

      expect(result).toBe("de");
      expect(detect).toHaveBeenCalledWith(
        expect.any(Function), // fromNavigator()
        expect.any(Function), // fallback function
      );
    });

    it("should fall back to default locale when navigator detection fails", () => {
      // Mock detect to return null (no locale detected)
      mockedDetect.mockReturnValue(null);

      const result = detectLocale();

      expect(result).toBe(defaultLocale);
      expect(detect).toHaveBeenCalled();
    });

    it("should validate detected locale against supported locales", () => {
      // Mock detect to return unsupported locale
      mockedDetect.mockReturnValue("ja"); // Japanese not in supportedLocales

      const result = detectLocale();

      expect(result).toBe(defaultLocale); // Should fall back to default
    });

    it("should handle case-insensitive locale codes", () => {
      // Mock detect to return uppercase locale
      mockedDetect.mockReturnValue("DE");

      const result = detectLocale();

      expect(result).toBe(defaultLocale); // Should fall back since "DE" !== "de"
    });

    it("should not use localStorage for detection", () => {
      mockedDetect.mockReturnValue("en");

      detectLocale();

      // Verify that detect was called with only navigator and fallback (no localStorage)
      expect(detect).toHaveBeenCalledTimes(1);
      const [navigatorDetector, fallbackDetector] = mockedDetect.mock.calls[0];

      // Should only have 2 arguments (navigator + fallback), not 3 (no localStorage)
      expect(mockedDetect.mock.calls[0]).toHaveLength(2);
      expect(typeof navigatorDetector).toBe("function");
      expect(typeof fallbackDetector).toBe("function");
    });
  });

  describe("Locale Detection Integration", () => {
    it("should use correct detection strategies in order", () => {
      mockedDetect.mockReturnValue("en");

      detectLocale();

      // Verify that detect was called
      expect(detect).toHaveBeenCalledTimes(1);

      // Verify that only fromNavigator was called (no localStorage)
      expect(fromNavigator).toHaveBeenCalledWith();
    });
  });

  describe("Browser Locale Simulation", () => {
    it("should handle common browser language scenarios", () => {
      const testScenarios = [
        { detected: "en", expected: "en", _description: "English browser" },
        { detected: "de", expected: "de", _description: "German browser" },
        { detected: "fr", expected: "fr", _description: "French browser" },
        { detected: "pl", expected: "pl", _description: "Polish browser" },
        { detected: "es", expected: "es", _description: "Spanish browser" },
        {
          detected: "en-US",
          expected: defaultLocale,
          _description: "Regional locale (not supported)",
        },
        {
          detected: "zh-CN",
          expected: defaultLocale,
          _description: "Unsupported language",
        },
        {
          detected: null,
          expected: defaultLocale,
          _description: "No detection possible",
        },
      ];

      testScenarios.forEach(({ detected, expected, _description }) => {
        // Clear previous mock calls
        vi.clearAllMocks();

        // Re-setup the detector function mocks
        mockedFromNavigator.mockReturnValue(() => null);

        // Mock the detection result
        mockedDetect.mockReturnValue(detected);

        const result = detectLocale();

        expect(result).toBe(expected);
      });
    });
  });

  describe("Session-Only Behavior", () => {
    it("should not persist locale detection results", () => {
      mockedDetect.mockReturnValue("de");

      detectLocale();

      // Verify no localStorage interaction
      // Since we're not mocking localStorage, any usage would throw or be visible in test output
      expect(detect).toHaveBeenCalledWith(
        expect.any(Function), // fromNavigator only
        expect.any(Function), // fallback only
      );
    });
  });
});

// Additional test to verify the module exports are correct
describe("i18n Module Exports", () => {
  it("should export expected constants", () => {
    expect(defaultLocale).toBe("en");
    expect(supportedLocales).toEqual(["en", "de", "fr", "pl", "es"]);
  });

  it("should export detection function", () => {
    expect(typeof detectLocale).toBe("function");
  });
});
