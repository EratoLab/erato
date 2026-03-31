/**
 * Escapes HTML-meaningful characters so plain text can be safely embedded
 * in an HTML document without being interpreted as markup.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Converts plain text to HTML by escaping special characters and replacing
 * newlines with `<br>` tags. Use this when inserting plain text content
 * into an HTML-format Outlook compose body so that line breaks are preserved.
 */
export function plainTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>\n");
}
