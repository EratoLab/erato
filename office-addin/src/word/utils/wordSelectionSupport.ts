import type { WordHostPlatform } from "./wordHostPlatform";

/** `Office.context.requirements.isSetSupported`, passed in so the table needs no Office host. */
export type WordRequirementCheck = (
  name: string,
  minVersion?: string,
) => boolean;

export interface WordSelectionSupport {
  /**
   * The identity text and the tracking mode can both be read, on a host the native probes measured;
   * otherwise every selection is context only.
   */
  canRewrite: boolean;
  /**
   * Where the paragraph style's font is read from: getStyles on desktop, else the OOXML styles part
   * looked up by styleBuiltIn or w:name. Word for the web has getStyles but its Style.font reads null.
   */
  styleFontSource: "api" | "ooxml" | null;
  /** The complex-script font twins can be set, so complex-script formatting can be kept. */
  bidiSetters: boolean;
  /** Word for the web's bold and italic setters also write bCs and iCs (P8). */
  twinsFollowLatin: boolean;
  /** Document.changeTrackingMode can be read. */
  trackingMode: boolean;
  /**
   * Word for the web counts an inline picture before the span differently in prefix offsets
   * (SV2:55-56). A host that is not known to be desktop is treated the same way.
   */
  picturesShiftOffsets: boolean;
  reason: "host_unsupported" | null;
}

/** P8 checks these on real hosts; LTSC 2021 stops at WordApi 1.3 and LTSC 2024 has WordApiDesktop 1.1. */
export const WORD_SELECTION_REQUIREMENTS = {
  /** Paragraph.getText(options). */
  identityText: ["WordApi", "1.7"],
  /** Document.changeTrackingMode. */
  trackingMode: ["WordApi", "1.4"],
  /** Document.getStyles and Style.font; Style.font only returns values on desktop. */
  styleFontApi: ["WordApi", "1.5"],
  /** Range.getOoxml, the style fallback. */
  ooxml: ["WordApi", "1.1"],
  /** boldBidirectional, italicBidirectional, sizeBidirectional and nameBidirectional. */
  bidiSetters: ["WordApiDesktop", "1.3"],
} as const satisfies Record<string, readonly [string, string]>;

export function wordSelectionSupport(
  isSetSupported: WordRequirementCheck,
  platform: WordHostPlatform,
): WordSelectionSupport {
  const has = ([name, version]: readonly [string, string]) => {
    try {
      return isSetSupported(name, version) === true;
    } catch {
      return false;
    }
  };
  const desktop = platform === "PC" || platform === "Mac";
  const trackingMode = has(WORD_SELECTION_REQUIREMENTS.trackingMode);
  // Replace formatting, select events and undo grouping were only measured on these hosts.
  const canRewrite =
    (desktop || platform === "OfficeOnline") &&
    trackingMode &&
    has(WORD_SELECTION_REQUIREMENTS.identityText);
  return {
    canRewrite,
    styleFontSource:
      desktop && has(WORD_SELECTION_REQUIREMENTS.styleFontApi)
        ? "api"
        : has(WORD_SELECTION_REQUIREMENTS.ooxml)
          ? "ooxml"
          : null,
    bidiSetters: has(WORD_SELECTION_REQUIREMENTS.bidiSetters),
    twinsFollowLatin: platform === "OfficeOnline",
    trackingMode,
    picturesShiftOffsets: !desktop,
    reason: canRewrite ? null : "host_unsupported",
  };
}
