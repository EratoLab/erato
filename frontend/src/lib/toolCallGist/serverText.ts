/**
 * Values read from a call's raw `input` or `output`, made inert the way the
 * backend's `sanitize_display_text` makes the label's values: no control or
 * bidi characters, NFC, at most two newlines in a row, trimmed and capped.
 */

/** The backend's cap for a tool's name or title. */
export const MAX_SERVER_TEXT_CHARS = 200;
/** A failure message is a sentence or two, never the server's stack trace. */
export const MAX_FAILURE_MESSAGE_CHARS = 300;

export interface CleanText {
  text: string;
  truncated: boolean;
}

const isDropped = (code: number): boolean =>
  (code < 0x20 && code !== 0x0a && code !== 0x09) ||
  (code >= 0x7f && code <= 0x9f) ||
  code === 0x200e ||
  code === 0x200f ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069);

export const cleanServerText = (
  raw: string,
  maxChars: number = MAX_SERVER_TEXT_CHARS,
): CleanText => {
  const kept = Array.from(raw)
    .filter((char) => !isDropped(char.codePointAt(0) ?? 0))
    .join("")
    .normalize("NFC")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const chars = Array.from(kept);
  return chars.length > maxChars
    ? { text: chars.slice(0, maxChars).join("").trimEnd(), truncated: true }
    : { text: kept, truncated: false };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const unescapeSegment = (segment: string): string =>
  segment.replace(/~1/g, "/").replace(/~0/g, "~");

/** The member name or list index a JSON pointer ends in, unescaped. */
export const lastPointerSegment = (pointer: string): string | undefined => {
  if (!pointer.startsWith("/")) return undefined;
  return unescapeSegment(pointer.slice(pointer.lastIndexOf("/") + 1));
};

/** The value a JSON pointer (RFC 6901) reaches; the empty pointer is the whole document. */
export const readPointer = (document: unknown, pointer: string): unknown => {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) return undefined;
  let current: unknown = document;
  for (const raw of pointer.slice(1).split("/")) {
    const segment = unescapeSegment(raw);
    if (Array.isArray(current) && /^(0|[1-9]\d*)$/.test(segment)) {
      current = current[Number(segment)];
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
};

/**
 * What a failed call's server said, in its own words: a text result, or the
 * `error` or `message` of a JSON one. `undefined` when the result holds no
 * such sentence; its raw form stays in the step's details.
 */
export const serverFailureMessage = (
  output: unknown,
): CleanText | undefined => {
  const error = isRecord(output) ? output.error : undefined;
  const candidates = [
    output,
    error,
    isRecord(error) ? error.message : undefined,
    isRecord(output) ? output.message : undefined,
  ];
  const text = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  if (text === undefined) return undefined;
  const cleaned = cleanServerText(text, MAX_FAILURE_MESSAGE_CHARS);
  return cleaned.text.length > 0 ? cleaned : undefined;
};
