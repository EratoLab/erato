import { useMemo } from "react";

// A leading bold header on its own line: `**Header**` followed by EOL or EOF.
// Anthropic's reasoning summaries use this convention.
const LEADING_BOLD_HEADER = /^\*\*([^*\n]+)\*\*\s*(?:\n|$)/;
const INLINE_BOLD_HEADER = /\*\*([^*\n]+)\*\*/;
const SENTENCE_BREAK = /[.!?](?:\s|$)/;
const MAX_SUMMARY_LENGTH = 80;

export interface ReasoningSplit {
  /** Short title for the step header. Empty string if no usable content yet. */
  summary: string;
  /**
   * Body to render in the step content. When the source starts with the same
   * bold header we lifted into `summary`, that header is stripped here so it
   * doesn't appear twice.
   */
  body: string;
}

const truncateForSummary = (text: string): string => {
  if (text.length <= MAX_SUMMARY_LENGTH) return text;
  return text.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd() + "…";
};

/**
 * Split reasoning text into a one-line `summary` and the `body` to render
 * underneath. Strategy:
 *
 * 1. If the text starts with `**Header**\n…`, lift the header into the summary
 *    and strip it (plus surrounding whitespace) from the body.
 * 2. Otherwise, derive a summary from the first inline bold header, the first
 *    sentence, or a truncated prefix — but leave the body unchanged.
 */
export const splitReasoning = (text: string): ReasoningSplit => {
  const trimmed = text.trim();
  if (!trimmed) return { summary: "", body: "" };

  const leading = LEADING_BOLD_HEADER.exec(trimmed);
  if (leading) {
    const summary = leading[1].trim();
    const body = trimmed.slice(leading[0].length).replace(/^\s+/, "");
    return { summary, body };
  }

  const inline = INLINE_BOLD_HEADER.exec(trimmed);
  if (inline) {
    return { summary: inline[1].trim(), body: trimmed };
  }

  const sentenceEnd = trimmed.search(SENTENCE_BREAK);
  const firstChunk =
    sentenceEnd > 0 ? trimmed.slice(0, sentenceEnd + 1) : trimmed;
  return { summary: truncateForSummary(firstChunk), body: trimmed };
};

/** Convenience accessor when callers only want the title. */
export const summarizeReasoning = (text: string): string =>
  splitReasoning(text).summary;

/**
 * Memoized hook variant of `splitReasoning`. Use in components; for pure
 * derivations (tests, server) call `splitReasoning` directly.
 */
export const useReasoningSplit = (text: string): ReasoningSplit =>
  useMemo(() => splitReasoning(text), [text]);
