import { describe, expect, it } from "vitest";

import { wordSelectionSupport } from "../wordSelectionSupport";

import type { WordRequirementCheck } from "../wordSelectionSupport";

/** isSetSupported for a host reporting these highest versions. */
const host =
  (levels: Record<string, string>): WordRequirementCheck =>
  (name, minVersion = "1.1") => {
    const have = levels[name]?.split(".").map(Number);
    const need = minVersion.split(".").map(Number);
    return (
      !!have &&
      (have[0] > need[0] || (have[0] === need[0] && have[1] >= need[1]))
    );
  };

describe("wordSelectionSupport", () => {
  it.each(["Mac", "PC"] as const)(
    "rewrites with complex-script setters on Microsoft 365 for %s",
    (platform) => {
      expect(
        wordSelectionSupport(
          host({ WordApi: "1.9", WordApiDesktop: "1.5" }),
          platform,
        ),
      ).toEqual({
        canRewrite: true,
        styleFontSource: "api",
        bidiSetters: true,
        twinsFollowLatin: false,
        trackingMode: true,
        picturesShiftOffsets: false,
        prefixRanges: true,
        searchMaxCharacters: 255,
        keepsItems: true,
        keptItemParagraphs: null,
        reason: null,
      });
    },
  );

  it("rewrites without complex-script setters on the web, where pictures shift offsets and styles come from OOXML", () => {
    expect(
      wordSelectionSupport(host({ WordApi: "1.11" }), "OfficeOnline"),
    ).toEqual({
      canRewrite: true,
      styleFontSource: "ooxml",
      bidiSetters: false,
      twinsFollowLatin: true,
      trackingMode: true,
      picturesShiftOffsets: true,
      prefixRanges: false,
      searchMaxCharacters: 255,
      keepsItems: true,
      keptItemParagraphs: 5,
      reason: null,
    });
  });

  it("rewrites without complex-script setters on LTSC 2024", () => {
    expect(
      wordSelectionSupport(
        host({ WordApi: "1.8", WordApiDesktop: "1.1" }),
        "PC",
      ),
    ).toMatchObject({
      canRewrite: true,
      styleFontSource: "api",
      bidiSetters: false,
      reason: null,
    });
  });

  it("cannot rewrite on LTSC 2021, which has no identity text or tracking mode", () => {
    expect(wordSelectionSupport(host({ WordApi: "1.3" }), "PC")).toEqual({
      canRewrite: false,
      styleFontSource: "ooxml",
      bidiSetters: false,
      twinsFollowLatin: false,
      trackingMode: false,
      picturesShiftOffsets: false,
      prefixRanges: true,
      searchMaxCharacters: 255,
      keepsItems: false,
      keptItemParagraphs: null,
      reason: "host_unsupported",
    });
  });

  it("reports no tracking mode without WordApi 1.4 and then refuses to rewrite", () => {
    const support = wordSelectionSupport(
      (name, version) =>
        name === "WordApi" && version !== "1.4" && version !== "1.5",
      "Mac",
    );
    expect(support).toMatchObject({
      trackingMode: false,
      canRewrite: false,
      styleFontSource: "ooxml",
      reason: "host_unsupported",
    });
  });

  it("falls back to the OOXML styles part without getStyles", () => {
    expect(
      wordSelectionSupport(
        (name, version) => name === "WordApi" && version !== "1.5",
        "Mac",
      ).styleFontSource,
    ).toBe("ooxml");
  });

  it("treats a throwing requirement check as unsupported", () => {
    expect(
      wordSelectionSupport(() => {
        throw new Error("no requirements");
      }, "Mac"),
    ).toMatchObject({
      canRewrite: false,
      styleFontSource: null,
      bidiSetters: false,
      reason: "host_unsupported",
    });
  });

  it("treats an unknown platform like the web but never rewrites there, since no probe measured it", () => {
    expect(
      wordSelectionSupport(host({ WordApi: "1.9" }), "unknown"),
    ).toMatchObject({
      canRewrite: false,
      reason: "host_unsupported",
      picturesShiftOffsets: true,
      prefixRanges: false,
      styleFontSource: "ooxml",
      twinsFollowLatin: false,
    });
  });
});
