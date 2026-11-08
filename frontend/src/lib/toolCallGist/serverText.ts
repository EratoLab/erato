/**
 * Values read from a call's raw `input` or `output`, made inert the way the
 * backend's `sanitize_display_text` makes the label's values: no control,
 * bidi or invisible formatting characters, NFC, at most two newlines in a
 * row, trimmed and capped.
 */

import { isEmoji, isExtendedPictographic } from "./emojiProperties";

/** The backend's cap for a tool's name or title. */
export const MAX_SERVER_TEXT_CHARS = 200;
/** The backend's cap for a tool's description (`MAX_DISPLAY_DESCRIPTION_CHARS`). */
export const MAX_SERVER_DESCRIPTION_CHARS = 4_000;
/** A failure message is a sentence or two, never the server's stack trace. */
export const MAX_FAILURE_MESSAGE_CHARS = 300;
/** An argument an approval card shows whole; past it the card says it is cut. */
export const MAX_ARGUMENT_VALUE_CHARS = 50_000;

export interface CleanText {
  text: string;
  truncated: boolean;
  /**
   * Whether invisible characters such as bidi controls or zero-width, filler,
   * variation selector or tag characters were removed, so the text differs
   * from the value in ways nobody can see.
   */
  hiddenCharacters: boolean;
}

/** Unicode 16's default-ignorable code points, as the backend lists them. */
const DEFAULT_IGNORABLE: readonly (readonly [number, number])[] = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff0, 0xfff8],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
];

/** The backend's `is_invisible_format_char`. */
export const isInvisibleFormatChar = (code: number): boolean =>
  code >= 0x00ad &&
  DEFAULT_IGNORABLE.some(([start, end]) => code >= start && code <= end);

const isControl = (code: number): boolean =>
  (code < 0x20 && code !== 0x0a && code !== 0x09) ||
  (code >= 0x7f && code <= 0x9f);

const isSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdfff;

const EMOJI_PRESENTATION_SELECTOR = 0xfe0f;
const ZERO_WIDTH_JOINER = 0x200d;

const isEmojiModifier = (code: number | undefined): boolean =>
  code !== undefined && code >= 0x1f3fb && code <= 0x1f3ff;

const isEmojiAt = (code: number | undefined): boolean =>
  code !== undefined && isEmoji(code);

const isPictographAt = (code: number | undefined): boolean =>
  code !== undefined && isExtendedPictographic(code);

const selectorStylesEmoji = (
  twoBack: number | undefined,
  previous: number | undefined,
): boolean =>
  isEmojiModifier(previous) ? isEmojiAt(twoBack) : isEmojiAt(previous);

const joinerFollowsEmoji = (
  twoBack: number | undefined,
  previous: number | undefined,
): boolean => {
  if (previous === EMOJI_PRESENTATION_SELECTOR) {
    return isPictographAt(twoBack) && isEmojiAt(twoBack);
  }
  if (isEmojiModifier(previous)) return isPictographAt(twoBack);
  return isPictographAt(previous);
};

/**
 * The backend's `mark_hidden_chars` for one code point, from the raw code
 * points around it: an invisible character, except two that are emoji text
 * where they sit. A text or emoji presentation selector (U+FE0E, U+FE0F)
 * stays right after an `Emoji` character, as in "❤️" or "1️⃣", or after a skin
 * tone that follows one; a zero-width joiner stays between two
 * `Extended_Pictographic` characters, the first optionally followed by a
 * kept U+FE0F or a skin tone, as in "👨‍👩‍👧" or "🏳️‍🌈". Tag characters always hide.
 */
const isHiddenAt = (
  twoBack: number | undefined,
  previous: number | undefined,
  code: number,
  next: number | undefined,
): boolean => {
  if (!isInvisibleFormatChar(code)) return false;
  if (code === 0xfe0e || code === EMOJI_PRESENTATION_SELECTOR) {
    return !selectorStylesEmoji(twoBack, previous);
  }
  if (code === ZERO_WIDTH_JOINER) {
    return !(joinerFollowsEmoji(twoBack, previous) && isPictographAt(next));
  }
  return true;
};

// Enough room for the dropped characters and line breaks a capped text may
// lose, without walking a megabyte-long string a server sent.
const SCAN_FACTOR = 4;

export const cleanServerText = (
  raw: unknown,
  maxChars: number = MAX_SERVER_TEXT_CHARS,
): CleanText => {
  if (typeof raw !== "string") {
    return { text: "", truncated: false, hiddenCharacters: false };
  }
  const scanned = raw.slice(0, maxChars * SCAN_FACTOR);
  const codes = Array.from(scanned, (char) => char.codePointAt(0) ?? 0);
  // A joiner at the end of what is scanned still sees what the text has next.
  const after = raw.codePointAt(scanned.length);
  let hiddenCharacters = false;
  const kept = codes
    .filter((code, index) => {
      const next = index + 1 < codes.length ? codes[index + 1] : after;
      if (isHiddenAt(codes[index - 2], codes[index - 1], code, next)) {
        hiddenCharacters = true;
        return false;
      }
      return !isControl(code) && !isSurrogate(code);
    })
    .map((code) => String.fromCodePoint(code))
    .join("")
    .normalize("NFC")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const chars = Array.from(kept);
  return chars.length > maxChars
    ? {
        text: chars.slice(0, maxChars).join("").trimEnd(),
        truncated: true,
        hiddenCharacters,
      }
    : { text: kept, truncated: scanned.length < raw.length, hiddenCharacters };
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A count read as data: anything but a positive finite number is none. */
export const countOf = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;

const unescapeSegment = (segment: string): string =>
  segment.replace(/~1/g, "/").replace(/~0/g, "~");

/** The member names and list indices of a JSON pointer, unescaped. */
export const pointerSegments = (pointer: unknown): string[] =>
  typeof pointer === "string" && pointer.startsWith("/")
    ? pointer.slice(1).split("/").map(unescapeSegment)
    : [];

/** The member name or list index a JSON pointer ends in, unescaped. */
export const lastPointerSegment = (pointer: unknown): string | undefined => {
  if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;
  return unescapeSegment(pointer.slice(pointer.lastIndexOf("/") + 1));
};

/** The value a JSON pointer (RFC 6901) reaches; the empty pointer is the whole document. */
export const readPointer = (document: unknown, pointer: unknown): unknown => {
  if (pointer === "") return document;
  if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;
  let current: unknown = document;
  for (const segment of pointerSegments(pointer)) {
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

const MAX_PREVIEW_DEPTH = 32;

/**
 * Compact JSON of a value, cut after about `maxChars` characters without
 * serialising the rest of a large one.
 */
export const jsonPreview = (value: unknown, maxChars: number): string => {
  let out = "";
  const write = (current: unknown, depth: number): boolean => {
    if (out.length > maxChars) return false;
    if (typeof current === "string") {
      out += JSON.stringify(current.slice(0, maxChars));
    } else if (Array.isArray(current)) {
      if (depth >= MAX_PREVIEW_DEPTH) {
        out += "[…]";
        return true;
      }
      out += "[";
      for (let index = 0; index < current.length; index++) {
        if (index > 0) out += ",";
        if (!write(current[index], depth + 1)) return false;
      }
      out += "]";
    } else if (isRecord(current)) {
      if (depth >= MAX_PREVIEW_DEPTH) {
        out += "{…}";
        return true;
      }
      out += "{";
      let first = true;
      for (const key in current) {
        if (!Object.hasOwn(current, key)) continue;
        out += `${first ? "" : ","}${JSON.stringify(key.slice(0, maxChars))}:`;
        first = false;
        if (!write(current[key], depth + 1)) return false;
      }
      out += "}";
    } else if (typeof current === "bigint") {
      out += String(current);
    } else {
      out += current === undefined ? "null" : JSON.stringify(current);
    }
    return out.length <= maxChars;
  };
  write(value, 0);
  return out;
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
  for (const candidate of candidates) {
    const cleaned = cleanServerText(candidate, MAX_FAILURE_MESSAGE_CHARS);
    if (cleaned.text.length > 0) return cleaned;
  }
  return undefined;
};
