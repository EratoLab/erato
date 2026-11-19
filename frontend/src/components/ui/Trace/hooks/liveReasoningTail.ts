/** The live window shows the newest lines only; this much text overflows it at any pane width. */
const TAIL_CHARS = 4_000;
/** Up to this length the whole section renders, so short sections look exactly as before. */
const WHOLE_TEXT_LIMIT = 6_000;

const FENCE_LINE = /^ {0,3}(?:(`{3,}|~{3,})(.*)|(\$\$)[ \t]*)$/gm;

/** The line that opened a code or math block still open at `end`, if any. */
const openBlockAt = (text: string, end: number): string | null => {
  let open: { marker: string; line: string } | null = null;
  const prefix = text.slice(0, end);
  FENCE_LINE.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = FENCE_LINE.exec(prefix)) !== null) {
    const marker = match[1] || match[3];
    const closes =
      open !== null &&
      marker[0] === open.marker[0] &&
      marker.length >= open.marker.length &&
      (match[2] || "").trim() === "";
    if (open === null) {
      open = { marker, line: match[0].trimStart() };
    } else if (closes) {
      open = null;
    }
  }
  return open?.line ?? null;
};

/**
 * The part of a live reasoning section worth rendering on each chunk: the
 * newest paragraphs, so the cost of a chunk stays the same however long the
 * model has been thinking. A cut inside a code or math block reopens it.
 */
export const liveReasoningTail = (text: string): string => {
  if (text.length <= WHOLE_TEXT_LIMIT) return text;
  const earliestStart = text.length - WHOLE_TEXT_LIMIT;
  let boundary = text.lastIndexOf("\n\n", text.length - TAIL_CHARS);
  while (boundary >= earliestStart) {
    const start = boundary + 2;
    if (start < text.length && !/\s/.test(text[start])) {
      const openBlock = openBlockAt(text, start);
      const tail = text.slice(start);
      return openBlock === null ? tail : `${openBlock}\n${tail}`;
    }
    boundary = text.lastIndexOf("\n\n", boundary - 1);
  }
  return text;
};
