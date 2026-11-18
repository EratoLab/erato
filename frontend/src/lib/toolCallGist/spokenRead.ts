/* eslint-disable lingui/no-unlocalized-strings -- API values and piece names; the spoken words are in spokenCardWords */
import { GIST_KINDS } from "./gist";
import { isMachineId } from "./machineId";
import { cleanServerText, isRecord } from "./serverText";
import { spokenChoice, spokenFieldName, spokenTableName } from "./spokenNames";
import { earValue } from "./spokenValues";

import type { GistKind } from "./gist";
import type {
  ComposedPiece,
  SpokenPieceRole,
  SpokenQueuePosition,
  SpokenSource,
} from "./spokenCard";
import type { SpokenNames } from "./spokenNames";
import type { EarValue } from "./spokenValues";
import type {
  ToolCallLabel,
  ToolCallReadOperator,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * A call that only reads, as the voice says it: built from the label's read
 * description, which only the voice uses; the card on screen ignores it.
 * What kind of thing, where, and by what: a search text, the items read, or
 * the tables and conditions of a plain SQL read.
 */

export type SpokenReadShape = "search" | "items" | "list";

export interface SpokenCondition {
  column: string;
  /** The column as the label names it, where the voice says another name. */
  cardColumn?: string;
  /** The column's table, when the statement reads several. */
  table?: string;
  operator: Exclude<ToolCallReadOperator, "other">;
  values: EarValue[];
  valuesOmitted: number;
  /** A value too long to say, by its words: named, not read. */
  longWords?: number;
}

export interface SpokenReadFacts {
  shape: SpokenReadShape;
  kind: GistKind;
  server?: string;
  /** The text a search looks for, or its size when too long to say. */
  search?: { text: string } | { words: number };
  /** Names of the items read, at most three. */
  names: string[];
  /** How many items it reads. */
  count: number;
  /** The one item it reads is named only by an ID nobody read here. */
  unread: boolean;
  /** Where it looks: a folder, a parent, a place. */
  where: string[];
  /** The tables a statement reads, when they say more than the kind. */
  tables: string[];
  /**
   * What the records of the one table it reads are called, in the plural,
   * where a spoken vocabulary says so: said instead of the kind and the
   * table.
   */
  things?: string;
  tablesOmitted: number;
  conditions: SpokenCondition[];
  /**
   * Conditions not said: counted, or `unknown` when the read only says
   * that it narrows.
   */
  conditionsOmitted: number | "unknown";
  limit?: number;
}

export interface SpokenReadWords {
  /** What, where and how: ends in a colon when conditions follow. */
  what(
    facts: SpokenReadFacts,
    conditionsFollow: boolean,
    position?: SpokenQueuePosition,
  ): string;
  where(places: string[]): string;
  condition(condition: SpokenCondition): string;
  /** Conditions on screen only: counted, or how many when said ones came first. */
  moreConditions(count: number | "unknown", afterSaid: boolean): string;
  limit(limit: number, kind: GistKind): string;
}

/** Conditions said before the rest are counted. */
const MAX_SPOKEN_CONDITIONS = 3;
/** Names of items said. */
const MAX_SPOKEN_NAMES = 3;
/** A search text or a value over this many words is counted, not said. */
const MAX_SAID_WORDS = 15;
const MAX_NAME_CHARS = 90;

const OPERATORS: readonly SpokenCondition["operator"][] = [
  "equals",
  "not_equals",
  "less",
  "at_most",
  "greater",
  "at_least",
  "contains",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
  "in",
  "not_in",
  "between",
];

const NO_VALUES: readonly string[] = ["is_empty", "is_not_empty"];

interface ReadValue {
  text: string;
  resolved?: string;
  machineId: boolean;
}

const readValues = (
  slot: unknown,
): { values: ReadValue[]; omitted: number } => {
  if (!isRecord(slot) || !Array.isArray(slot.values)) {
    return { values: [], omitted: 0 };
  }
  const values = slot.values.flatMap((raw): ReadValue[] => {
    if (!isRecord(raw)) return [];
    const text = cleanServerText(raw.text, MAX_NAME_CHARS * 4).text;
    const resolved = cleanServerText(raw.resolved, MAX_NAME_CHARS * 4).text;
    if (text.length === 0) return [];
    return [
      {
        text,
        resolved: resolved.length > 0 ? resolved : undefined,
        machineId: raw.machine_id === true || isMachineId(text),
      },
    ];
  });
  const omitted =
    typeof slot.omitted === "number" && slot.omitted > 0 ? slot.omitted : 0;
  return { values, omitted };
};

/** A web address is said by its host; anything else holding a slash or an ID only by its name. */
const sayableText = (text: string): string | undefined => {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      return new URL(text).host || undefined;
    } catch {
      return undefined;
    }
  }
  const segments = text.split(/[/()]/).filter((part) => part.length > 0);
  return segments.some(isMachineId) ? undefined : text;
};

/** A value as the voice may say it: never a machine ID, only its name. */
const earOf = (
  value: ReadValue,
  timeZone?: string,
  spoken?: string,
): EarValue => {
  if (value.resolved) return { kind: "text", text: value.resolved };
  if (value.machineId) return { kind: "unread" };
  if (spoken !== undefined) return { kind: "text", text: spoken };
  const text = sayableText(value.text);
  return text === undefined ? { kind: "id" } : earValue(text, { timeZone });
};

const nameOf = (value: ReadValue): string | undefined =>
  value.resolved ?? (value.machineId ? undefined : sayableText(value.text));

const words = (text: string): number =>
  text.split(/\s+/).filter((word) => word.length > 0).length;

const conditionsOf = (
  raw: unknown,
  timeZone?: string,
  names?: SpokenNames,
): { said: SpokenCondition[]; unsaid: number } => {
  if (!Array.isArray(raw)) return { said: [], unsaid: 0 };
  let unsaid = 0;
  const said = raw.flatMap((entry): SpokenCondition[] => {
    const operator = isRecord(entry) ? entry.operator : undefined;
    const column = isRecord(entry)
      ? cleanServerText(entry.column, MAX_NAME_CHARS).text
      : "";
    const known = OPERATORS.find((candidate) => candidate === operator);
    const { values, omitted } = readValues(entry);
    const wanted =
      known === "between" ? 2 : known && NO_VALUES.includes(known) ? 0 : 1;
    if (!known || column.length === 0 || values.length < wanted) {
      unsaid += 1;
      return [];
    }
    const extra =
      isRecord(entry) &&
      typeof entry.values_omitted === "number" &&
      entry.values_omitted > 0
        ? entry.values_omitted
        : 0;
    const longest = Math.max(
      0,
      ...values.map((value) => (value.machineId ? 0 : words(value.text))),
    );
    const table = isRecord(entry)
      ? cleanServerText(entry.table, MAX_NAME_CHARS).text
      : "";
    const heard = spokenFieldName(names, column);
    return [
      {
        column: heard ?? column,
        ...(heard === undefined ? {} : { cardColumn: column }),
        ...(table.length > 0 ? { table } : {}),
        operator: known,
        values: values.map((value) =>
          earOf(
            value,
            timeZone,
            value.machineId || value.resolved
              ? undefined
              : spokenChoice(names, column, value.text),
          ),
        ),
        valuesOmitted: omitted + extra,
        ...(longest > MAX_SAID_WORDS ? { longWords: longest } : {}),
      },
    ];
  });
  return { said, unsaid };
};

const kindOf = (raw: unknown): GistKind =>
  GIST_KINDS.find((kind) => kind === raw) ?? "other";

/**
 * The facts of a read description, or `undefined` when the label has none
 * or its verb is one the read cannot stand beside: a read is described only
 * where the card itself has no verb, or runs the statement it describes.
 */
export const spokenReadFactsOf = (
  label: ToolCallLabel | null | undefined,
  server?: string,
  timeZone?: string,
  spokenNames?: SpokenNames,
): SpokenReadFacts | undefined => {
  if (!label || (label.action !== "other" && label.action !== "run")) {
    return undefined;
  }
  const read: unknown = label.read;
  if (!isRecord(read)) return undefined;
  const item = isRecord(read.item) ? read.item : {};
  const title = readValues(item.title);
  const ids = readValues(item.id);
  const target = readValues(item.target);
  const query = isRecord(read.query) ? read.query : undefined;
  const kind = kindOf(read.object_kind);
  const tables =
    query && Array.isArray(query.tables)
      ? query.tables
          .map((table) => cleanServerText(table, MAX_NAME_CHARS).text)
          .filter((table) => table.length > 0)
      : [];
  const { said, unsaid } = conditionsOf(
    query?.conditions,
    timeZone,
    spokenNames,
  );
  const tablesOmitted =
    query && typeof query.tables_omitted === "number"
      ? query.tables_omitted
      : 0;
  const things =
    tables.length === 1 && tablesOmitted === 0
      ? spokenTableName(spokenNames, tables[0])
      : undefined;
  const queryOmitted =
    query && typeof query.conditions_omitted === "number"
      ? query.conditions_omitted
      : 0;
  const filtered = read.filtered === true;
  const searchText = title.values.map((value) => value.text).join(" ");
  const names = ids.values.flatMap((value) => nameOf(value) ?? []);
  const count = ids.values.length + ids.omitted;
  const shape: SpokenReadShape =
    searchText.length > 0 ? "search" : count > 0 ? "items" : "list";
  const omitted = unsaid + queryOmitted;
  return {
    shape,
    kind,
    server,
    search:
      shape !== "search"
        ? undefined
        : words(searchText) > MAX_SAID_WORDS || title.omitted > 0
          ? { words: words(searchText) }
          : { text: searchText },
    names: names.slice(0, MAX_SPOKEN_NAMES),
    count,
    unread:
      count === 1 && names.length === 0 && ids.values[0]?.machineId === true,
    where: target.values.flatMap((value) => nameOf(value) ?? []),
    // A table named like the kind ("task") says nothing the kind does not.
    tables:
      things !== undefined ||
      (tables.length === 1 && kind !== "row" && kind !== "other")
        ? []
        : tables,
    tablesOmitted,
    ...(things === undefined ? {} : { things }),
    conditions: said,
    conditionsOmitted: query === undefined && filtered ? "unknown" : omitted,
    limit:
      query && typeof query.limit === "number" && query.limit > 0
        ? query.limit
        : undefined,
  };
};

const text = (slot: SpokenSource["slot"], value: string): SpokenSource => ({
  slot,
  value: { kind: "text", text: value },
});
const number = (slot: SpokenSource["slot"], value: number): SpokenSource => ({
  slot,
  value: { kind: "number", value, percent: false },
});

type ReadPiece = ComposedPiece;

const piece = (
  role: SpokenPieceRole,
  pieceText: string,
  values: SpokenSource[],
): ReadPiece => ({ role, text: pieceText, mustSay: false, values });

/** The pieces before the request to decide; a read loses nothing, so none must be said. */
export const spokenReadPieces = (
  facts: SpokenReadFacts,
  readWords: SpokenReadWords,
  position?: SpokenQueuePosition,
): ReadPiece[] => {
  const said = facts.conditions.slice(0, MAX_SPOKEN_CONDITIONS);
  const unsaid =
    facts.conditionsOmitted === "unknown"
      ? "unknown"
      : facts.conditionsOmitted + facts.conditions.length - said.length;
  const pieces: ReadPiece[] = [
    piece("what", readWords.what(facts, said.length > 0, position), [
      ...(facts.server ? [text("server", facts.server)] : []),
      ...(facts.search && "text" in facts.search
        ? [text("text", facts.search.text)]
        : facts.search
          ? [number("words", facts.search.words)]
          : []),
      ...(facts.count > 1 ? [number("count", facts.count)] : []),
      ...facts.names.map((name) => text("name", name)),
      ...facts.tables.map((table) => text("place", table)),
      ...(facts.things ? [text("place", facts.things)] : []),
    ]),
  ];
  if (facts.where.length > 0) {
    pieces.push(
      piece(
        "detail",
        readWords.where(facts.where),
        facts.where.map((place) => text("place", place)),
      ),
    );
  }
  for (const condition of said) {
    pieces.push({
      ...piece("detail", readWords.condition(condition), [
        text("field", condition.column),
        ...(condition.table ? [text("place", condition.table)] : []),
        ...condition.values.map((value) => ({ slot: "value" as const, value })),
      ]),
      ...(condition.cardColumn ? { idField: condition.cardColumn } : {}),
    });
  }
  if (unsaid === "unknown" || unsaid > 0) {
    pieces.push(
      piece(
        "more",
        readWords.moreConditions(unsaid, said.length > 0),
        unsaid === "unknown" ? [] : [number("count", unsaid)],
      ),
    );
  }
  if (facts.limit !== undefined) {
    pieces.push(
      piece("detail", readWords.limit(facts.limit, facts.kind), [
        number("count", facts.limit),
      ]),
    );
  }
  return pieces;
};
