import { t } from "@lingui/core/macro";

const EXCERPT_MAX_CODE_POINTS = 60;

/**
 * The start of a selection for a chip label, on one line. Cut by code points,
 * so a cut never splits a surrogate pair into a replacement glyph.
 */
export function selectionExcerpt(
  text: string,
  max = EXCERPT_MAX_CODE_POINTS,
): string {
  const line = text.replace(/\s+/g, " ").trim();
  const characters = Array.from(line);
  return characters.length > max
    ? `${characters.slice(0, max).join("").trimEnd()}…`
    : line;
}

/** An excerpt in the locale's quotation marks. */
export function quotedSelection(excerpt: string): string {
  return t({ id: "officeAddin.selection.quoted", message: `“${excerpt}”` });
}
