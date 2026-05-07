import { useMemo } from "react";

const BOLD_CANDIDATE = /\*\*([^*\n]+)\*\*/g;
const FOLLOWED_BY_PARAGRAPH_BREAK = /^\n\n/;
const ALL_WHITESPACE_TO_END = /^\s*$/;
const SENTENCE_BOUNDARY = /[.!?](?:\s|$)/;
const MAX_AUTO_TITLE_LENGTH = 80;

export interface ReasoningSegment {
  /** Single-line title shown in the step header. Never empty. */
  title: string;
  /** Markdown body to render in the step content. May be empty (streaming case). */
  body: string;
}

interface HeaderMatch {
  /** Start index of the `**` opener in the source text. */
  start: number;
  /** Index of the first character AFTER the closing `**`. */
  end: number;
  /** The header text between the `**` pairs, untrimmed. */
  text: string;
}

/**
 * A `**Bold**` is a section header iff what follows it in the source is
 * either:
 *   - a paragraph break (`\n\n`), or
 *   - only whitespace until end of text (streaming case where the body
 *     hasn't arrived yet).
 *
 * Anything else (period, single newline + indent for list items, space) means
 * it's inline emphasis, not a header. This rule reliably distinguishes
 * Anthropic-style multi-summary reasoning (`**H**\n\nbody`) from bolded
 * list-item labels (`1. **Label:**\n   - sub`).
 */
const findHeaders = (text: string): HeaderMatch[] => {
  const matches: HeaderMatch[] = [];
  let m: RegExpExecArray | null = null;
  BOLD_CANDIDATE.lastIndex = 0;
  while ((m = BOLD_CANDIDATE.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const after = text.slice(end);
    if (
      FOLLOWED_BY_PARAGRAPH_BREAK.test(after) ||
      ALL_WHITESPACE_TO_END.test(after)
    ) {
      matches.push({ start: m.index, end, text: m[1] });
    }
  }
  return matches;
};

/**
 * Generate a one-line title for prose with no usable header. Strategy:
 *   1. Limit the source to the first line — paragraph breaks and list
 *      numbering ("1.", "2.") never belong in a title.
 *   2. Cut at the first sentence terminator if one exists in that line.
 *   3. Otherwise truncate at a word boundary and append "…".
 */
const deriveAutoTitle = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const firstLine = trimmed.split("\n", 1)[0];

  const sentenceEnd = firstLine.search(SENTENCE_BOUNDARY);
  const candidate =
    sentenceEnd > 0 ? firstLine.slice(0, sentenceEnd + 1) : firstLine;

  if (candidate.length <= MAX_AUTO_TITLE_LENGTH) return candidate;

  const slice = candidate.slice(0, MAX_AUTO_TITLE_LENGTH - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const truncated = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return truncated + "…";
};

/**
 * Split a reasoning ContentPart's text into one or more logical segments,
 * each rendered as its own step in the trace timeline.
 *
 * Returns:
 *   - empty array when the input is blank,
 *   - a single segment with an auto-generated title when no `**Header**\n\n`
 *     pattern is present,
 *   - one segment per detected header (plus a leading "preamble" segment if
 *     prose appeared before the first header).
 *
 * Pure function; safe to call from tests / outside React.
 */
export const parseReasoningSegments = (text: string): ReasoningSegment[] => {
  if (!text.trim()) return [];

  const headers = findHeaders(text);

  if (headers.length === 0) {
    return [{ title: deriveAutoTitle(text), body: text.trim() }];
  }

  const segments: ReasoningSegment[] = [];

  const preamble = text.slice(0, headers[0].start);
  if (preamble.trim()) {
    segments.push({ title: deriveAutoTitle(preamble), body: preamble.trim() });
  }

  headers.forEach((header, i) => {
    const isLastHeader = i === headers.length - 1;
    const bodyStart = header.end;
    const bodyEnd = isLastHeader ? text.length : headers[i + 1].start;
    segments.push({
      title: header.text.trim(),
      body: text.slice(bodyStart, bodyEnd).trim(),
    });
  });

  return segments;
};

/**
 * Memoized hook variant of `parseReasoningSegments`. Use in components; for
 * pure derivations (tests, server) call `parseReasoningSegments` directly.
 */
export const useReasoningSegments = (text: string): ReasoningSegment[] =>
  useMemo(() => parseReasoningSegments(text), [text]);
