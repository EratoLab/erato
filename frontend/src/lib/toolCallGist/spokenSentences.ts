/* eslint-disable lingui/no-unlocalized-strings -- sentence variants are data in the same form a deployment supplies them, not catalog copy */
import { cleanServerText } from "./serverText";
import { primaryLanguage } from "./spokenLanguageData";

/**
 * The natural wording of a spoken card: hand-written sentence variants for
 * a detail, with the values in fixed slots. No model and no free text: the
 * card's values go into the slots by code, each with its direction ("vom 1.
 * Dezember", "from 1 December"), so a variant cannot swap old and new by its
 * own words. A variant that does not hold exactly its slots, in the precise
 * sentence's order, is not used; the precise sentence is said instead. The
 * check guards the slots, not the meaning: whoever writes a variant is
 * responsible for what it says. The opening of a card has no variant: its
 * verb is the card's action, said as the precise sentence says it.
 */

/** Sentence types that have a natural variant. */
export type SentenceType = "changed" | "set" | "updated";

/** Per sentence type, the variants: `changed`, `set`, `updated`. */
export type SentenceSet = Partial<Record<string, string>>;

/** The slots each type must hold, in the order the precise sentence says them. */
const REQUIRED: Record<SentenceType, readonly string[]> = {
  changed: ["field", "from", "to"],
  set: ["field", "value"],
  updated: ["field", "value"],
};

const MAX_VARIANT_CHARS = 300;
const isControl = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
};

const typeOf = (key: string): SentenceType | undefined =>
  key in REQUIRED ? (key as SentenceType) : undefined;

/** The slots of `template` in order, or `undefined` when a brace stands alone. */
const slotsOf = (template: string): string[] | undefined => {
  const found: string[] = [];
  let rest = template;
  for (;;) {
    const open = rest.search(/[{}]/);
    if (open === -1) return found;
    const match = /^\{([a-z]+)\}/.exec(rest.slice(open));
    if (!match) return undefined;
    found.push(match[1]);
    rest = rest.slice(open + match[0].length);
  }
};

/**
 * Why `template` may not stand for the sentence `key`, or `undefined` when it
 * may: every required slot exactly once, no other slot or brace, and the
 * precise order (old before new). A variant for one field of one table may
 * leave out `{field}`, since its words name the field. The backend checks
 * the same, against the same cases (`fixtures/spokenSentenceVariants.json`).
 */
export const variantProblem = (
  key: string,
  template: string,
  forOneField = false,
): string | undefined => {
  const type = typeOf(key);
  if (!type) return "no sentence type has this name";
  if (template.trim().length === 0) return "it is blank";
  if (Array.from(template).length > MAX_VARIANT_CHARS)
    return "it is longer than 300 characters";
  if (
    Array.from(template).some(isControl) ||
    cleanServerText(template).hiddenCharacters
  )
    return "it holds control or hidden characters";
  const found = slotsOf(template);
  if (!found) return "a brace is not part of a slot such as {field}";
  const allowed = REQUIRED[type];
  if (found.some((slot) => !allowed.includes(slot)))
    return "it holds a slot this sentence does not have";
  if (new Set(found).size !== found.length) return "a slot is used twice";
  const required = allowed.filter((slot) => !(forOneField && slot === "field"));
  if (!required.every((slot) => found.includes(slot)))
    return "a slot is missing";
  const order = found.map((slot) => allowed.indexOf(slot));
  return order.every((at, index) => index === 0 || at > order[index - 1])
    ? undefined
    : "its slots are not in the precise sentence's order";
};

export const usableVariant = (
  key: string,
  template: string,
  forOneField = false,
): boolean => variantProblem(key, template, forOneField) === undefined;

/** `template` with its slots filled; spaces around empty slots tidied. */
export const fillVariant = (
  template: string,
  slots: Record<string, string>,
): string =>
  template
    .replace(/\{([a-z]+)\}/g, (_, name: string) => slots[name] ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,:;!?])/g, "$1")
    .trim();

/**
 * The natural variant for `key` in `language`: one field's own variant
 * first, then the deployment's, then the built-in one; `undefined` keeps
 * the precise sentence.
 */
export const naturalVariant = (
  language: string,
  key: string,
  deployment: SentenceSet | undefined,
  field?: string,
): string | undefined => {
  if (field !== undefined && usableVariant(key, field, true)) return field;
  const configured = deployment?.[key];
  if (configured !== undefined && usableVariant(key, configured))
    return configured;
  const builtIn = BUILT_IN[primaryLanguage(language)]?.[key];
  return builtIn !== undefined && usableVariant(key, builtIn)
    ? builtIn
    : undefined;
};

/**
 * The built-in natural sentences. Where the precise sentence already sounds
 * natural (`set`: "Priorität: Hoch."; `updated`: "… wird auf Hoch gesetzt."),
 * there is none: the natural wording differs mainly where a field or a
 * deployment has its own sentence. German avoids an article before a field
 * name: the vocabulary does not know its gender.
 */
const BUILT_IN: Partial<Record<string, SentenceSet>> = {
  de: { changed: "{field} ändert sich {from} {to}." },
  en: { changed: "{field} changes {from} {to}." },
};
