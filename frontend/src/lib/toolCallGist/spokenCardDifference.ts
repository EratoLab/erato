/* eslint-disable lingui/no-unlocalized-strings -- entry keys, paths and piece roles of this module; the spoken words are in spokenCardWords */
import { toolCallCardOf } from "./gist";
import {
  detailValues,
  effectField,
  fieldName,
  recipientName,
  shorten,
  spokenApprovalPieces,
  spokenFactsOf,
  spokenPiecesOf,
  textValues,
  whatValues,
  withDictation,
} from "./spokenCard";
import { spokenWordsFor } from "./spokenCardWords";
import { spokenReadFactsOf } from "./spokenRead";
import { earValue } from "./spokenValues";

import type { ChangeEffect, ChangeValue } from "./change";
import type { Gist } from "./gist";
import type {
  ComposedPiece,
  SpokenApproval,
  SpokenFacts,
  SpokenOptions,
  SpokenPiece,
  SpokenPieceRole,
  SpokenReadOut,
  SpokenSource,
} from "./spokenCard";
import type { DifferenceIntro, LanguageWords } from "./spokenCardWords";
import type { EarValue } from "./spokenValues";

/**
 * A corrected approval card as the voice says it after a change request:
 * the item, then only what differs from the card the user withdrew, then
 * that the rest is as before. Every difference is said, and one the user's
 * words do not name is marked as not asked for. A card about another item,
 * or a withdrawn card the user hardly heard, is said in full instead.
 *
 * The two calls are compared on their values, not on what the voice says
 * about them, and their arguments are compared as well: whatever differs
 * there without a sentence of its own is still told, so the voice never
 * calls a changed call the same, or the rest unchanged.
 */

/** The card the user asked to change, as the voice left it. */
export interface WithdrawnCard {
  approval: SpokenApproval;
  /** Ids of its pieces heard in full. */
  heard: readonly string[];
  /** What the user said should be different. */
  words: string;
}

export interface SpokenDifference {
  intro: DifferenceIntro;
  pieces: SpokenPiece[];
}

/** Differences said one by one; more are counted, and stay on screen. */
const MAX_SAID_DIFFERENCES = 8;

/** A thing a card holds that a later card can hold differently. */
interface Entry {
  key: string;
  /** The id of the piece that said it on a card, for what was heard. */
  heardAs: string;
  role: SpokenPieceRole;
  /** What the voice says when this differs. */
  sentence: string;
  /** What has to be equal for the entry to be unchanged: its whole values. */
  compare: string;
  /** The field it is about, for the sentence of an entry that is gone. */
  field?: string;
  mustSay: boolean;
  values: SpokenSource[];
  readOut?: SpokenReadOut;
  /**
   * Where in the call's arguments it sits: a path covers what lies below
   * it, a path starting with `=` only itself.
   */
  paths: string[];
  /** The values a user may name to ask for it. */
  said: EarValue[];
  /** A list, whose entries can be dropped by naming them. */
  list: boolean;
  /** For a long text: its words, to tell what was added or taken out. */
  words?: string;
  /**
   * Said instead of `sentence` when the withdrawn card's sentence is the
   * same although the values differ: a cut value, an address whose name
   * part did not change.
   */
  plainer?: string;
  /** For a batch: each stored row's comparison, the values that name it, and its paths. */
  rows?: { compare: string; said: EarValue[]; paths: string[] }[];
}

const pieceId = (role: SpokenPieceRole, field?: string) =>
  Array.from(field ? `${role}:${field}` : role)
    .slice(0, 60)
    .join("");

const CREATING: readonly string[] = ["create", "send", "upload"];

type Call = Extract<SpokenApproval, { type: "call" }>;

interface LabelSlot {
  values?: { path?: string | null; text?: string | null }[] | null;
}
interface LabelItems {
  items?: { id?: LabelSlot | null; target?: LabelSlot | null }[] | null;
}

/**
 * The raw identifiers the label gives the item: its IDs, which a card shows
 * by name or not at all, and for anything that exists, its target.
 */
const identifiersOf = (call: Call, creating: boolean) =>
  ((call.label as LabelItems | null | undefined)?.items ?? []).map((item) =>
    [item.id, creating ? null : item.target].map((slot) =>
      (slot?.values ?? []).map((value) => `${value.path}=${value.text}`),
    ),
  );

/** What the call acts on: when this differs, the card is about another item. */
const identityOf = (gist: Gist, call: Call): string => {
  const lead = gist.items[0];
  const creating = CREATING.includes(gist.action);
  const named = (values: typeof lead.names) =>
    values.map((value) => `${value.origin}:${value.written ?? value.text}`);
  return JSON.stringify([
    gist.action,
    gist.kind,
    call.server ?? "",
    lead.count,
    // Where a message goes is its recipients, compared on their own.
    gist.change?.recipients ? [] : named(lead.where),
    gist.change?.opaque[0]?.kind ?? "",
    creating ? [] : named(lead.names),
    lead.hiddenIdPaths,
    identifiersOf(call, creating),
  ]);
};

const textValue = (text: string): EarValue => ({ kind: "text", text });

const sourceOf = (slot: SpokenSource["slot"], text: string): SpokenSource => ({
  slot,
  value: textValue(text),
});

/** A value as a user may say it. */
const earOf = (value: ChangeValue, timeZone?: string): EarValue =>
  value.meaning
    ? textValue(value.meaning.label)
    : value.machineId
      ? textValue(value.text)
      : earValue(value.text, { percent: false, timeZone });

const wholeValue = (value: ChangeValue | undefined) =>
  value === undefined
    ? null
    : [value.text, value.truncated, value.machineId, value.meaning?.label];

const effectCompare = (effect: ChangeEffect) => [
  effect.effect,
  effect.values.map(wholeValue),
  wholeValue(effect.old),
  effect.removed.map(wholeValue),
  effect.added.map(wholeValue),
  effect.omitted,
];

const rowCompare = (row: {
  name?: string;
  action?: string;
  effects: ChangeEffect[];
  effectsOmitted: number;
}) =>
  JSON.stringify([
    row.name,
    row.action,
    row.effects.map(effectCompare),
    row.effectsOmitted,
  ]);

/**
 * The stored rows' own paths, up to each row's index: a row past them is
 * not covered, so its change is told as something else that differs.
 */
const batchPaths = (rows: readonly { effects: ChangeEffect[] }[]): string[] => [
  ...new Set(rows.flatMap(rowPaths)),
];

/** One stored row's own paths, up to its index. */
const rowPaths = (row: { effects: ChangeEffect[] }): string[] => [
  ...new Set(
    row.effects.flatMap(
      (effect) => /^(.*?\/\d+)(?:\/|$)/.exec(effect.path)?.[1] ?? [],
    ),
  ),
];

/**
 * A batch as the rows that changed, in either card: named by their values
 * and covering only their own paths, so a row that differs where its
 * summary shows nothing is still told. Any other entry as it is.
 */
const changedRows = (entry: Entry, old: Entry | undefined): Entry => {
  if (!entry.rows) return entry;
  const before = old?.rows ?? [];
  const rows = Math.max(entry.rows.length, before.length);
  const said: EarValue[] = [];
  const paths: string[] = [];
  for (let index = 0; index < rows; index++) {
    const now = entry.rows.at(index);
    const then = before.at(index);
    if (now?.compare !== then?.compare) {
      said.push(...(now?.said ?? []), ...(then?.said ?? []));
      paths.push(...(now?.paths ?? []), ...(then?.paths ?? []));
    }
  }
  return { ...entry, said, paths };
};

/** How many rows of a batch differ between two cards. */
const rowsChanged = (before: string, after: string): number => {
  const old = JSON.parse(before) as string[];
  const now = JSON.parse(after) as string[];
  let changed = Math.abs(old.length - now.length);
  for (let index = 0; index < Math.min(old.length, now.length); index++)
    if (old[index] !== now[index]) changed++;
  return Math.max(changed, 1);
};

const entriesOf = (
  gist: Gist,
  input: unknown,
  facts: SpokenFacts,
  words: LanguageWords,
  timeZone: string | undefined,
): Entry[] => {
  const entries: Entry[] = [];
  const seen = new Map<string, number>();
  const add = (entry: Entry) => {
    const occurrence = (seen.get(entry.key) ?? 0) + 1;
    seen.set(entry.key, occurrence);
    entries.push(
      occurrence === 1
        ? entry
        : { ...entry, key: `${entry.key}#${occurrence}` },
    );
  };
  const detailFor = (field: string) =>
    facts.details.find((detail) => "field" in detail && detail.field === field);
  const textFor = (field: string) =>
    facts.texts.find((text) => text.field === field);
  /**
   * A field as the voice says it: its detail, else its long text, else
   * only that it differs. `found` is false when the card says neither.
   */
  const fieldEntry = (field: string) => {
    const detail = detailFor(field);
    const text = detail ? undefined : textFor(field);
    const spoken: Pick<
      Entry,
      | "heardAs"
      | "role"
      | "sentence"
      | "field"
      | "mustSay"
      | "values"
      | "readOut"
    > = detail
      ? {
          heardAs: pieceId("detail", field),
          role: "detail",
          sentence: words.detail(detail, facts),
          field,
          mustSay: detail.loss,
          values: detailValues(detail),
        }
      : text
        ? {
            heardAs: pieceId("text", field),
            role: "text",
            sentence: words.text(text),
            field,
            mustSay: false,
            values: textValues(text),
            ...(text.read === undefined && text.full
              ? { readOut: text.full }
              : {}),
          }
        : {
            heardAs: pieceId("detail", field),
            role: "detail",
            sentence: words.difference.field(field),
            field,
            mustSay: false,
            values: [sourceOf("field", field)],
          };
    return { found: detail !== undefined || text !== undefined, spoken };
  };
  const change = gist.change;
  const lead = gist.items[0];
  const name =
    CREATING.includes(facts.action) && facts.count === 1
      ? facts.names.at(0)
      : undefined;
  /** Effects that only give a new item its name, and so have no detail. */
  const naming: string[] = [];

  for (const effect of change?.effects ?? []) {
    const { found, spoken } = fieldEntry(effectField(effect));
    if (!found && name !== undefined && effect.effect !== "unchanged") {
      naming.push(effect.path);
      continue;
    }
    add({
      key: `effect:${effect.path}`,
      ...spoken,
      plainer: words.difference.field(spoken.field ?? ""),
      compare: JSON.stringify(effectCompare(effect)),
      paths: [effect.path],
      said: [...effect.values, ...effect.added].map((value) =>
        earOf(value, timeZone),
      ),
      list: effect.list || effect.values.length > 1,
    });
  }

  for (const text of change?.texts ?? []) {
    const { spoken } = fieldEntry(fieldName(text));
    add({
      key: `text:${text.path}`,
      ...spoken,
      mustSay: false,
      compare: JSON.stringify([text.text, text.truncated, text.chars]),
      paths: [text.path],
      said: [],
      list: false,
      words: text.text,
    });
  }

  // A label without a change description: its fields as the card lists them.
  if (!change) {
    for (const field of lead.fields) {
      const { spoken } = fieldEntry(field.name);
      add({
        key: `field:${field.pointer}`,
        ...spoken,
        compare: JSON.stringify([
          field.values.map((entry) => [
            entry.value.text,
            entry.value.truncated,
            entry.earlier?.text,
          ]),
          field.omitted,
        ]),
        paths: field.values.map((entry) => entry.value.path),
        said: field.values.map((entry) =>
          earValue(entry.value.text, { percent: false, timeZone }),
        ),
        list: field.values.length > 1,
      });
    }
  }
  for (const after of change ? [] : lead.after) {
    add({
      key: `after:${after.path}`,
      heardAs: "text",
      role: "text",
      sentence: words.difference.field(""),
      compare: JSON.stringify([after.text, after.truncated]),
      mustSay: false,
      values: [],
      paths: [after.path],
      said: [],
      list: false,
      words: after.text,
    });
  }

  if (name !== undefined) {
    add({
      key: "name",
      heardAs: "item",
      role: "item",
      sentence: words.difference.title(facts.kind, name),
      compare: JSON.stringify(
        lead.names.map((value) => [
          value.written ?? value.text,
          value.truncated,
        ]),
      ),
      mustSay: true,
      values: [sourceOf("name", name)],
      paths: [...lead.names.map((value) => value.path), ...naming],
      said: [textValue(name)],
      list: false,
    });
  }

  const groups = change?.recipients?.groups ?? [];
  const sharedName = (person: string) =>
    new Set(
      groups
        .flatMap((group) => group.values)
        .filter((address) => recipientName(address) === person),
    ).size > 1;
  for (const group of groups) {
    // An address a person would call the same as another is said in full.
    const spoken = group.values.map((address) => {
      const person = recipientName(address);
      return shorten(sharedName(person) ? address : person);
    });
    add({
      key: `recipients:${group.rawName}`,
      heardAs: "what",
      role: "detail",
      sentence: words.difference.recipientsIn(
        group.kind,
        group.name,
        spoken,
        group.omitted,
      ),
      plainer: words.difference.recipientsIn(
        group.kind,
        group.name,
        group.values.map((address) => shorten(address)),
        group.omitted,
      ),
      compare: JSON.stringify([group.kind, group.values, group.omitted]),
      field: group.name,
      mustSay: true,
      values: spoken.map((recipient) => sourceOf("recipient", recipient)),
      paths: recipientPaths(input, group.rawName, group.values),
      said: group.values.map(textValue),
      list: true,
    });
  }
  if (facts.recipients) {
    const outside = words.outside(facts.recipients);
    if (outside.length > 0) {
      add({
        key: "outside",
        heardAs: "outside",
        role: "outside",
        sentence: outside,
        compare: JSON.stringify(change?.recipients?.outside ?? []),
        mustSay: true,
        values: [],
        paths: [],
        said: [],
        list: false,
      });
    }
  }

  for (const opaque of change?.opaque ?? []) {
    add({
      key: `opaque:${opaque.path}`,
      heardAs: "what",
      role: "detail",
      sentence: words.difference.statement(opaque.kind),
      compare: JSON.stringify([opaque.kind, opaque.text, opaque.truncated]),
      mustSay: true,
      values: [],
      paths: [opaque.path],
      said: [],
      list: false,
    });
  }

  if (change?.batch) {
    add({
      key: "batch",
      heardAs: "what",
      role: "detail",
      sentence: "",
      compare: JSON.stringify(change.batch.rows.map(rowCompare)),
      mustSay: true,
      values: [],
      paths: batchPaths(change.batch.rows),
      said: [],
      list: false,
      rows: change.batch.rows.map((row) => ({
        compare: rowCompare(row),
        said: [
          ...(row.name === undefined ? [] : [textValue(row.name)]),
          ...row.effects.flatMap((effect) =>
            effect.values.map((value) => earOf(value, timeZone)),
          ),
        ],
        paths: rowPaths(row),
      })),
    });
  }

  if (facts.consequences.length > 0) {
    const sentence = words.consequence(facts.consequences, facts);
    add({
      key: "consequence",
      heardAs: "consequence",
      role: "consequence",
      sentence,
      compare: sentence,
      mustSay: true,
      values: facts.consequences.map((consequence) =>
        sourceOf("consequence", consequence),
      ),
      paths: [],
      said: [],
      list: false,
    });
  }
  return entries;
};

// Comparing the calls' arguments

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const pointerKey = (key: string) =>
  key.replaceAll("~", "~0").replaceAll("/", "~1");

/**
 * A value as a described card can tell it apart: the label reads `null`
 * and a blank value as empty, and spacing as nothing. Only for a value the
 * label shows; anywhere else the raw value counts, since `null` may clear
 * something and a line break may be content.
 */
const plain = (value: unknown): unknown => {
  if (value === null) return undefined;
  if (typeof value === "string") {
    const words = value.trim().replace(/\s+/g, " ");
    return words.length === 0 ? undefined : words;
  }
  return value;
};

/**
 * Keys that only ever hold a token made anew for each request, never a
 * reference to something: compared without case, `-` and `_`. A key that
 * merely ends in "request id" (`parent_request_id`, `new_requestid`) may
 * name a record, so it is not one of them.
 */
const REQUEST_TOKEN_KEYS = new Set([
  "idempotencykey",
  "nonce",
  "clientrequestid",
  "clientrequesttoken",
  "clienttoken",
  "xrequestid",
]);
const TOKEN_VALUE =
  /^[0-9A-Za-z_-]{16,}$|^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const isRequestToken = (key: string, before: unknown, after: unknown) =>
  REQUEST_TOKEN_KEYS.has(key.toLowerCase().replace(/[-_]/g, "")) &&
  typeof before === "string" &&
  typeof after === "string" &&
  TOKEN_VALUE.test(before) &&
  TOKEN_VALUE.test(after) &&
  /\d/.test(before) &&
  /\d/.test(after);

/** How two arguments are compared; without it, on their raw values. */
interface Reading {
  /** The label shows the value at `path` as a value, so it is read plain. */
  plainAt: (path: string) => boolean;
  /** The label shows or holds `path`, so a token rule never applies there. */
  heldAt: (path: string) => boolean;
}

/**
 * The leaf paths where two arguments differ, as JSON pointers. With a
 * reading, what the label shows as a value is compared as the card can tell
 * it apart, and a token made anew for each request under a key that only
 * holds such tokens is no difference. When in doubt it counts: the voice
 * then says that something differs, never that nothing changed.
 */
export const changedPaths = (
  before: unknown,
  after: unknown,
  reading?: Reading,
  at = "",
  key = "",
): string[] => {
  const shown = reading?.plainAt(at) ?? false;
  const left = shown ? plain(before) : before;
  const right = shown ? plain(after) : after;
  if (Object.is(left, right)) return [];
  if (reading && !reading.heldAt(at) && isRequestToken(key, left, right))
    return [];
  if (
    !isObject(left) ||
    !isObject(right) ||
    Array.isArray(left) !== Array.isArray(right)
  )
    return [at];
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].flatMap((inner) =>
    changedPaths(
      left[inner],
      right[inner],
      reading,
      `${at}/${pointerKey(inner)}`,
      inner,
    ),
  );
};

interface LabelNode {
  path?: string;
  kind?: string;
  children?: LabelNode[] | null;
}
interface LabelPaths {
  arguments?: LabelNode | null;
  items?: Record<string, unknown>[] | null;
  change?: {
    effects?: { path?: string }[] | null;
    texts?: { path?: string }[] | null;
    opaque?: { path?: string }[] | null;
  } | null;
}

/**
 * What the labels of two cards show as values, and every path an item,
 * field or change of them holds. The arguments tree's own ID kinds do not
 * count as held: the backend marks every generated token as a machine ID,
 * so they would rule out the very tokens the token rule is for.
 */
const readingOf = (...labels: unknown[]): Reading => {
  const values = new Set<string>();
  const held = new Set<string>();
  const walk = (node: LabelNode | null | undefined) => {
    if (!node) return;
    if (node.kind === "value" && typeof node.path === "string")
      values.add(node.path);
    for (const child of node.children ?? []) walk(child);
  };
  const hold = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(hold);
    else if (isObject(value)) {
      if (typeof value.path === "string" && value.path.length > 0)
        held.add(value.path);
      Object.values(value).forEach(hold);
    }
  };
  for (const label of labels as (LabelPaths | null | undefined)[]) {
    walk(label?.arguments);
    hold(label?.items);
    hold(label?.change?.effects);
    hold(label?.change?.texts);
    hold(label?.change?.opaque);
  }
  return {
    plainAt: (path) => values.has(path),
    heldAt: (path) => held.has(path),
  };
};

/** Whether `path` lies within one of `covers`; a cover starting with `=` is that path only. */
const covered = (path: string, covers: readonly string[]): boolean =>
  covers.some((cover) =>
    cover.startsWith("=")
      ? path === cover.slice(1)
      : path === cover || path.startsWith(`${cover}/`),
  );

/**
 * What a recipient group stands for in the arguments: under the key it was
 * read from, each address and each whole entry, never a recipient's other
 * fields (such as whether an attendee is required).
 */
const recipientPaths = (
  input: unknown,
  rawName: string,
  addresses: readonly string[],
): string[] => {
  const wanted = new Set(addresses.map((address) => plain(address)));
  const holds = (value: unknown): boolean =>
    typeof value === "string"
      ? wanted.has(plain(value))
      : isObject(value) && Object.values(value).some(holds);
  const found: string[] = [];
  const walk = (value: unknown, at: string) => {
    if (!isObject(value)) return;
    for (const [key, inner] of Object.entries(value)) {
      const path = `${at}/${pointerKey(key)}`;
      if (key === rawName && holds(inner)) found.push(path);
      else walk(inner, path);
    }
  };
  walk(input, "");
  return found.flatMap((group) => {
    const covers: string[] = [];
    const mark = (value: unknown, at: string, entry: boolean) => {
      if (typeof value === "string") {
        if (wanted.has(plain(value))) covers.push(`=${at}`);
      } else if (isObject(value)) {
        if (entry) covers.push(`=${at}`);
        for (const [key, inner] of Object.entries(value))
          mark(inner, `${at}/${pointerKey(key)}`, Array.isArray(value));
      }
    };
    covers.push(`=${group}`);
    mark(readAt(input, group), group, false);
    return covers;
  });
};

const readAt = (input: unknown, pointer: string): unknown =>
  pointer
    .split("/")
    .slice(1)
    .reduce<unknown>(
      (holder, key) =>
        isObject(holder)
          ? holder[key.replaceAll("~1", "/").replaceAll("~0", "~")]
          : undefined,
      input,
    );

// Whether the user's words ask for a difference

/** Words that say nothing about a value on their own. */
const FILLERS = new Set([
  "und",
  "oder",
  "der",
  "die",
  "das",
  "den",
  "dem",
  "des",
  "ein",
  "eine",
  "einen",
  "mit",
  "für",
  "von",
  "auf",
  "nicht",
  "the",
  "and",
  "for",
  "with",
  "from",
  "not",
  // Words that frame a change rather than name what changes.
  "bitte",
  "doch",
  "lieber",
  "statt",
  "stattdessen",
  "nimm",
  "nehmen",
  "mach",
  "mache",
  "machen",
  "setz",
  "setze",
  "setzen",
  "ändere",
  "ändern",
  "noch",
  "eben",
  "jetzt",
  "lass",
  "aber",
  "auch",
  "please",
  "instead",
  "rather",
  "make",
  "take",
  "change",
  "just",
  "also",
  "then",
  "now",
]);

const tokensOf = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/(\d)[.,'’ ](?=\d{3}\b)/g, "$1")
    .replace(/(\d+)\s*k\b/g, "$1000")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);

const LOCALES = ["de-DE", "en-GB"];
const calendarNames = (option: "month" | "weekday", date: Date): string[] =>
  LOCALES.map((locale) =>
    new Intl.DateTimeFormat(locale, { [option]: "long", timeZone: "UTC" })
      .format(date)
      .toLowerCase(),
  );
const ALL_MONTHS = new Set(
  Array.from({ length: 12 }, (_, month) =>
    calendarNames("month", new Date(Date.UTC(2000, month, 1))),
  ).flat(),
);

const wordMatches = (said: readonly string[], term: string): boolean => {
  if (/^\d+$/.test(term)) return said.includes(term);
  if (FILLERS.has(term) || term.length < 3) return false;
  return said.some(
    (token) =>
      token === term ||
      (term.length >= 4 &&
        token.length >= 4 &&
        (token.includes(term) || term.includes(token))),
  );
};

/**
 * Whether the user's words name a value. A date needs its day, and a month
 * said with it must be its own; its weekday names it too. A month, a year
 * or an hour alone names nothing.
 */
const names = (said: readonly string[], value: EarValue): boolean => {
  switch (value.kind) {
    case "text":
      return tokensOf(value.text).some((term) => wordMatches(said, term));
    case "number":
      return (
        said.includes(String(Math.trunc(value.value))) ||
        said.includes(String(value.value))
      );
    case "date":
    case "datetime": {
      const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
      if (calendarNames("weekday", date).some((day) => said.includes(day)))
        return true;
      if (!said.includes(String(value.day))) return false;
      const month = calendarNames("month", date);
      return said
        .filter((token) => ALL_MONTHS.has(token))
        .every((token) => month.includes(token));
    }
    case "bool":
    case "unread":
    case "id":
      return false;
  }
};

/**
 * Whether the user asked for a difference: they named its field or one of
 * its new values, or, for something gone or a list that lost entries, one
 * of the values it dropped. The old value of something replaced asks for
 * nothing. When in doubt a difference counts as not asked for, which only
 * makes the voice say more.
 */
const asks = (
  said: readonly string[],
  entry: Entry | undefined,
  old: Entry | undefined,
  siblings: readonly string[],
): boolean => {
  const field = entry?.field ?? old?.field;
  if (field !== undefined && fieldNamed(said, field, siblings)) return true;
  if (entry?.said.some((value) => names(said, value))) return true;
  if (entry?.words !== undefined || old?.words !== undefined) {
    const before = new Set(tokensOf(old?.words ?? ""));
    const after = new Set(tokensOf(entry?.words ?? ""));
    const changed = [
      ...[...after].filter((token) => !before.has(token)),
      ...[...before].filter((token) => !after.has(token)),
    ];
    if (changed.some((term) => wordMatches(said, term))) return true;
  }
  if (old && (!entry || entry.list || entry.said.length === 0)) {
    const kept = new Set(entry?.said.map((value) => JSON.stringify(value)));
    return old.said
      .filter((value) => !kept.has(JSON.stringify(value)))
      .some((value) => names(said, value));
  }
  return false;
};

/** The words of a field name a user may say for it. */
const fieldWords = (field: string): string[] =>
  tokensOf(field).filter((word) => word.length >= 4 && !FILLERS.has(word));

/**
 * Whether the user's words name a field: one of its words whole, or a whole
 * part of a compound that no other field of the card shares ("Ende" names
 * "Terminende"; "Termin" names neither "Terminbeginn" nor "Terminende").
 */
const fieldNamed = (
  said: readonly string[],
  field: string,
  siblings: readonly string[],
): boolean => {
  const others = siblings
    .filter((sibling) => sibling !== field)
    .flatMap(fieldWords);
  const partOf = (part: string, word: string) =>
    part !== word && (word.startsWith(part) || word.endsWith(part));
  return fieldWords(field).some(
    (word) =>
      said.includes(word) ||
      said.some(
        (token) =>
          token.length >= 4 &&
          !FILLERS.has(token) &&
          ((partOf(token, word) &&
            !others.some((other) => other === token || partOf(token, other))) ||
            (partOf(word, token) && !others.includes(word))),
      ),
  );
};

const introduced = (
  pieces: SpokenPiece[],
  intro: DifferenceIntro,
  words: LanguageWords,
): SpokenDifference => {
  const at = pieces.findIndex((piece) => piece.role === "what");
  const first = at === -1 ? 0 : at;
  return {
    intro,
    pieces: pieces.map((piece, index) =>
      index === first
        ? {
            ...piece,
            text: words.difference.intro(intro, piece.text),
            mustSay: true,
          }
        : piece,
    ),
  };
};

interface Difference {
  piece: ComposedPiece;
  asked: boolean;
  paths: string[];
}

/**
 * The pieces the voice says for `next`, the card that replaces `previous`.
 */
export const spokenDifference = (
  previous: WithdrawnCard,
  next: SpokenApproval,
  given: SpokenOptions,
): SpokenDifference => {
  // A change request is spoken: a text the user said in it is dictated too.
  const options: SpokenOptions = {
    ...given,
    userTurns: [
      { text: previous.words, passages: [previous.words], whole: true },
      ...(given.userTurns ?? []),
    ],
  };
  const words = spokenWordsFor(options.language, options);
  const whole = spokenApprovalPieces(next, options);
  if (!words.full) return { intro: "reread", pieces: whole };
  const heard = new Set(previous.heard);
  const before = previous.approval;
  if (before.type !== "call" || next.type !== "call") {
    return introduced(whole, "reread", words);
  }
  const oldCard = toolCallCardOf(before.label, before.input);
  const newCard = toolCallCardOf(next.label, next.input);
  // A read is said by its own sentence, not the card's, so its pieces have
  // no entries to compare: it is read again whole.
  const readSaid =
    spokenReadFactsOf(before.label) !== undefined ||
    spokenReadFactsOf(next.label) !== undefined;
  if (oldCard.kind !== "gist" || newCard.kind !== "gist" || readSaid) {
    // Nothing compares these arguments entry by entry: any difference counts.
    const same =
      before.toolTitle === next.toolTitle &&
      before.server === next.server &&
      changedPaths(before.input, next.input).length === 0;
    return introduced(whole, same ? "same" : "reread", words);
  }
  if (!heard.has("what")) return introduced(whole, "reread", words);
  const inputChanged = changedPaths(
    before.input,
    next.input,
    readingOf(before.label, next.label),
  );
  if (identityOf(oldCard.gist, before) !== identityOf(newCard.gist, next)) {
    return introduced(whole, "other_item", words);
  }

  const { timeZone } = options;
  const oldEntries = entriesOf(
    oldCard.gist,
    before.input,
    withDictation(
      spokenFactsOf(oldCard.gist, before.server, timeZone, true),
      given.userTurns,
    ),
    words,
    timeZone,
  );
  const newEntries = entriesOf(
    newCard.gist,
    next.input,
    withDictation(
      spokenFactsOf(newCard.gist, next.server, timeZone, true),
      options.userTurns,
    ),
    words,
    timeZone,
  );
  const said = tokensOf(previous.words);
  const oldByKey = new Map(oldEntries.map((entry) => [entry.key, entry]));
  const newKeys = new Set(newEntries.map((entry) => entry.key));
  const siblings = [
    ...new Set(
      [...oldEntries, ...newEntries].flatMap((entry) =>
        entry.field === undefined ? [] : [entry.field],
      ),
    ),
  ];

  const differences: Difference[] = [];
  const owed: ComposedPiece[] = [];
  const differs = (
    entry: Entry,
    sentence: string,
    asked: boolean,
    paths: string[],
  ) =>
    differences.push({
      piece: {
        role: entry.role,
        text: words.difference.differs(asked, sentence),
        mustSay: true,
        values: entry.values,
        ...(entry.readOut ? { readOut: entry.readOut } : {}),
      },
      asked,
      paths,
    });
  let consequence: Entry | undefined;
  let nameChanged = false;
  for (const entry of newEntries) {
    const old = oldByKey.get(entry.key);
    if (old?.compare !== entry.compare) {
      if (entry.key === "name") nameChanged = true;
      const sentence =
        entry.key === "batch"
          ? words.difference.rows(
              rowsChanged(old?.compare ?? "[]", entry.compare),
            )
          : // The same words as before would hide the difference.
            old?.sentence === entry.sentence && entry.plainer !== undefined
            ? entry.plainer
            : entry.sentence;
      const changed = changedRows(entry, old);
      differs(
        entry,
        sentence,
        asks(said, changed, old, siblings),
        entry.rows ? changed.paths : [...entry.paths, ...(old?.paths ?? [])],
      );
    } else if (entry.key === "consequence") {
      consequence = entry;
    } else if (entry.mustSay && !heard.has(old.heardAs)) {
      // Something that can be lost and was not heard on the withdrawn card.
      owed.push({
        role: entry.role,
        text: entry.sentence,
        mustSay: true,
        values: entry.values,
      });
    }
  }
  for (const old of oldEntries) {
    if (newKeys.has(old.key)) continue;
    differs(
      { ...old, values: [] },
      words.difference.dropped(old.field ?? ""),
      asks(said, undefined, old, siblings),
      old.paths,
    );
  }
  // What the user asked for first, then what nobody asked for.
  differences.sort((a, b) => Number(b.asked) - Number(a.asked));

  const spoken = spokenFactsOf(newCard.gist, next.server, timeZone);
  // A new title is said as a difference; the first sentence then ends there.
  const facts = nameChanged ? { ...spoken, names: [] } : spoken;
  const item = words.item(facts);
  const lead: ComposedPiece[] = [
    {
      role: "what",
      text: words.what(facts),
      mustSay: true,
      values:
        item.length > 0
          ? whatValues({ ...facts, names: [] })
          : whatValues(facts),
    },
    ...(item.length > 0
      ? [
          {
            role: "item" as const,
            text: item,
            mustSay: true,
            values: facts.names
              .slice(0, 1)
              .map((name): SpokenSource => sourceOf("name", name)),
          },
        ]
      : []),
  ];
  const request = whole.find((piece) => piece.role === "request");
  const closing: ComposedPiece[] = [
    ...(consequence
      ? [
          {
            role: consequence.role,
            text: consequence.sentence,
            mustSay: true,
            values: consequence.values,
          },
        ]
      : []),
    ...(request ? [request] : []),
  ];

  if (differences.length === 0 && inputChanged.length === 0) {
    lead[0] = {
      ...lead[0],
      text: words.difference.intro("same", lead[0].text),
    };
    return {
      intro: "same",
      pieces: spokenPiecesOf(
        [
          ...lead,
          ...owed,
          {
            role: "more",
            text: words.difference.sameHint(),
            mustSay: false,
            values: [],
          },
          ...closing,
        ],
        options,
      ),
    };
  }
  lead[0] = {
    ...lead[0],
    text: words.difference.intro("changed", lead[0].text),
  };
  const counted = differences.slice(MAX_SAID_DIFFERENCES - 1);
  const told =
    differences.length > MAX_SAID_DIFFERENCES
      ? [
          ...differences
            .slice(0, MAX_SAID_DIFFERENCES - 1)
            .map((difference) => difference.piece),
          {
            role: "more" as const,
            text: words.difference.more(
              counted.length,
              counted.every((difference) => difference.asked),
            ),
            mustSay: true,
            values: [],
          },
        ]
      : differences.map((difference) => difference.piece);
  // What differs in the arguments with no difference saying it.
  const covers = differences.flatMap((difference) => difference.paths);
  const untold = inputChanged.filter((path) => !covered(path, covers));
  const rest: ComposedPiece =
    differences.length === 0
      ? {
          role: "more",
          text: words.difference.unreadable(),
          mustSay: true,
          values: [],
        }
      : untold.length > 0
        ? {
            role: "more",
            text: words.difference.elsewhere(),
            mustSay: true,
            values: [],
          }
        : {
            role: "more",
            text: words.difference.rest(),
            mustSay: false,
            values: [],
          };
  return {
    intro: "changed",
    pieces: spokenPiecesOf(
      [...lead, ...told, ...owed, rest, ...closing],
      options,
    ),
  };
};
