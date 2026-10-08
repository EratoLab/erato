/** `Office.context.requirements.isSetSupported`, passed in so the table needs no Office host. */
export type WordRequirementCheck = (
  name: string,
  minVersion?: string,
) => boolean;

export type WordSelectionHostPlatform =
  | "PC"
  | "Mac"
  | "OfficeOnline"
  | "unknown";

export interface WordSelectionSupport {
  /** The identity text and the tracking mode can both be read; otherwise every selection is context only. */
  canRewrite: boolean;
  /** Where the paragraph style's font is read from: getStyles, else the paragraph's OOXML styles part. */
  styleFontSource: "api" | "ooxml" | null;
  /** The complex-script font twins can be set, so complex-script formatting can be kept. */
  bidiSetters: boolean;
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
  /** Document.getStyles and Style.font. */
  styleFontApi: ["WordApi", "1.5"],
  /** Range.getOoxml, the style fallback. */
  ooxml: ["WordApi", "1.1"],
  /** boldBidirectional, italicBidirectional, sizeBidirectional and nameBidirectional. */
  bidiSetters: ["WordApiDesktop", "1.3"],
} as const satisfies Record<string, readonly [string, string]>;

export function wordSelectionSupport(
  isSetSupported: WordRequirementCheck,
  platform: WordSelectionHostPlatform,
): WordSelectionSupport {
  const has = ([name, version]: readonly [string, string]) => {
    try {
      return isSetSupported(name, version) === true;
    } catch {
      return false;
    }
  };
  const trackingMode = has(WORD_SELECTION_REQUIREMENTS.trackingMode);
  const canRewrite =
    trackingMode && has(WORD_SELECTION_REQUIREMENTS.identityText);
  return {
    canRewrite,
    styleFontSource: has(WORD_SELECTION_REQUIREMENTS.styleFontApi)
      ? "api"
      : has(WORD_SELECTION_REQUIREMENTS.ooxml)
        ? "ooxml"
        : null,
    bidiSetters: has(WORD_SELECTION_REQUIREMENTS.bidiSetters),
    trackingMode,
    picturesShiftOffsets: platform !== "PC" && platform !== "Mac",
    reason: canRewrite ? null : "host_unsupported",
  };
}
