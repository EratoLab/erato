import { cleanServerText, countOf, isRecord } from "./serverText";

import type {
  ToolCallAction,
  ToolCallChangeNote,
  ToolCallEffectKind,
  ToolCallOpaqueKind,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The change description a label carries, read as data whatever its type
 * says: anything this build cannot read counts as absent, and a label without
 * one renders as it did before.
 */

export interface ChangeValue {
  text: string;
  truncated: boolean;
  /** A machine identifier: `text` is its name, or empty when none is known. */
  machineId: boolean;
}

export interface ChangeEffect {
  path: string;
  name: string;
  rawName: string;
  effect: ToolCallEffectKind;
  values: ChangeValue[];
  omitted: number;
  old?: ChangeValue;
  removed: ChangeValue[];
  kept: ChangeValue[];
  link: boolean;
}

export interface ChangeText {
  path: string;
  name: string;
  rawName: string;
  text: string;
  truncated: boolean;
  lines: number;
  chars: number;
  before?: ChangeValue;
}

export interface ChangeRecipientGroup {
  name: string;
  rawName: string;
  count: number;
  values: string[];
  omitted: number;
}

export interface ChangeRecipients {
  total: number;
  groups: ChangeRecipientGroup[];
  outside: string[];
  outsideOmitted: number;
  outsideKnown: boolean;
  unchecked: number;
}

export interface ChangeFilter {
  everyRecord: boolean;
  parts: { name: string; value: ChangeValue }[];
  text?: ChangeValue;
}

export interface ChangeFlag {
  name: string;
  rawName: string;
  dryRun: boolean;
}

export interface ChangeOpaque {
  kind: ToolCallOpaqueKind;
  name: string;
  rawName: string;
  path: string;
  text: string;
  truncated: boolean;
  lines: number;
  found: string[];
  writeInsideRead: boolean;
}

export interface ChangeBatchRow {
  number: number;
  name?: string;
  action?: ToolCallAction;
  effects: ChangeEffect[];
}

export interface ChangeBatchField {
  name: string;
  rawName: string;
  rows: number;
  emptied: number;
  listsReplaced: number;
  distinct: number;
  distinctCapped: boolean;
  samples: ChangeValue[];
}

export interface ChangeBatch {
  name: string;
  total: number;
  sameChange: boolean;
  shared: ChangeEffect[];
  rows: ChangeBatchRow[];
  deletions: number;
  rowsEmptying: number;
  rowsReplacingLists: number;
  operations: { action: ToolCallAction; count: number }[];
  fields: ChangeBatchField[];
  fieldsOmitted: number;
  readAll: boolean;
}

export interface ChangeCounts {
  emptied: number;
  listReplaced: number;
  changed: number;
  set: number;
  unchanged: number;
  unreadable: number;
}

export interface GistChange {
  effects: ChangeEffect[];
  counts: ChangeCounts;
  texts: ChangeText[];
  recipients?: ChangeRecipients;
  filter?: ChangeFilter;
  flags: ChangeFlag[];
  opaque: ChangeOpaque[];
  batch?: ChangeBatch;
  place?: string;
  notes: ToolCallChangeNote[];
  complete: boolean;
  consentLeftOut: boolean;
  /** Whether cleaning here removed hidden characters the backend kept. */
  hiddenCharacters: boolean;
}

/* eslint-disable lingui/no-unlocalized-strings -- API enum values */
const EFFECT_KINDS: readonly ToolCallEffectKind[] = [
  "emptied",
  "list_replaced",
  "changed",
  "set",
  "unchanged",
  "unreadable",
];
const OPAQUE_KINDS: readonly ToolCallOpaqueKind[] = [
  "sql",
  "shell",
  "code",
  "instruction",
];
const CHANGE_NOTES: readonly ToolCallChangeNote[] = [
  "marked_destructive",
  "delete_outcome_unknown",
  "tool_says_permanent",
  "tool_says_restorable",
  "tool_says_replaces_list",
  "tool_says_adds_to_list",
  "list_replace_unknown",
  "tool_says_ignored_if_missing",
  "row_count_unknown",
  "instruction_outcome_unknown",
  "old_values_from_earlier",
  "nothing_changes",
];
const ROW_ACTIONS: readonly ToolCallAction[] = [
  "create",
  "update",
  "delete",
  "move",
  "send",
  "comment",
  "share",
  "run",
  "upsert",
  "archive",
  "upload",
];
/* eslint-enable lingui/no-unlocalized-strings */

const MAX_EFFECTS = 256;
const MAX_LIST_VALUES = 256;
const MAX_ROWS = 64;
const MAX_GROUPS = 16;
const MAX_NOTES = 16;
const MAX_FOUND = 16;
const MAX_STORED_TEXT_CHARS = 4_000;

const listOf = (value: unknown, max: number): readonly unknown[] =>
  Array.isArray(value) ? value.slice(0, max) : [];

const isOneOf = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T => typeof value === "string" && values.some((v) => v === value);

/** Reads text and remembers whether cleaning it changed it invisibly. */
class Reader {
  hiddenCharacters = false;

  text(raw: unknown, maxChars?: number): string {
    const cleaned = cleanServerText(raw, maxChars);
    this.hiddenCharacters ||= cleaned.hiddenCharacters;
    return cleaned.text;
  }

  value(raw: unknown): ChangeValue | undefined {
    if (!isRecord(raw)) return undefined;
    const cleaned = cleanServerText(raw.text);
    this.hiddenCharacters ||= cleaned.hiddenCharacters;
    return {
      text: cleaned.text,
      truncated: raw.truncated === true || cleaned.truncated,
      machineId: raw.machine_id === true,
    };
  }

  values(raw: unknown, max: number): ChangeValue[] {
    return listOf(raw, max).flatMap((entry) => {
      const value = this.value(entry);
      return value ? [value] : [];
    });
  }

  effect(raw: unknown): ChangeEffect | undefined {
    if (!isRecord(raw) || typeof raw.path !== "string") return undefined;
    return {
      path: raw.path,
      name: this.text(raw.name),
      rawName: this.text(raw.raw_name),
      effect: isOneOf(EFFECT_KINDS, raw.effect) ? raw.effect : "unreadable",
      values: this.values(raw.values, MAX_LIST_VALUES),
      omitted: countOf(raw.omitted),
      old: this.value(raw.old),
      removed: this.values(raw.removed, MAX_LIST_VALUES),
      kept: this.values(raw.kept, MAX_LIST_VALUES),
      link: raw.link === true,
    };
  }

  effects(raw: unknown, max: number): ChangeEffect[] {
    return listOf(raw, max).flatMap((entry) => {
      const effect = this.effect(entry);
      return effect ? [effect] : [];
    });
  }

  texts(raw: unknown): ChangeText[] {
    return listOf(raw, MAX_EFFECTS).flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.path !== "string") return [];
      const text = cleanServerText(entry.text, MAX_STORED_TEXT_CHARS);
      this.hiddenCharacters ||= text.hiddenCharacters;
      return [
        {
          path: entry.path,
          name: this.text(entry.name),
          rawName: this.text(entry.raw_name),
          text: text.text,
          truncated: entry.truncated === true || text.truncated,
          lines: countOf(entry.lines),
          chars: countOf(entry.chars),
          before: this.value(entry.before),
        },
      ];
    });
  }

  recipients(raw: unknown): ChangeRecipients | undefined {
    if (!isRecord(raw)) return undefined;
    return {
      total: countOf(raw.total),
      groups: listOf(raw.groups, MAX_GROUPS).flatMap((group) =>
        isRecord(group)
          ? [
              {
                name: this.text(group.name),
                rawName: this.text(group.raw_name),
                count: countOf(group.count),
                values: listOf(group.values, MAX_LIST_VALUES).map((value) =>
                  this.text(value),
                ),
                omitted: countOf(group.omitted),
              },
            ]
          : [],
      ),
      outside: listOf(raw.outside, MAX_LIST_VALUES).map((value) =>
        this.text(value),
      ),
      outsideOmitted: countOf(raw.outside_omitted),
      outsideKnown: raw.outside_known === true,
      unchecked: countOf(raw.unchecked),
    };
  }

  filter(raw: unknown): ChangeFilter | undefined {
    if (!isRecord(raw)) return undefined;
    return {
      everyRecord: raw.every_record === true,
      parts: listOf(raw.parts, MAX_GROUPS).flatMap((part) => {
        if (!isRecord(part)) return [];
        const value = this.value(part.value);
        return value ? [{ name: this.text(part.name), value }] : [];
      }),
      text: this.value(raw.text),
    };
  }

  opaque(raw: unknown): ChangeOpaque[] {
    return listOf(raw, MAX_GROUPS).flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.path !== "string") return [];
      const text = cleanServerText(entry.text, MAX_STORED_TEXT_CHARS);
      this.hiddenCharacters ||= text.hiddenCharacters;
      return [
        {
          kind: isOneOf(OPAQUE_KINDS, entry.kind) ? entry.kind : "code",
          name: this.text(entry.name),
          rawName: this.text(entry.raw_name),
          path: entry.path,
          text: text.text,
          truncated: entry.truncated === true || text.truncated,
          lines: countOf(entry.lines),
          found: listOf(entry.found, MAX_FOUND).map((word) => this.text(word)),
          writeInsideRead: entry.write_inside_read === true,
        },
      ];
    });
  }

  batch(raw: unknown): ChangeBatch | undefined {
    if (!isRecord(raw)) return undefined;
    return {
      name: this.text(raw.name),
      total: countOf(raw.total),
      sameChange: raw.same_change === true,
      shared: this.effects(raw.shared, MAX_EFFECTS),
      rows: listOf(raw.rows, MAX_ROWS).flatMap((row) => {
        if (!isRecord(row)) return [];
        const name = this.text(row.name);
        return [
          {
            number: countOf(row.number),
            name: name.length > 0 ? name : undefined,
            action: isOneOf(ROW_ACTIONS, row.action) ? row.action : undefined,
            effects: this.effects(row.effects, MAX_EFFECTS),
          },
        ];
      }),
      deletions: countOf(raw.deletions),
      rowsEmptying: countOf(raw.rows_emptying),
      rowsReplacingLists: countOf(raw.rows_replacing_lists),
      operations: listOf(raw.operations, MAX_GROUPS).flatMap((operation) =>
        isRecord(operation) && isOneOf(ROW_ACTIONS, operation.action)
          ? [{ action: operation.action, count: countOf(operation.count) }]
          : [],
      ),
      fields: listOf(raw.fields, MAX_LIST_VALUES).flatMap((field) =>
        isRecord(field)
          ? [
              {
                name: this.text(field.name),
                rawName: this.text(field.raw_name),
                rows: countOf(field.rows),
                emptied: countOf(field.emptied),
                listsReplaced: countOf(field.lists_replaced),
                distinct: countOf(field.distinct),
                distinctCapped: field.distinct_capped === true,
                samples: this.values(field.samples, MAX_FOUND),
              },
            ]
          : [],
      ),
      fieldsOmitted: countOf(raw.fields_omitted),
      readAll: raw.read_all === true,
    };
  }
}

const countsOf = (raw: unknown): ChangeCounts => {
  const counts = isRecord(raw) ? raw : {};
  return {
    emptied: countOf(counts.emptied),
    listReplaced: countOf(counts.list_replaced),
    changed: countOf(counts.changed),
    set: countOf(counts.set),
    unchanged: countOf(counts.unchanged),
    unreadable: countOf(counts.unreadable),
  };
};

/** A label's change description, or `undefined` when it has none. */
export const readChange = (raw: unknown): GistChange | undefined => {
  if (!isRecord(raw)) return undefined;
  const reader = new Reader();
  const change = {
    effects: reader.effects(raw.effects, MAX_EFFECTS),
    counts: countsOf(raw.counts),
    texts: reader.texts(raw.texts),
    recipients: reader.recipients(raw.recipients),
    filter: reader.filter(raw.filter),
    flags: listOf(raw.flags, MAX_GROUPS).flatMap((flag) =>
      isRecord(flag)
        ? [
            {
              name: reader.text(flag.name),
              rawName: reader.text(flag.raw_name),
              dryRun: flag.dry_run === true,
            },
          ]
        : [],
    ),
    opaque: reader.opaque(raw.opaque),
    batch: reader.batch(raw.batch),
    place: typeof raw.place === "string" ? reader.text(raw.place) : undefined,
    notes: listOf(raw.notes, MAX_NOTES).filter(
      (note): note is ToolCallChangeNote => isOneOf(CHANGE_NOTES, note),
    ),
    complete: raw.complete === true,
    consentLeftOut: raw.consent_left_out === true,
  };
  return { ...change, hiddenCharacters: reader.hiddenCharacters };
};

/** Values shown below the losses; the number is a starting point, not measured. */
export const MAX_FIRST_VIEW_VALUES = 5;
/** Rows of a batch in the first view. */
export const MAX_FIRST_VIEW_ROWS = 5;
/** Lines of a statement or instruction before it collapses. */
export const STATEMENT_LINES = 10;
/** Fields of a batch stated one by one in the first view. */
export const MAX_FIRST_VIEW_BATCH_FIELDS = 6;
/** Lines of long text before it collapses. */
export const TEXT_LINES = 6;
/** Names listed in a collapsed part before the rest are counted. */
export const MAX_COLLAPSED_NAMES = 8;

const RANKED: readonly ToolCallEffectKind[] = ["changed", "set", "unchanged"];
// eslint-disable-next-line lingui/no-unlocalized-strings -- API enum value
const LIST_REPLACED: ToolCallEffectKind = "list_replaced";

export interface ChangeLayout {
  emptied: ChangeEffect[];
  lists: ChangeEffect[];
  unreadable: ChangeEffect[];
  /** At most `MAX_FIRST_VIEW_VALUES`, changed before set before unchanged. */
  firstRows: ChangeEffect[];
  collapsed: ChangeEffect[];
  /** Values read but not stored: counted, and only in Technical details. */
  beyondCap: number;
  /** The collapsed part holds what code could not classify. */
  opensByDefault: boolean;
}

const totalOf = (counts: ChangeCounts): number =>
  counts.emptied +
  counts.listReplaced +
  counts.changed +
  counts.set +
  counts.unchanged +
  counts.unreadable;

/**
 * What goes where on the card, by what happens to each value and never by a
 * field's name: losses and what cannot be read are always in the first view,
 * then the most consequential values up to the budget.
 */
export const changeLayout = (change: GistChange): ChangeLayout => {
  const byKind = (kind: ToolCallEffectKind) =>
    change.effects.filter((effect) => effect.effect === kind);
  const ranked = RANKED.flatMap(byKind);
  const firstRows = ranked.slice(0, MAX_FIRST_VIEW_VALUES);
  const collapsed = ranked.slice(MAX_FIRST_VIEW_VALUES);
  const beyondCap = Math.max(totalOf(change.counts) - change.effects.length, 0);
  return {
    emptied: byKind("emptied"),
    lists: byKind(LIST_REPLACED),
    unreadable: byKind("unreadable"),
    firstRows,
    collapsed,
    beyondCap,
    opensByDefault: !change.complete,
  };
};

/** How many collapsed names are spelled out; the rest are counted. */
export const collapsedNames = (
  names: readonly string[],
): { shown: string[]; more: number } => ({
  shown: names.slice(0, MAX_COLLAPSED_NAMES),
  more: Math.max(names.length - MAX_COLLAPSED_NAMES, 0),
});

/** Whether a value needs the phrase for "no name known" instead of its text. */
export const hidesMachineId = (value: ChangeValue): boolean =>
  value.machineId && value.text.length === 0;

/** Whether the description says something a card should show. */
export const changeSaysSomething = (change: GistChange): boolean =>
  change.effects.length > 0 ||
  change.texts.length > 0 ||
  change.recipients !== undefined ||
  change.filter !== undefined ||
  change.flags.length > 0 ||
  change.opaque.length > 0 ||
  change.batch !== undefined ||
  change.notes.length > 0;
