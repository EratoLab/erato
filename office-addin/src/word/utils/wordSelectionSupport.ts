import { wordHostPlatform } from "./wordHostPlatform";

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
  /** Word for the web's bold and italic setters also write bCs and iCs (PF8). */
  twinsFollowLatin: boolean;
  /** Document.changeTrackingMode can be read. */
  trackingMode: boolean;
  /**
   * Word for the web counts an inline picture before the span differently in prefix offsets
   * (SV2:55-56). A host that is not known to be desktop is treated the same way.
   */
  picturesShiftOffsets: boolean;
  /**
   * Reading or selecting an expandTo range inside a paragraph leaves the document unchanged, as
   * measured on Mac and PC. Word for the web rewrites the runs it covers (preflight impact 1), so
   * there a passage inside a paragraph is found by Word's search alone.
   */
  prefixRanges: boolean;
  /** The longest text Word's search is asked for: desktop throws from 300 characters (PF5). */
  searchMaxCharacters: number;
  reason: "host_unsupported" | null;
}

/** PF8 checked these on Mac, PC and web. The LTSC limits (2021: WordApi 1.3; 2024: WordApiDesktop 1.1)
 * come from Microsoft's requirement-set tables and were never measured. */
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
    prefixRanges: desktop,
    // Desktop's search fails above about 255-300 characters. The web's returned the right hits up
    // to 4,000 (block 3 webSearchProbe), but a write or select of a hit over 255 characters is not
    // measured there, so its longer parts stay context only.
    searchMaxCharacters: 255,
    reason: canRewrite ? null : "host_unsupported",
  };
}

export function currentWordSelectionSupport(): WordSelectionSupport {
  const requirements = globalThis.Office?.context?.requirements;
  return wordSelectionSupport(
    (name, version) => requirements?.isSetSupported(name, version) ?? false,
    wordHostPlatform(),
  );
}
