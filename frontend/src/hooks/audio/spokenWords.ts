/**
 * Words as the backend's voice-command rules compare them: lower case,
 * umlauts and ß spelled out, other accents dropped, split at anything that
 * is not a letter or digit ("Hör auf!" is `hoer auf`).
 */
export const foldSpokenWords = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
