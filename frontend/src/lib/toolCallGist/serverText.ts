/**
 * Values read from a call's raw `input` or `output`, made inert the way the
 * backend's `sanitize_display_text` makes the label's values: no control,
 * bidi or invisible formatting characters, NFC, at most two newlines in a
 * row, trimmed and capped.
 */

import {
  isEmoji,
  isExtendedPictographic,
  isKeycapBase,
} from "./emojiProperties";

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
const COMBINING_ENCLOSING_KEYCAP = 0x20e3;

const isEmojiModifier = (code: number | undefined): boolean =>
  code !== undefined && code >= 0x1f3fb && code <= 0x1f3ff;

const isEmojiAt = (code: number | undefined): boolean =>
  code !== undefined && isEmoji(code);

const isPictographAt = (code: number | undefined): boolean =>
  code !== undefined && isExtendedPictographic(code);

const isKeycapBaseAt = (code: number | undefined): boolean =>
  code !== undefined && isKeycapBase(code);

const selectorStylesEmoji = (
  twoBack: number | undefined,
  previous: number | undefined,
  selector: number,
  next: number | undefined,
): boolean => {
  if (isEmojiModifier(previous)) {
    return isEmojiAt(twoBack) && !isKeycapBaseAt(twoBack);
  }
  // Plain text unless it starts a keycap: a selector on one would let two IDs
  // differ by a mark nobody sees.
  if (isKeycapBaseAt(previous)) {
    return (
      selector === EMOJI_PRESENTATION_SELECTOR &&
      next === COMBINING_ENCLOSING_KEYCAP
    );
  }
  return isEmojiAt(previous);
};

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
 * stays right after an `Emoji` character, as in "❤️", or after a skin tone
 * that follows one; after 0-9, `#` or `*` only a U+FE0F with U+20E3 right
 * after it stays, as in "1️⃣". A zero-width joiner stays between two
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
    return !selectorStylesEmoji(twoBack, previous, code, next);
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

/** Values a label pointer may reach before it counts as reaching too many. */
export const MAX_POINTER_VALUES = 10_000;

/**
 * Every value a label pointer reaches, where `*` stands for every element of
 * an array or member of an object, in document order. `undefined` once more
 * than `limit` would be reached, so wildcards over a wide input stay cheap.
 */
export const readPointerAll = (
  document: unknown,
  pointer: unknown,
  limit: number = MAX_POINTER_VALUES,
): unknown[] | undefined => {
  if (typeof pointer !== "string" || !pointer.startsWith("/")) return [];
  let reached: unknown[] = [document];
  for (const raw of pointer.slice(1).split("/")) {
    const next: unknown[] = [];
    for (const value of reached) {
      if (raw !== "*") {
        const child = readPointer(value, `/${raw}`);
        if (child !== undefined) next.push(child);
        continue;
      }
      const children = Array.isArray(value)
        ? value
        : isRecord(value)
          ? Object.values(value)
          : [];
      if (next.length + children.length > limit) return undefined;
      for (const child of children) next.push(child);
    }
    reached = next;
  }
  return reached;
};

/** The longest token a machine ID may be, as `isMachineId` reads one. */
const MAX_TOKEN_CHARS = 512;
/** A character a machine ID, or a token that holds one, may contain. */
const TOKEN_CHAR = /[A-Za-z0-9_\-+/=.{}]/;

/**
 * `text` cut to at most `maxChars` characters before the token that would be
 * cut, so no part of an ID is ever left that masking can no longer
 * recognise. A first token longer than that is cut where it must be.
 */
const cutBeforeToken = (text: string, maxChars: number): string => {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  let end = maxChars;
  while (
    end > 0 &&
    TOKEN_CHAR.test(chars[end]) &&
    TOKEN_CHAR.test(chars[end - 1])
  ) {
    end -= 1;
  }
  return chars
    .slice(0, end > 0 ? end : maxChars)
    .join("")
    .trimEnd();
};

/**
 * What a failed call's server said, in its own words: a text result, or the
 * `error` or `message` of a JSON one. `undefined` when the result holds no
 * such sentence; its raw form stays in the step's details. A long message is
 * cut before a whole token, never inside one.
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
    const cleaned = cleanServerText(
      candidate,
      MAX_FAILURE_MESSAGE_CHARS + MAX_TOKEN_CHARS,
    );
    if (cleaned.text.length === 0) continue;
    const text = cutBeforeToken(cleaned.text, MAX_FAILURE_MESSAGE_CHARS);
    return {
      ...cleaned,
      text,
      truncated: cleaned.truncated || text.length < cleaned.text.length,
    };
  }
  return undefined;
};

/** How a call failed when Erato, not the tool, wrote its error. */
export type EratoFailure = "no_answer" | "answer_unreadable" | "not_run";

/* eslint-disable lingui/no-unlocalized-strings -- what Erato's backend writes */
const NO_ANSWER_PREFIX = "Failed to call MCP tool: ";
const UNREADABLE_PREFIX = "Failed to process MCP tool output: ";
const NO_ANSWER: EratoFailure = "no_answer";
const ANSWER_UNREADABLE: EratoFailure = "answer_unreadable";
const NOT_RUN: EratoFailure = "not_run";
const ERROR_STATUS = "error";
const MCP_OUTPUT = "mcp_output";
/* eslint-enable lingui/no-unlocalized-strings */

/**
 * Whether Erato wrote a failed call's error itself, and how the call failed:
 * the row's `result_details` say so, or, on rows stored before they did, the
 * output is exactly what Erato writes when no answer came back or it could
 * not read one. `undefined` when the error may be the tool's own words.
 */
export const eratoFailureOf = (
  resultDetails: unknown,
  output: unknown,
): EratoFailure | undefined => {
  const marked = isRecord(resultDetails) ? resultDetails.failure : undefined;
  if (marked === ANSWER_UNREADABLE || marked === NOT_RUN) return marked;
  if (typeof marked === "string") return NO_ANSWER;
  if (resultDetails !== undefined && resultDetails !== null) return undefined;
  if (!isRecord(output) || output.status !== ERROR_STATUS) return undefined;
  const error = output.error;
  if (typeof error !== "string") return undefined;
  const keys = Object.keys(output);
  if (keys.length === 2 && error.startsWith(NO_ANSWER_PREFIX)) {
    return NO_ANSWER;
  }
  if (
    keys.length === 3 &&
    Object.hasOwn(output, MCP_OUTPUT) &&
    error.startsWith(UNREADABLE_PREFIX)
  ) {
    return ANSWER_UNREADABLE;
  }
  return undefined;
};
