import { mapOutsideCodeFences } from "./codeFences";
import {
  EMAIL_DRAFT_PLAIN_BLOCK_TAGS,
  EMAIL_DRAFT_TAGS,
  linkTargetDisplay,
  linkTextNamesTarget,
  sanitizeHtmlPreview,
} from "./sanitizeHtmlPreview";

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
  "UL",
]);

const ROW_TAGS = new Set(["TABLE", "TR"]);

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
 * Marks a row or table boundary. A plain newline cannot stand in: the cell-break
 * run absorbs the whitespace around it, so a row whose first cell is empty — the
 * ordinary shape of a pasted cross-tab — would let the following cell reach back
 * across the boundary and weld itself onto the previous row. Resolved to a
 * newline only after the cell breaks are, so absorption can never cross it.
 */
const ROW_BREAK = "\u0001";
const ROW_BREAK_RUN = new RegExp(
  `[ \\t\\n${ROW_BREAK}]*${ROW_BREAK}[ \\t\\n${ROW_BREAK}]*`,
  "g",
);

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
    if (ROW_TAGS.has(tag)) {
      parts.push(ROW_BREAK);
      node.childNodes.forEach(visit);
      parts.push(ROW_BREAK);
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
  // Cell breaks first: they may absorb whitespace, but never a row boundary.
  const text = parts
    .join("")
    .replace(CELL_BREAK_RUN, " | ")
    .replace(ROW_BREAK_RUN, "\n");
  return mapOutsideCodeFences(text, (segment) =>
    segment.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

function isCell(element: Element | null): boolean {
  return element?.tagName === "TD" || element?.tagName === "TH";
}

const HTML_FRAGMENT_TAG_NAMES = [
  ...EMAIL_DRAFT_TAGS,
  ...EMAIL_DRAFT_PLAIN_BLOCK_TAGS,
].join("|");

// Plain business text with `<Name>`, `<mail@example.com>` or `<30` must not
// match.
const HTML_FRAGMENT_TAG_RE = new RegExp(
  `</?(?:${HTML_FRAGMENT_TAG_NAMES})(?:\\s[^<>]*)?/?>`,
  "i",
);
const STARTS_WITH_ELEMENT_RE = new RegExp(
  `^\\s*<(?:${HTML_FRAGMENT_TAG_NAMES})(?:\\s[^<>]*)?/?>`,
  "i",
);

const CHARACTER_REFERENCE_RE = /&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);/gi;

/** "R&D;" has the shape of a character reference; only a real one decodes. */
function holdsCharacterReference(content: string): boolean {
  const candidates = [
    ...new Set(content.match(CHARACTER_REFERENCE_RE) ?? []),
  ].join(" ");
  return (
    candidates !== "" &&
    new DOMParser().parseFromString(candidates, "text/html").body
      .textContent !== candidates
  );
}

/**
 * Whether an email draft block holds HTML. A body that starts with an element
 * tag is HTML whatever the context. Models drop the `-html` suffix of the
 * fence, so in an HTML fence and in any block of an email-bodied facet
 * (bodyFormat present, whatever its value) a known tag or a character
 * reference anywhere counts too.
 */
export function isEmailDraftHtml(
  content: string,
  options: { language?: string; bodyFormat?: string } = {},
): boolean {
  if (STARTS_WITH_ELEMENT_RE.test(content)) {
    return true;
  }
  const isEmailDraft =
    options.language === "erato-email-html" || !!options.bodyFormat;
  return (
    isEmailDraft &&
    (HTML_FRAGMENT_TAG_RE.test(content) || holdsCharacterReference(content))
  );
}

const QUOTE = "> ";
// A line holding nothing else is how an editor writes a blank line.
const NON_BREAKING_SPACE = String.fromCharCode(160);
const BLANK_LINE_BLOCKS = new Set(
  "P H1 H2 H3 H4 H5 H6 HR TABLE BLOCKQUOTE PRE UL OL".split(" "),
);
const LINE_BLOCKS = new Set(["DIV", "LI", "TR"]);

interface LinePrefix {
  first: string;
  rest: string;
  used: boolean;
}

/**
 * Converts an HTML email draft to the text a plain-text email can carry.
 * Cleans the draft first, so the text holds what the card shows. Drafts only:
 * other HTML keeps {@link htmlToPlainText}.
 */
export function emailDraftHtmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(
    sanitizeHtmlPreview(html),
    "text/html",
  );
  const lines: { text: string; blank: boolean; quoteDepth: number }[] = [];
  const prefixes: LinePrefix[] = [];
  let line: string | null = null;
  let pendingBlank = false;
  let listDepth = 0;
  let cellDepth = 0;
  let preDepth = 0;

  const quoteDepth = () =>
    prefixes.filter((prefix) => prefix.first === QUOTE).length;
  // A blank line between two quoted lines stays inside the quote they share.
  const pushBlank = () => {
    const last = lines.at(-1);
    if (last && !last.blank) {
      const depth = Math.min(last.quoteDepth, quoteDepth());
      const text = Array<string>(depth).fill(">").join(" ");
      lines.push({ text, blank: true, quoteDepth: depth });
    }
  };
  const endLine = () => {
    if (line !== null) {
      lines.push({ text: line, blank: false, quoteDepth: quoteDepth() });
    }
    line = null;
  };
  const append = (text: string) => {
    if (line === null) {
      if (pendingBlank) {
        pushBlank();
      }
      pendingBlank = false;
      line = prefixes.map((p) => (p.used ? p.rest : p.first)).join("");
      prefixes.forEach((prefix) => {
        prefix.used = true;
      });
    }
    line += text;
  };
  const lineBreak = (blank: boolean) => {
    if (cellDepth > 0) {
      if (line !== null && !line.endsWith(" ")) {
        line += " ";
      }
      return;
    }
    endLine();
    pendingBlank = pendingBlank || (blank && listDepth === 0);
  };
  const appendText = (raw: string) => {
    if (preDepth > 0) {
      raw.split("\n").forEach((segment, index) => {
        if (index > 0) {
          append("");
          endLine();
        }
        if (segment) {
          append(segment);
        }
      });
      return;
    }
    const text = raw.replace(/\s+/g, " ");
    if (line === null && text === " " && raw.includes(NON_BREAKING_SPACE)) {
      pushBlank();
      return;
    }
    const visible =
      line === null || line.endsWith(" ") ? text.trimStart() : text;
    if (visible) {
      append(visible);
    }
  };
  const visitChildren = (node: Node) => node.childNodes.forEach(visit);
  const withPrefix = (node: Node, first: string, rest: string) => {
    prefixes.push({ first, rest, used: false });
    visitChildren(node);
    prefixes.pop();
  };

  function visit(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent ?? "");
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      visitElement(node as Element);
    }
  }

  function visitElement(element: Element): void {
    const tag = element.tagName;
    if (tag === "BR") {
      if (cellDepth > 0) {
        lineBreak(false);
        return;
      }
      if (line === null) {
        pushBlank();
      }
      endLine();
      return;
    }
    if (tag === "A") {
      const href = element.getAttribute("href");
      const text = element.textContent ?? "";
      const target = href ? ` (${linkTargetDisplay(href)})` : "";
      visitChildren(element);
      // The cleaner has already added the target to a misleading link text.
      if (href && !linkTextNamesTarget(text, href) && !text.endsWith(target)) {
        line = line?.trimEnd() ?? null;
        append(/\s$/.test(text) ? `${target} ` : target);
      }
      return;
    }
    if (tag === "S" || tag === "DEL") {
      // Struck-through words are deleted words; text cannot show the strike.
      return;
    }
    if (tag === "SUP" && element.textContent?.trim()) {
      append("^");
    }
    if (tag === "TD" || tag === "TH") {
      if (isCell(element.previousElementSibling)) {
        append("");
        const current = line ?? "";
        line = /\S/.test(current) ? `${current.trimEnd()} | ` : `${current}| `;
      }
      cellDepth += 1;
      visitChildren(element);
      cellDepth -= 1;
      return;
    }
    const blank = BLANK_LINE_BLOCKS.has(tag);
    const isBlock = blank || LINE_BLOCKS.has(tag);
    if (isBlock) {
      lineBreak(blank);
    }
    if (tag === "UL" || tag === "OL") {
      listDepth += 1;
      let index = Number.parseInt(element.getAttribute("start") ?? "", 10);
      index = (tag === "OL" && index ? index : 1) - 1;
      element.childNodes.forEach((child) => {
        if (child.nodeName !== "LI") {
          visit(child);
          return;
        }
        index += 1;
        const marker = tag === "OL" ? `${index}. ` : "- ";
        lineBreak(false);
        withPrefix(child, marker, " ".repeat(marker.length));
        lineBreak(false);
      });
      listDepth -= 1;
    } else if (tag === "BLOCKQUOTE") {
      withPrefix(element, QUOTE, QUOTE);
    } else if (tag === "PRE") {
      preDepth += 1;
      visitChildren(element);
      preDepth -= 1;
    } else {
      visitChildren(element);
    }
    if (isBlock) {
      lineBreak(blank);
    }
  }

  visitChildren(doc.body);
  endLine();
  while (lines.at(-1)?.blank) {
    lines.pop();
  }
  return lines
    .map((entry) => entry.text.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
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
  return text.replace(
    EMAIL_FENCE_RE,
    (_match, htmlSuffix: string | undefined, body: string) =>
      isEmailDraftHtml(body, {
        language: htmlSuffix ? "erato-email-html" : "erato-email",
      })
        ? emailDraftHtmlToText(body)
        : body.replace(/\r?\n$/, ""),
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
  const plainText = emailDraftHtmlToText(content);
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
