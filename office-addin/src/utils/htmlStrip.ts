/**
 * Strips HTML tags from a string, returning plain text.
 * Uses the browser's DOMParser for correct handling of entities and nesting.
 * Falls back to regex stripping if DOMParser is unavailable.
 */
export function stripHtmlTags(html: string): string {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent ?? "";
  }

  // Fallback: simple regex strip for environments without DOMParser
  return html.replace(/<[^>]*>/g, "");
}
