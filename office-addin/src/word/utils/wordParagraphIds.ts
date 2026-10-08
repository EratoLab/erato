/** Word's paragraph ID, or null where it has none: single-purchase Office and disabled Connected
 * Experiences return null while isSetSupported still reports WordApi 1.6. */
export function wordParagraphId(raw: string | null | undefined): string | null {
  if (
    typeof window !== "undefined" &&
    window.WORD_FORCE_NO_PARAGRAPH_IDS === true
  )
    return null;
  return raw || null;
}

let missing = false;

/** Each capture records whether every paragraph had an ID; in-place writing needs them all. */
export function noteWordParagraphIds(ids: readonly (string | null)[]): void {
  missing = ids.some((id) => id === null);
}

export function wordParagraphIdsMissing(): boolean {
  return missing;
}
