/**
 * Which values are machine identifiers, as the backend's `is_machine_id`
 * decides for every label it stores: a UUID or a long opaque token nobody can
 * read or compare. Here for text a label never held, such as the message a
 * failed call's server returned. Identifiers people work with, issue numbers,
 * ticket keys, SKUs, file names, addresses and phone numbers, are none.
 */

const MIN_OPAQUE_CHARS = 16;
const MAX_ID_CHARS = 512;
const MAX_MEAN_RUN_TENTHS = 25;
const MAX_PHONE_DIGITS = 15;
const MIN_SHORT_ID_CHARS = 9;
const MAX_SHORT_ID_CHARS = 12;
const MIN_SHORT_ID_RUNS = 4;
const MIN_SHORT_ID_DIGITS = 2;
const MIN_JWT_SEGMENT_CHARS = 10;

const HYPHENATED_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BARE_UUID = /^[0-9a-f]{32}$/i;
const BASE64 = /^[A-Za-z0-9_\-+/=]+$/;
const HEX = /^[0-9a-f]+$/i;

const looksLikeAUuid = (text: string): boolean => {
  const bare =
    text.startsWith("{") && text.endsWith("}") ? text.slice(1, -1) : text;
  return HYPHENATED_UUID.test(bare) || BARE_UUID.test(bare);
};

/** How many runs of one class (lower case, upper case, digit) `text` has. */
const runs = (text: string): number => {
  let count = 0;
  let previous: string | undefined;
  for (const char of text) {
    const kind = /[0-9]/.test(char)
      ? "digit"
      : /[A-Z]/.test(char)
        ? "upper"
        : /[a-z]/.test(char)
          ? "lower"
          : undefined;
    if (kind === undefined) continue;
    if (kind !== previous) count += 1;
    previous = kind;
  }
  return count;
};

const isLongDigits = (text: string): boolean =>
  text.length > MAX_PHONE_DIGITS && /^[0-9]+$/.test(text);

const isHexToken = (text: string): boolean =>
  text.length >= MIN_OPAQUE_CHARS &&
  HEX.test(text) &&
  /[0-9]/.test(text) &&
  /[a-f]/i.test(text) &&
  runs(text) >= MIN_SHORT_ID_RUNS;

const isShortMixedId = (text: string): boolean =>
  text.length >= MIN_SHORT_ID_CHARS &&
  text.length <= MAX_SHORT_ID_CHARS &&
  /^[A-Z][A-Z0-9]*$/.test(text) &&
  (text.match(/[0-9]/g)?.length ?? 0) >= MIN_SHORT_ID_DIGITS &&
  runs(text) >= MIN_SHORT_ID_RUNS;

const isJwtLike = (text: string): boolean => {
  const segments = text.split(".");
  return (
    segments.length === 3 &&
    segments.every(
      (segment) =>
        segment.length >= MIN_JWT_SEGMENT_CHARS && BASE64.test(segment),
    )
  );
};

const isOpaqueToken = (text: string): boolean => {
  if (text.length < MIN_OPAQUE_CHARS || !BASE64.test(text)) return false;
  const letters = text.match(/[A-Za-z0-9]/g)?.length ?? 0;
  const runCount = text
    .split(/[_\-+/=]/)
    .reduce((sum, part) => sum + runs(part), 0);
  return runCount > 0 && letters * 10 <= runCount * MAX_MEAN_RUN_TENTHS;
};

const idInsideALinkPath = (text: string): boolean => {
  const open = text.lastIndexOf("(");
  if (open < 0 || !text.endsWith(")")) return false;
  const path = text.slice(0, open);
  const inner = text.slice(open + 1, -1);
  return (
    path.startsWith("/") &&
    path.length > 1 &&
    !/[\s()]/.test(path) &&
    isMachineId(inner)
  );
};

/** Whether `text`, read as one token, is a machine identifier. */
export const isMachineId = (raw: string): boolean => {
  const text = raw.trim();
  if (
    text.length === 0 ||
    text.length > MAX_ID_CHARS ||
    /\s/.test(text) ||
    text.includes("@") ||
    text.includes("://")
  ) {
    return false;
  }
  return (
    looksLikeAUuid(text) ||
    isLongDigits(text) ||
    isHexToken(text) ||
    isShortMixedId(text) ||
    isJwtLike(text) ||
    isOpaqueToken(text) ||
    idInsideALinkPath(text)
  );
};

/** A word of text an ID may stand in: letters, digits and the marks IDs hold. */
const TOKEN = /[A-Za-z0-9_\-+/=.{}]+/g;
/** Where an ID meets what names it, as in `Id=…` or `items/…`. */
const JOINS = /([=/.])/;

/**
 * `text` with every machine ID in it replaced by `phrase`: a token that is
 * one whole, or a part of a token such as the ID in `Id=<uuid>`. Punctuation
 * that ends a sentence stays.
 */
export const maskMachineIds = (text: string, phrase: string): string =>
  text.replace(TOKEN, (token) => {
    const end = /[.]+$/.exec(token)?.[0] ?? "";
    const word = token.slice(0, token.length - end.length);
    if (word.length === 0) return token;
    if (isMachineId(word)) return `${phrase}${end}`;
    const parts = word.split(JOINS);
    const masked = parts.map((part) =>
      JOINS.test(part) || !isMachineId(part) ? part : phrase,
    );
    return `${masked.join("")}${end}`;
  });
