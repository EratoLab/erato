import type {
  ToolCallLabel,
  ToolCallSpokenNames,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * What people call a call's fields, coded values and tables in the language
 * the voice speaks, from the server's spoken vocabularies. The voice only:
 * the card keeps its own names. A name without an entry is said as the card
 * shows it, never guessed.
 */
export type SpokenNames = ToolCallSpokenNames;

/** The label's words for `language`, or for its primary subtag. */
export const spokenNamesFor = (
  label: ToolCallLabel | null | undefined,
  language: string,
): SpokenNames | undefined => {
  const all = label?.spoken_names;
  if (!all) return undefined;
  const tag = language.toLowerCase();
  const primary = tag.split(/[-_]/)[0];
  return all[tag] ?? all[primary];
};

const entry = (text: string | undefined): string | undefined => {
  const trimmed = text?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

/** The spoken name of a field the label carries as `key`. */
export const spokenFieldName = (
  names: SpokenNames | undefined,
  key: string,
): string | undefined => entry(names?.fields?.[key]);

/** The spoken name of a coded `value` of the field the label carries as `field`. */
export const spokenChoice = (
  names: SpokenNames | undefined,
  field: string,
  value: string,
): string | undefined => entry(names?.choices?.[field]?.[value]);

/** What the records of a table the label carries as `key` are called. */
export const spokenTableName = (
  names: SpokenNames | undefined,
  key: string,
): string | undefined => entry(names?.tables?.[key]);
