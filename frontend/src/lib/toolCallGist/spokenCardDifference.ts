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
  whatValues,
} from "./spokenCard";
import { spokenWordsFor } from "./spokenCardWords";
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
  /** Where in the call's arguments it sits; `#key` for any path through a key. */
  paths: string[];
  /** The values a user may name to ask for it. */
  said: EarValue[];
  /** A list, whose entries can be dropped by naming them. */
  list: boolean;
  /** For a long text: its words, to tell what was added or taken out. */
  words?: string;
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

/** The arrays a batch's rows sit in: each row's path up to its index. */
const batchPaths = (rows: readonly { effects: ChangeEffect[] }[]): string[] => [
  ...new Set(
    rows.flatMap((row) =>
      row.effects.map((effect) => effect.path.replace(/\/\d+(\/.*)?$/, "")),
    ),
  ),
];

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
            values: [
              sourceOf("field", field),
              text.read === undefined
                ? {
                    slot: "words",
                    value: {
                      kind: "number",
                      value: text.words,
                      percent: false,
                    },
                  }
                : sourceOf("text", text.read),
            ],
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
      compare: JSON.stringify([group.kind, group.values, group.omitted]),
      field: group.name,
      mustSay: true,
      values: spoken.map((recipient) => sourceOf("recipient", recipient)),
      paths: [`#${group.rawName}`],
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

/** The leaf paths where two arguments differ, as JSON pointers. */
export const changedPaths = (
  before: unknown,
  after: unknown,
  at = "",
): string[] => {
  if (Object.is(before, after)) return [];
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;
  if (
    !isObject(before) ||
    !isObject(after) ||
    Array.isArray(before) !== Array.isArray(after)
  )
    return [at];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap((key) =>
    changedPaths(
      before[key],
      after[key],
      `${at}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
    ),
  );
};

/** Whether `path` lies within one of `covers`; `#key` covers any path through that key. */
const covered = (path: string, covers: readonly string[]): boolean =>
  covers.some((cover) =>
    cover.startsWith("#")
      ? path.split("/").includes(cover.slice(1))
      : path === cover || path.startsWith(`${cover}/`),
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
): boolean => {
  const field = entry?.field ?? old?.field;
  if (
    field &&
    tokensOf(field).some((term) => term.length >= 4 && wordMatches(said, term))
  )
    return true;
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
  options: SpokenOptions,
): SpokenDifference => {
  const words = spokenWordsFor(options.language, options);
  const whole = spokenApprovalPieces(next, options);
  if (!words.full) return { intro: "reread", pieces: whole };
  const heard = new Set(previous.heard);
  const before = previous.approval;
  if (before.type !== "call" || next.type !== "call") {
    return introduced(whole, "reread", words);
  }
  const inputChanged = changedPaths(before.input, next.input);
  const oldCard = toolCallCardOf(before.label, before.input);
  const newCard = toolCallCardOf(next.label, next.input);
  if (oldCard.kind !== "gist" || newCard.kind !== "gist") {
    const same =
      before.toolTitle === next.toolTitle &&
      before.server === next.server &&
      inputChanged.length === 0;
    return introduced(whole, same ? "same" : "reread", words);
  }
  if (!heard.has("what")) return introduced(whole, "reread", words);
  if (identityOf(oldCard.gist, before) !== identityOf(newCard.gist, next)) {
    return introduced(whole, "other_item", words);
  }

  const { timeZone } = options;
  const oldEntries = entriesOf(
    oldCard.gist,
    spokenFactsOf(oldCard.gist, before.server, timeZone, true),
    words,
    timeZone,
  );
  const newEntries = entriesOf(
    newCard.gist,
    spokenFactsOf(newCard.gist, next.server, timeZone, true),
    words,
    timeZone,
  );
  const said = tokensOf(previous.words);
  const oldByKey = new Map(oldEntries.map((entry) => [entry.key, entry]));
  const newKeys = new Set(newEntries.map((entry) => entry.key));

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
      differs(
        entry,
        entry.key === "batch"
          ? words.difference.rows(
              rowsChanged(old?.compare ?? "[]", entry.compare),
            )
          : entry.sentence,
        asks(said, entry, old),
        [...entry.paths, ...(old?.paths ?? [])],
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
      asks(said, undefined, old),
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
