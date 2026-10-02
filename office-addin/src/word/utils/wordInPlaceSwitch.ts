import { supportsWordDocumentPackage } from "./wordDocumentPackage";
import {
  wordInPlaceCapabilities,
  wordTrackedInPlaceCapabilities,
} from "./wordInPlaceCapabilities";

import type { WordInPlaceCapabilities } from "./wordInPlaceCapabilities";

export type WordInPlaceUnavailable =
  | "disabled"
  | "setting"
  | "latched"
  | "host-sets"
  | "no-package";
export type WordInPlaceAvailability =
  | { enabled: true }
  | { enabled: false; reason: WordInPlaceUnavailable };
/** Why the session stopped writing in place: Word wrote something unexpected, stopped mid-batch,
 * or failed a read only the in-place route makes. */
export type WordInPlaceLatchCode =
  | "verify-mismatch"
  | "interrupted"
  | "host-error";

let latch: WordInPlaceLatchCode | undefined;

/** Per-device Compatibility mode: every rewrite takes the full-document import. */
export const WORD_COMPATIBILITY_MODE_KEY = "erato.word.forceImportApply";

/** Storage can throw (blocked site data, private windows); unreadable means off. */
export function readWordCompatibilityMode(): boolean {
  try {
    return localStorage.getItem(WORD_COMPATIBILITY_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeWordCompatibilityMode(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(WORD_COMPATIBILITY_MODE_KEY, "1");
    else localStorage.removeItem(WORD_COMPATIBILITY_MODE_KEY);
  } catch {
    // Unstored means off; the settings checkbox reads storage back.
  }
}

/** In-place writing needs the exact .docx backup (package support) and stable paragraph IDs (WordApi 1.6). */
export function wordInPlaceAvailability(): WordInPlaceAvailability {
  if (typeof window !== "undefined" && window.WORD_FORCE_IMPORT_APPLY === true)
    return { enabled: false, reason: "disabled" };
  if (readWordCompatibilityMode()) return { enabled: false, reason: "setting" };
  if (latch) return { enabled: false, reason: "latched" };
  if (
    !globalThis.Office?.context?.requirements?.isSetSupported?.(
      "WordApi",
      "1.6",
    )
  )
    return { enabled: false, reason: "host-sets" };
  if (!supportsWordDocumentPackage())
    return { enabled: false, reason: "no-package" };
  return { enabled: true };
}

/** Track Changes on means writing through the object model under the user's own mode, as native
 * revisions; the import cannot produce them. */
export function wordTrackedWritingAvailable(): boolean {
  return wordInPlaceAvailability().enabled && wordInPlaceCapabilities().tracked;
}

/** The modes Word records revisions in; anything else is treated as unknown. */
export function isWordTrackingMode(mode: string | undefined): boolean {
  return mode === "TrackAll" || mode === "TrackMineOnly";
}

/** What a plan may use in place when Word is in `tracking` mode. */
export function wordInPlaceCapabilitiesUnder(
  tracking: string | undefined,
): WordInPlaceCapabilities {
  const caps = wordInPlaceCapabilities();
  return isWordTrackingMode(tracking)
    ? wordTrackedInPlaceCapabilities(caps)
    : caps;
}

/** Lasts until the pane reloads; earlier in-place writes can still be reverted in place. */
export function latchWordInPlace(code: WordInPlaceLatchCode): void {
  latch ??= code;
}

export function wordInPlaceLatch(): WordInPlaceLatchCode | undefined {
  return latch;
}

export function resetWordInPlaceLatchForTests(): void {
  latch = undefined;
}
