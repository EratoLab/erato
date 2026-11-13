import { changeLayout } from "./change";

import type {
  ChangeBatch,
  ChangeBatchField,
  ChangeEffect,
  ChangeValue,
  GistChange,
} from "./change";
import type { Gist, GistAction, GistItem, GistKind, GistValue } from "./gist";
import type { ToolCallChangeNote } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Where an approval card puts what it knows: the source line, the headline,
 * the notes in the slot of what they qualify. Shared by the change card and
 * the gist card so both read in the same order.
 */

/* eslint-disable lingui/no-unlocalized-strings -- API enum values */
/** Verbs whose destination is where the item lives, not where it goes. */
const PLACE_ACTIONS: readonly GistAction[] = [
  "create",
  "update",
  "delete",
  "comment",
  "share",
  "run",
  "upsert",
  "archive",
];

/** Facts about the tool rather than the call: said in the decision area. */
export const TOOL_NOTES: readonly ToolCallChangeNote[] = [
  "marked_destructive",
  "operator_marked_destructive",
];
const QUALIFIER_NOTES: readonly ToolCallChangeNote[] = [
  "tool_says_permanent",
  "tool_says_restorable",
  "delete_outcome_unknown",
  "nothing_changes",
];
const LIST_NOTES: readonly ToolCallChangeNote[] = [
  "tool_says_replaces_list",
  "list_replace_unknown",
];
const STATEMENT_NOTES: readonly ToolCallChangeNote[] = [
  "row_count_unknown",
  "instruction_outcome_unknown",
];
export const OLD_VALUES_NOTE: ToolCallChangeNote = "old_values_from_earlier";
/* eslint-enable lingui/no-unlocalized-strings */

/**
 * Whether a table is named in the source line, so the headline calls its
 * record a record: a table's rows, and items counted where the table is no
 * noun of its own. A single item of a type the call names keeps the type.
 */
export const tableGoesToSource = (
  kind: GistKind,
  count: number,
  table: string | undefined,
): boolean =>
  table !== undefined &&
  table.length > 0 &&
  (kind === "row" || (kind === "other" && count !== 1));

/**
 * A delete the card can only call "item" may delete the place's own record,
 * such as a repository of an owner, so its headline keeps the place: it then
 * names exactly what goes.
 */
const deletesUnnamedKind = (gist: Gist): boolean =>
  gist.action === "delete" && gist.kind === "other" && !gist.change?.table;

/** Whether the one item's place moves from the headline to the source line. */
export const movesPlace = (gist: Gist, item: GistItem): boolean =>
  gist.items.length === 1 &&
  gist.items[0] === item &&
  PLACE_ACTIONS.includes(gist.action) &&
  !deletesUnnamedKind(gist) &&
  item.where.length > 0;

const addressKey = (text: string) => text.trim().toLowerCase();

/**
 * Whether a send's destination is only the recipients the card lists in
 * their own group, so the headline needs none of them.
 */
const sendsToListedRecipients = (gist: Gist, item: GistItem): boolean => {
  const recipients = gist.change?.recipients;
  if (gist.action !== "send" || !recipients || item.where.length === 0) {
    return false;
  }
  const listed = new Set(
    recipients.groups.flatMap((group) => group.values.map(addressKey)),
  );
  return item.where.every((value) =>
    listed.has(addressKey(value.written ?? value.text)),
  );
};

/**
 * The item as its headline names it: without the recipients the card lists
 * in their own group, and without its place where the card's source line
 * names it (`placeInSource`).
 */
export const headlineItemOf = (
  gist: Gist,
  item: GistItem,
  placeInSource = false,
): GistItem =>
  (placeInSource && movesPlace(gist, item)) ||
  sendsToListedRecipients(gist, item)
    ? { ...item, where: [], whereOmitted: 0 }
    : item;

export interface CardSource {
  /** The place the one item lives, each name once. */
  where: GistValue[];
  /** Places not listed, each counted once: never values that repeat a listed one. */
  whereOmitted: number;
  /**
   * How many values the place is read from, where the listed ones repeat and
   * the unlisted ones cannot be counted as places: rows of a batch, else values.
   */
  whereValues?: { count: number; rows: boolean };
  table?: string;
}

/**
 * The places once each: two values that read alike but write different IDs
 * are two places, and only the call's place gives way to a value of the same
 * name.
 */
const distinctPlaces = (where: readonly GistValue[]): GistValue[] => {
  const seen = new Set<string>();
  const distinct = where.filter((value) => {
    const key = JSON.stringify([
      value.text.trim(),
      value.written ?? null,
      value.origin,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const named = new Set(
    distinct
      .filter((value) => value.origin !== "place")
      .map((value) => value.text.trim()),
  );
  return distinct.filter(
    (value) => value.origin !== "place" || !named.has(value.text.trim()),
  );
};

/**
 * The batch field a row-by-row place is written to, found by the path of a
 * listed place, so its distinct count can count the unlisted places.
 */
const placeFieldOf = (
  batch: ChangeBatch | undefined,
  where: readonly GistValue[],
): ChangeBatchField | undefined => {
  if (!batch) return undefined;
  const paths = new Set(where.flatMap((value) => value.path || []));
  const effect = batch.rows
    .flatMap((row) => row.effects)
    .find((rowEffect) => paths.has(rowEffect.path));
  return effect
    ? batch.fields.find(
        (field) =>
          field.rawName === effect.rawName && field.name === effect.name,
      )
    : undefined;
};

/**
 * What the source line says about places it does not list. A count of
 * unlisted values that repeat listed ones would read as more places, so it
 * gives way to the distinct places a batch counted, or else to how many
 * values the place is read from.
 */
const unlistedPlaces = (
  gist: Gist,
  lead: GistItem,
  where: readonly GistValue[],
): Pick<CardSource, "whereOmitted" | "whereValues"> => {
  if (where.length === 0 || lead.whereOmitted === 0) {
    return { whereOmitted: 0 };
  }
  if (where.length === lead.where.length) {
    return { whereOmitted: lead.whereOmitted };
  }
  const batch = gist.change?.batch;
  const field = placeFieldOf(batch, lead.where);
  if (field && !field.distinctCapped) {
    return { whereOmitted: Math.max(field.distinct - where.length, 0) };
  }
  return {
    whereOmitted: 0,
    whereValues: {
      count: lead.where.length + lead.whereOmitted,
      rows: batch !== undefined,
    },
  };
};

/** What the source line names after the server, or nothing. */
export const cardSourceOf = (gist: Gist): CardSource | undefined => {
  const lead = gist.items[0] as GistItem | undefined;
  if (!lead) return undefined;
  const where = movesPlace(gist, lead) ? distinctPlaces(lead.where) : [];
  const table = gist.change?.table;
  const named = tableGoesToSource(gist.kind, lead.count, table)
    ? table
    : undefined;
  if (where.length === 0 && named === undefined) return undefined;
  return {
    where,
    ...unlistedPlaces(gist, lead, where),
    table: named,
  };
};

export interface NotePlaces {
  /** Under the headline: what a delete does, and that nothing changes. */
  qualifier: ToolCallChangeNote[];
  /** Under the list rows they are about. */
  lists: ToolCallChangeNote[];
  /** Under the statement or instruction they are about. */
  statement: ToolCallChangeNote[];
  /** The card's one footnote. */
  footnote: ToolCallChangeNote[];
}

/** Where each of a change's notes is said; facts about the tool are in none. */
export const notePlacesOf = (change: GistChange): NotePlaces => {
  const places: NotePlaces = {
    qualifier: [],
    lists: [],
    statement: [],
    footnote: [],
  };
  const hasLists = changeLayout(change).lists.length > 0;
  const hasStatement = change.opaque.length > 0;
  for (const note of change.notes) {
    if (TOOL_NOTES.includes(note)) continue;
    if (QUALIFIER_NOTES.includes(note)) places.qualifier.push(note);
    else if (hasLists && LIST_NOTES.includes(note)) places.lists.push(note);
    else if (hasStatement && STATEMENT_NOTES.includes(note)) {
      places.statement.push(note);
    } else places.footnote.push(note);
  }
  return places;
};

const isDotted = (value: GistValue) =>
  value.origin === "resolved" || value.origin === "earlier";

const meansEarlier = (value: ChangeValue | undefined) =>
  value?.meaning?.source === "earlier";

const effectIsDotted = (effect: ChangeEffect) =>
  [
    ...effect.values,
    ...effect.removed,
    ...effect.kept,
    ...effect.added,
    effect.old,
  ].some(meansEarlier);

/**
 * Whether the card underlines a value as one from an earlier result: a name
 * read earlier, an earlier value, or a code's meaning an earlier read gave.
 */
export const showsEarlierValues = (gist: Gist): boolean => {
  const { change } = gist;
  if (change) {
    // A change card shows its items' lines and the change, never their fields.
    const inLines = gist.items.some((item) =>
      [...item.names, ...headlineItemOf(gist, item).where].some(isDotted),
    );
    return (
      inLines ||
      change.effects.some(effectIsDotted) ||
      (change.batch?.shared.some(effectIsDotted) ?? false) ||
      (change.batch?.rows.some((row) => row.effects.some(effectIsDotted)) ??
        false)
    );
  }
  return gist.items.some(
    (item) =>
      [...item.names, ...item.where, ...item.before, ...item.after].some(
        isDotted,
      ) ||
      item.fields.some((field) =>
        field.values.some(
          ({ value, earlier }) => earlier !== undefined || isDotted(value),
        ),
      ),
  );
};

/** The name without a last word "ID", or the name as it is; no regex, so no backtracking. */
const withoutTrailingId = (name: string): string => {
  if (name.slice(-2).toLowerCase() !== "id") return name;
  const before = name.slice(0, -2);
  const trimmed = before.trimEnd();
  return trimmed.length < before.length ? trimmed : name;
};

/**
 * A field's name on its row. A link that shows the linked record's name
 * drops a trailing "ID": the row shows a name, not an ID.
 */
export const effectDisplayName = (effect: ChangeEffect): string => {
  const [value] = effect.values;
  const showsName =
    effect.link &&
    effect.values.length === 1 &&
    value.machineId &&
    value.text.length > 0;
  if (!showsName) return effect.name;
  const trimmed = withoutTrailingId(effect.name);
  return trimmed.length > 0 ? trimmed : effect.name;
};
