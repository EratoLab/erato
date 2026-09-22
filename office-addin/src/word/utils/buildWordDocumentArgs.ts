/**
 * Pure rendering of a Word document read into the `word_document_review` facet
 * arguments. No Office.js, no React — the byte budget and the ordinal spelling
 * are the risky parts, so they live where they can be unit-tested directly.
 *
 * The argument names and the ordinal spelling are normative in ERMAIN-820; the
 * add-in emits exactly that set.
 */

import type { WordAuthoringSnapshot } from "./wordDocumentPlan";

/** One paragraph as `readWordDocument` returns it. */
export interface WordParagraphRead {
  /** 1-based, dense, in document order, across EVERY paragraph. */
  ordinal: number;
  /** `Paragraph.getText()` — hidden and deleted text already excluded. */
  text: string;
  uniqueLocalId: string;
  /** `Paragraph.styleBuiltIn`; "Other" for anything not built-in. */
  styleBuiltIn: string;
  /** `Paragraph.outlineLevel`; Word uses 10 for body text, 1..9 for headings. */
  outlineLevel: number;
}

/**
 * The model-facing half of the facet args. Values are strings because
 * `ActionFacetRequest.args` is `Record<string, string>`, and none of them is
 * localized: they are prompt content, not UI copy.
 */
export interface WordDocumentArgs {
  document_text: string;
  heading_outline: string;
  paragraphs_sent: string;
  paragraphs_total: string;
  truncation_note: string;
}

/** Everything the chip needs to describe what the send actually carried. */
export interface WordDocumentCoverage {
  paragraphsSent: number;
  paragraphsTotal: number;
  /** The window stopped short of the end of the document. */
  truncated: boolean;
  /** The window's last paragraph is itself cut (the degenerate case). */
  partialParagraph: boolean;
  /** At least one paragraph has text. */
  hasContent: boolean;
}

export interface WordDocumentBuild {
  authoring?: WordAuthoringSnapshot;
  args: WordDocumentArgs;
  coverage: WordDocumentCoverage;
  /** Ordinal → id and send-time text, for EVERY paragraph. ERMAIN-822's input. */
  ordinalMap: Map<number, { uniqueLocalId: string; text: string }>;
  /**
   * The ordinals whose text was rendered into `document_text` IN FULL — the
   * set the model demonstrably read, and the only set the write path may edit.
   *
   * It is NOT `1..paragraphsSent`: an empty paragraph keeps its ordinal and
   * contributes no line, and the degenerate single-oversized-paragraph case
   * renders one ordinal only in part. Both are inside the window and neither
   * may be rewritten from a text the model never saw in full.
   */
  renderedOrdinals: ReadonlySet<number>;
  /**
   * The one ordinal rendered only in part, or null. Carried separately from
   * `renderedOrdinals` so the write path can say *why* it refuses, instead of
   * reporting a paragraph the model did read half of as never sent.
   */
  partialOrdinal: number | null;
}

/**
 * 60 KB against the live 64 KB per-argument cap (`ACTION_FACET_ARG_MAX_SIZE`,
 * `message_streaming.rs`). The 4 KB of headroom is deliberate: the cap is
 * enforced on Rust `String::len()`, i.e. UTF-8 bytes, and an oversized
 * argument is a hard 400 that kills the send before a chat row exists.
 */
export const DOCUMENT_TEXT_BUDGET_BYTES = 61_440;
/** Same measurement, separate argument, so both fit under the per-arg cap. */
export const HEADING_OUTLINE_BUDGET_BYTES = 8_192;

const encoder = new TextEncoder();

const utf8Length = (value: string) => encoder.encode(value).length;

const HEADING_STYLE_LEVELS = new Map<string, number>([
  // Word has no level "0" and the template spells levels as H<level>, so the
  // document title shares the top level with Heading1. A document carries one
  // Title at most, so the collision costs no addressing precision.
  ["Title", 1],
  ["Heading1", 1],
  ["Heading2", 2],
  ["Heading3", 3],
  ["Heading4", 4],
  ["Heading5", 5],
  ["Heading6", 6],
  ["Heading7", 7],
  ["Heading8", 8],
  ["Heading9", 9],
]);

/**
 * The heading level to tag a paragraph with, or null for body text.
 *
 * `styleBuiltIn` is the portable signal and wins. `outlineLevel` is only a
 * fallback, and only inside 1..9: Word reports **10** for body text, so a
 * naive truthiness check would tag every ordinary paragraph as a heading.
 */
export function resolveHeadingLevel(
  paragraph: Pick<WordParagraphRead, "styleBuiltIn" | "outlineLevel">,
): number | null {
  const fromStyle = HEADING_STYLE_LEVELS.get(paragraph.styleBuiltIn);
  if (fromStyle !== undefined) return fromStyle;
  const level = paragraph.outlineLevel;
  return Number.isInteger(level) && level >= 1 && level <= 9 ? level : null;
}

/**
 * One ordinal must render as exactly one line. A manual line break
 * (Shift+Enter) stays inside a paragraph, and Word emits a vertical tab
 * (U+000B) for it; `\r` and `\n` are normalized too so the rendering holds
 * whichever character the host actually returns.
 */
export function normalizeParagraphText(text: string): string {
  return text.replace(/[\r\n\u000B]+/g, " ").trim();
}

const renderPrefix = (paragraph: WordParagraphRead) => {
  const level = resolveHeadingLevel(paragraph);
  return level === null
    ? `[${paragraph.ordinal}] `
    : `[${paragraph.ordinal}|H${level}] `;
};

/**
 * The longest prefix of `value` that encodes to at most `maxBytes`, cut on a
 * code-point boundary. Walks code points and adds their UTF-8 width rather
 * than re-encoding, so a lone surrogate can never be produced and a 100 KB
 * paragraph costs one pass.
 */
export function cutToUtf8Bytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  let used = 0;
  let end = 0;
  for (const codePoint of value) {
    const point = codePoint.codePointAt(0) ?? 0;
    const width =
      point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (used + width > maxBytes) break;
    used += width;
    end += codePoint.length;
  }
  return value.slice(0, end);
}

/**
 * Renders the ordinal-tagged head window plus the coverage counts.
 *
 * Both counts are over the SAME population — every paragraph, empty ones
 * included — so `paragraphs_sent === paragraphs_total` exactly when nothing
 * was cut. Counting only rendered lines would make any document containing a
 * blank paragraph look truncated, and ERMAIN-820's template forces a coverage
 * sentence on `paragraphs_total > paragraphs_sent`.
 */
export function buildWordDocumentArgs(
  paragraphs: readonly WordParagraphRead[],
): WordDocumentBuild {
  const ordinalMap = new Map<number, { uniqueLocalId: string; text: string }>();
  for (const paragraph of paragraphs) {
    ordinalMap.set(paragraph.ordinal, {
      uniqueLocalId: paragraph.uniqueLocalId,
      text: paragraph.text,
    });
  }

  const lines: string[] = [];
  const renderedOrdinals = new Set<number>();
  // Byte accounting is additive: each line is encoded once and the joining
  // "\n" is charged with it. Re-encoding the whole window per paragraph would
  // be quadratic on a large document.
  let usedBytes = 0;
  let consumed = 0;
  let blocked: WordParagraphRead | null = null;
  let hasContent = false;

  for (const paragraph of paragraphs) {
    const normalized = normalizeParagraphText(paragraph.text);
    if (normalized.length === 0) {
      // An empty paragraph keeps its ordinal and contributes no line, so it
      // costs no bytes and is consumed for free.
      consumed = paragraph.ordinal;
      continue;
    }
    hasContent = true;
    const line = renderPrefix(paragraph) + normalized;
    const cost = utf8Length(line) + (lines.length === 0 ? 0 : 1);
    if (usedBytes + cost > DOCUMENT_TEXT_BUDGET_BYTES) {
      blocked = paragraph;
      break;
    }
    usedBytes += cost;
    lines.push(line);
    renderedOrdinals.add(paragraph.ordinal);
    consumed = paragraph.ordinal;
  }

  let truncationNote = "";
  let partialOrdinal: number | null = null;
  if (blocked !== null && lines.length === 0) {
    // Degenerate case: one paragraph is larger than the entire budget, so a
    // boundary cut would send nothing at all. Cut that paragraph instead.
    // Pasted walls of text make this common enough to define explicitly.
    const prefix = renderPrefix(blocked);
    const available = DOCUMENT_TEXT_BUDGET_BYTES - utf8Length(prefix);
    const partial = cutToUtf8Bytes(
      normalizeParagraphText(blocked.text),
      available,
    );
    if (partial.length > 0) {
      lines.push(prefix + partial);
      // Deliberately NOT added to `renderedOrdinals`: the model was shown a
      // prefix of this paragraph, so replacing the whole paragraph would
      // delete a tail it never read. `partialOrdinal` carries it instead.
      partialOrdinal = blocked.ordinal;
      consumed = blocked.ordinal;
      truncationNote = `Paragraph ${blocked.ordinal} is included only in part, because it alone exceeds the send limit.`;
    }
  }

  const documentText = lines.join("\n");
  const truncated = consumed < paragraphs.length;
  const headingOutline =
    truncated || truncationNote.length > 0
      ? buildHeadingOutline(paragraphs, consumed)
      : "";

  return {
    args: {
      document_text: documentText,
      heading_outline: headingOutline,
      paragraphs_sent: String(consumed),
      paragraphs_total: String(paragraphs.length),
      truncation_note: truncationNote,
    },
    coverage: {
      paragraphsSent: consumed,
      paragraphsTotal: paragraphs.length,
      truncated,
      partialParagraph: truncationNote.length > 0,
      hasContent,
    },
    ordinalMap,
    renderedOrdinals,
    partialOrdinal,
  };
}

/**
 * Headings that fall OUTSIDE the window, so the model can say what exists
 * beyond it without being handed a second copy of what it already has. Carries
 * its own header line, because the template places a bare placeholder and an
 * unmatched `{{key}}` is rendered literally — the value has to be
 * self-describing or empty, never a dangling fragment.
 */
function buildHeadingOutline(
  paragraphs: readonly WordParagraphRead[],
  consumed: number,
): string {
  const header = "Headings beyond the included text:";
  let used = utf8Length(header);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.ordinal <= consumed) continue;
    const level = resolveHeadingLevel(paragraph);
    if (level === null) continue;
    const normalized = normalizeParagraphText(paragraph.text);
    if (normalized.length === 0) continue;
    const line = `[${paragraph.ordinal}|H${level}] ${normalized}`;
    const cost = utf8Length(line) + 1;
    if (used + cost > HEADING_OUTLINE_BUDGET_BYTES) break;
    used += cost;
    lines.push(line);
  }
  return lines.length === 0 ? "" : [header, ...lines].join("\n");
}
