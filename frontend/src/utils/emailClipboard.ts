import { mapOutsideCodeFences } from "./codeFences";
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
 * Marks the boundary between two cells of a row while the tree is walked. A
 * literal " | " cannot be pushed there: markup around the boundary — layout
 * whitespace, a block element inside the cell — still contributes newlines that
 * would tear the row apart again, so the separator is resolved only once the
 * whole text is assembled. The parser turns any NUL in the source into U+FFFD,
 * so the marker cannot collide with document text.
 */
const CELL_BREAK = "\u0000";
const CELL_BREAK_RUN = new RegExp(`[ \\t\\n]*${CELL_BREAK}[ \\t\\n]*`, "g");

/**
 * Converts an HTML fragment to readable plain text. Unlike bare
 * `textContent` (which fuses `<p>Hi</p><p>Bye</p>` into "HiBye"), this emits
 * newlines at `<br>` and block-element boundaries, separates table cells and
 * skips style/script content.
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
    if (tag === "TD" || tag === "TH") {
      if (isCell((node as Element).previousElementSibling)) {
        parts.push(CELL_BREAK);
      }
      node.childNodes.forEach(visit);
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
  const text = parts.join("").replace(CELL_BREAK_RUN, " | ");
  return mapOutsideCodeFences(text, (segment) =>
    segment.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

function isCell(element: Element | null): boolean {
  return element?.tagName === "TD" || element?.tagName === "TH";
}

const EMAIL_FENCE_RE =
  /^[ \t]*```erato-email(-html)?[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;

/**
 * Rewrites canonical erato-email fences in a raw message to the draft text
 * the user sees rendered (the card shows the draft, not fence markers), for
 * message-level copy. Drifted tags are left untouched — classifying them
 * needs the facet context that copy handlers don't have.
 */
export function transformEmailFencesForCopy(text: string): string {
  return text.replace(EMAIL_FENCE_RE, (_match, htmlSuffix, body: string) =>
    htmlSuffix ? htmlToPlainText(body) : body.replace(/\r?\n$/, ""),
  );
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
