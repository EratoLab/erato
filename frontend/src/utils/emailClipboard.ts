import { sanitizeHtmlPreview } from "./sanitizeHtmlPreview";

const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE"]);

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TR",
  "UL",
]);

/**
 * Converts an HTML fragment to readable plain text. Unlike bare
 * `textContent` (which fuses `<p>Hi</p><p>Bye</p>` into "HiBye"), this emits
 * newlines at `<br>` and block-element boundaries and skips style/script
 * content.
 */
export function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    const tag = (node as Element).tagName;
    if (SKIPPED_TAGS.has(tag)) {
      return;
    }
    if (tag === "BR") {
      parts.push("\n");
      return;
    }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) {
      parts.push("\n");
    }
    node.childNodes.forEach(visit);
    if (isBlock) {
      parts.push("\n");
    }
  };
  doc.body.childNodes.forEach(visit);
  return parts
    .join("")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Copies an email draft to the clipboard. HTML drafts are written as
 * text/html — sanitized the same way as the on-screen preview, so the
 * clipboard carries exactly what the user approved — plus a plain-text
 * flavor for targets that only accept text/plain.
 */
export async function copyEmailToClipboard(
  content: string,
  isHtml: boolean,
): Promise<void> {
  if (!isHtml) {
    await navigator.clipboard.writeText(content);
    return;
  }
  const plainText = htmlToPlainText(content);
  if (typeof ClipboardItem === "undefined") {
    // Firefox < 127 and older webviews: best effort, plain text only.
    await navigator.clipboard.writeText(plainText);
    return;
  }
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([sanitizeHtmlPreview(content)], {
        type: "text/html",
      }),
      "text/plain": new Blob([plainText], { type: "text/plain" }),
    }),
  ]);
}
