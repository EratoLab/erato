import { i18n } from "@lingui/core";
import { describe, it, expect, afterEach } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { useOptionalTranslation } from "../useOptionalTranslation";

import type { Messages } from "@lingui/core";

describe("useOptionalTranslation", () => {
  afterEach(() => {
    // Restore original English messages after each test
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("should return the translation when it exists", () => {
    // Add a test translation by loading messages with the new key
    i18n.load("en", {
      ...(enMessages as unknown as Messages),
      "test.tooltip.exists": "This is a tooltip",
    });
    i18n.activate("en");

    const result = useOptionalTranslation("test.tooltip.exists");

    expect(result).toBe("This is a tooltip");
  });

  it("should return null when translation does not exist", () => {
    // Ensure the key doesn't exist
    const result = useOptionalTranslation("test.tooltip.nonexistent.key.xyz");

    expect(result).toBeNull();
  });

  it("should return null when translation is empty string", () => {
    // Add an empty translation
    i18n.load("en", {
      ...(enMessages as unknown as Messages),
      "test.tooltip.empty": "",
    });
    i18n.activate("en");

    const result = useOptionalTranslation("test.tooltip.empty");

    expect(result).toBeNull();
  });

  it("should return null when translation is only whitespace", () => {
    // Add a whitespace-only translation
    i18n.load("en", {
      ...(enMessages as unknown as Messages),
      "test.tooltip.whitespace": "   ",
    });
    i18n.activate("en");

    const result = useOptionalTranslation("test.tooltip.whitespace");

    expect(result).toBeNull();
  });

  it("should return the translation with special characters", () => {
    // Add a translation with special characters
    i18n.load("en", {
      ...(enMessages as unknown as Messages),
      "test.tooltip.special": "Click here for more info! <Learn more>",
    });
    i18n.activate("en");

    const result = useOptionalTranslation("test.tooltip.special");

    expect(result).toBe("Click here for more info! <Learn more>");
  });

  it("should handle translations with newlines", () => {
    // Add a translation with newlines
    i18n.load("en", {
      ...(enMessages as unknown as Messages),
      "test.tooltip.multiline": "Line 1\nLine 2",
    });
    i18n.activate("en");

    const result = useOptionalTranslation("test.tooltip.multiline");

    expect(result).toBe("Line 1\nLine 2");
  });
});
