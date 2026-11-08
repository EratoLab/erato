/**
 * Values read from a call's raw `input` or `output`, made inert the way the
 * backend's `sanitize_display_text` makes the label's values: no control,
 * bidi or invisible formatting characters, NFC, at most two newlines in a
 * row, trimmed and capped.
 */

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
   * Whether bidi controls or zero-width, byte order mark or tag characters
   * were removed, so the text differs from the value in ways nobody can see.
   */
  hiddenCharacters: boolean;
}

/** The backend's `is_invisible_format_char`. */
export const isInvisibleFormatChar = (code: number): boolean =>
  code === 0x061c ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x202a && code <= 0x202e) ||
  code === 0x2060 ||
  (code >= 0x2066 && code <= 0x2069) ||
  code === 0xfeff ||
  (code >= 0xe0000 && code <= 0xe007f);

const isControl = (code: number): boolean =>
  (code < 0x20 && code !== 0x0a && code !== 0x09) ||
  (code >= 0x7f && code <= 0x9f);

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
  let hiddenCharacters = false;
  const kept = Array.from(scanned)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (isInvisibleFormatChar(code)) {
        hiddenCharacters = true;
        return false;
      }
      return !isControl(code) && !(code >= 0xd800 && code <= 0xdfff);
    })
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
