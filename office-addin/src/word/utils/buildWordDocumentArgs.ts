import type { WordAuthoringSnapshot } from "./wordDocumentPlan";

export interface WordParagraphRead {
  /** 1-based, dense, in document order, across EVERY paragraph. */
  ordinal: number;
  text: string;
  uniqueLocalId: string;
  styleBuiltIn: string;
  /** `Paragraph.outlineLevel`; Word uses 10 for body text, 1..9 for headings. */
  outlineLevel: number;
}

export interface WordDocumentArgs {
  document_text: string;
  heading_outline: string;
  paragraphs_sent: string;
  paragraphs_total: string;
  truncation_note: string;
}

export interface WordDocumentCoverage {
  paragraphsSent: number;
  paragraphsTotal: number;
  truncated: boolean;
  partialParagraph: boolean;
  hasContent: boolean;
}

export interface WordDocumentBuild {
  authoring?: WordAuthoringSnapshot;
  args: WordDocumentArgs;
  coverage: WordDocumentCoverage;
  ordinalMap: Map<number, { uniqueLocalId: string; text: string }>;
  /** Only rendered, complete paragraphs are writable; the capture also contains blank or omitted paragraphs. */
  renderedOrdinals: ReadonlySet<number>;
  /** A truncated paragraph is known but not writable: replacing it would delete its unseen tail. */
  partialOrdinal: number | null;
}

/** Stay below the backend’s 64 KiB argument cap, measured in UTF-8 bytes. */
export const DOCUMENT_TEXT_BUDGET_BYTES = 61_440;
export const HEADING_OUTLINE_BUDGET_BYTES = 8_192;

const encoder = new TextEncoder();

const utf8Length = (value: string) => encoder.encode(value).length;

const HEADING_STYLE_LEVELS = new Map<string, number>([
  // Map Title to H1 because the outline format has no level 0.
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

export function resolveHeadingLevel(
  paragraph: Pick<WordParagraphRead, "styleBuiltIn" | "outlineLevel">,
): number | null {
  const fromStyle = HEADING_STYLE_LEVELS.get(paragraph.styleBuiltIn);
  if (fromStyle !== undefined) return fromStyle;
  const level = paragraph.outlineLevel;
  return Number.isInteger(level) && level >= 1 && level <= 9 ? level : null;
}

/** Word represents Shift+Enter as a vertical tab, not a paragraph boundary. */
export function normalizeParagraphText(text: string): string {
  return text.replace(/[\r\n\u000B]+/g, " ").trim();
}

const renderPrefix = (paragraph: WordParagraphRead) => {
  const level = resolveHeadingLevel(paragraph);
  return level === null
    ? `[${paragraph.ordinal}] `
    : `[${paragraph.ordinal}|H${level}] `;
};

/** Cut only at code-point boundaries to avoid splitting a UTF-8 sequence or surrogate pair. */
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

/** Count blank paragraphs too, or a complete document can appear truncated. */
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
  // Accumulate byte counts instead of repeatedly encoding the growing document.
  let usedBytes = 0;
  let consumed = 0;
  let blocked: WordParagraphRead | null = null;
  let hasContent = false;

  for (const paragraph of paragraphs) {
    const normalized = normalizeParagraphText(paragraph.text);
    if (normalized.length === 0) {
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
    // Allow a prefix of an oversized first paragraph so the context is not empty.
    const prefix = renderPrefix(blocked);
    const available = DOCUMENT_TEXT_BUDGET_BYTES - utf8Length(prefix);
    const partial = cutToUtf8Bytes(
      normalizeParagraphText(blocked.text),
      available,
    );
    if (partial.length > 0) {
      lines.push(prefix + partial);
      // Mark a partial paragraph separately so an edit cannot delete text the model never read.
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
