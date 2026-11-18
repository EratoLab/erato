/* eslint-disable lingui/no-unlocalized-strings -- sentence variants are data in the same form a deployment supplies them, not catalog copy */

/**
 * The natural wording of a spoken card: hand-written sentence variants with
 * the values in fixed slots. No model and no free text: the card's values go
 * into the slots by code, and a variant that does not hold exactly its
 * slots, in the precise sentence's order, is not used; the precise sentence
 * is said instead. The built-in variants below can be replaced per
 * deployment and, for one field, per vocabulary.
 */

/** Sentence types that have a natural variant. */
export type SentenceType = "changed" | "set" | "updated" | "what";

export type Sentences = Partial<Record<string, string>>;

/** Per sentence type, the variants: `changed`, `set`, `updated`, `what.<action>`. */
export type SentenceSet = Partial<Record<string, string>>;

/** The slots each type must hold, in the order the precise sentence says them. */
const REQUIRED: Record<SentenceType, readonly string[]> = {
  changed: ["field", "from", "to"],
  set: ["field", "value"],
  updated: ["field", "value"],
  what: ["source", "thing", "destination", "clause"],
};

/** Slots whose order may change: they never stand for one another. */
const ANY_ORDER: readonly SentenceType[] = ["what"];

const SLOT = /\{([a-z]+)\}/g;

const typeOf = (key: string): SentenceType | undefined => {
  const type = key.split(".")[0];
  return type in REQUIRED ? (type as SentenceType) : undefined;
};

/**
 * Whether `template` may stand for the sentence `key`: every required slot
 * exactly once, no other slot, and the precise order where order carries
 * meaning (old before new). A variant for one field may leave out `{field}`,
 * since its words name the field.
 */
export const usableVariant = (
  key: string,
  template: string,
  forOneField = false,
): boolean => {
  const type = typeOf(key);
  if (!type || template.trim().length === 0 || template.length > 300)
    return false;
  const required = REQUIRED[type].filter(
    (slot) => !(forOneField && slot === "field"),
  );
  const found = [...template.matchAll(SLOT)].map((match) => match[1]);
  const allowed = REQUIRED[type];
  if (found.some((slot) => !allowed.includes(slot))) return false;
  if (new Set(found).size !== found.length) return false;
  if (!required.every((slot) => found.includes(slot))) return false;
  if (ANY_ORDER.includes(type)) return true;
  const order = found.map((slot) => allowed.indexOf(slot));
  return order.every((at, index) => index === 0 || at > order[index - 1]);
};

/** `template` with its slots filled; spaces around empty slots tidied. */
export const fillVariant = (
  template: string,
  slots: Record<string, string>,
): string =>
  template
    .replace(SLOT, (_, name: string) => slots[name] ?? "")
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
  const code = language.split(/[-_]/)[0]?.toLowerCase() ?? "en";
  const builtIn = BUILT_IN[code]?.[key];
  return builtIn !== undefined && usableVariant(key, builtIn)
    ? builtIn
    : undefined;
};

/**
 * The built-in natural sentences. German avoids an article before a field
 * name: the vocabulary does not know its gender. In `changed`, a German
 * value carries its own preposition ("vom 1. Dezember", "auf den 15.
 * Januar"), an English one none; `set` and `updated` take the bare value.
 */
const BUILT_IN: Partial<Record<string, SentenceSet>> = {
  de: {
    changed: "{field} ändert sich {from} {to}.",
    set: "{field} ist {value}.",
    updated: "{field} wird zu {value}.",
    "what.create":
      "Als Nächstes {source} {thing} {destination} anlegen{clause}",
    "what.update": "Als Nächstes {source} {thing} {destination} ändern{clause}",
    "what.reschedule":
      "Als Nächstes {source} {thing} {destination} verschieben{clause}",
    "what.send": "Als Nächstes {source} {thing} {destination} senden{clause}",
    "what.move":
      "Als Nächstes {source} {thing} {destination} verschieben{clause}",
    "what.comment":
      "Als Nächstes {source} {thing} {destination} kommentieren{clause}",
    "what.share":
      "Als Nächstes {source} {thing} {destination} freigeben{clause}",
    "what.run": "Als Nächstes {source} {thing} {destination} ausführen{clause}",
    "what.upsert":
      "Als Nächstes {source} {thing} {destination} anlegen oder aktualisieren{clause}",
    "what.archive":
      "Als Nächstes {source} {thing} {destination} archivieren{clause}",
    "what.upload":
      "Als Nächstes {source} {thing} {destination} hochladen{clause}",
  },
  en: {
    changed: "{field} changes from {from} to {to}.",
    set: "{field} is {value}.",
    updated: "{field} becomes {value}.",
    "what.create": "Next up: creating {thing} {destination} {source}{clause}",
    "what.update": "Next up: changing {thing} {destination} {source}{clause}",
    "what.reschedule":
      "Next up: rescheduling {thing} {destination} {source}{clause}",
    "what.send": "Next up: sending {thing} {destination} {source}{clause}",
    "what.move": "Next up: moving {thing} {destination} {source}{clause}",
    "what.comment":
      "Next up: commenting on {thing} {destination} {source}{clause}",
    "what.share": "Next up: sharing {thing} {destination} {source}{clause}",
    "what.run": "Next up: running {thing} {destination} {source}{clause}",
    "what.upsert":
      "Next up: creating or updating {thing} {destination} {source}{clause}",
    "what.archive": "Next up: archiving {thing} {destination} {source}{clause}",
    "what.upload": "Next up: uploading {thing} {destination} {source}{clause}",
  },
};
