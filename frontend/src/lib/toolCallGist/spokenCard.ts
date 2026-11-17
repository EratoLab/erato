/* eslint-disable lingui/no-unlocalized-strings -- effect, note and piece names from the API and this module; the spoken words are in spokenCardWords */
import { effectDisplayName } from "./cardLayout";
import { changeLayout, listReplaceIsUnknown } from "./change";
import { toolCallCardOf } from "./gist";
import { spokenWordsFor } from "./spokenCardWords";
import { earValue } from "./spokenValues";

import type {
  ChangeEffect,
  ChangeRecipients,
  ChangeValue,
  GistChange,
} from "./change";
import type { Gist, GistAction, GistKind, GistValue } from "./gist";
import type { EarValue } from "./spokenValues";
import type {
  ToolCallLabel,
  ToolCallOpaqueKind,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The approval card as the voice says it: built from the card's own data,
 * never from what the model wrote, in the order the design fixes (what and
 * where, which item, up to three details, each long text, the consequence,
 * the request to decide). Each piece is said on its own so a listener can
 * skip one and hear the rest.
 */

export type SpokenPieceRole =
  | "count"
  | "what"
  | "item"
  | "detail"
  | "outside"
  | "more"
  | "text"
  | "consequence"
  | "request"
  | "pointer";

/** What a value in a piece is to the sentence. */
export type SpokenSlot =
  | "count"
  | "server"
  | "tool"
  | "name"
  | "place"
  | "recipient"
  | "recipients"
  | "outside"
  | "statement"
  | "field"
  | "value"
  | "from"
  | "to"
  | "words"
  | "text"
  | "consequence";

/**
 * A value a piece is built from, kept beside its text so a reworded piece
 * can be checked against what the card says.
 */
export interface SpokenSource {
  slot: SpokenSlot;
  value: EarValue;
}

export interface SpokenPiece {
  role: SpokenPieceRole;
  text: string;
  /** A loss or a consequence: said even when the listener skips ahead. */
  mustSay: boolean;
  /** Silence before the piece, for a delete's request to decide. */
  pauseBeforeMs?: number;
  /** The values the text says, in the order it says them. */
  values?: SpokenSource[];
}

/** Details read before the rest is counted. */
export const MAX_SPOKEN_DETAILS = 3;
/** Losses listed one by one; more are said as one counted piece. */
export const MAX_LISTED_LOSSES = 4;
/** Long texts named one by one; more are counted with the other fields. */
const MAX_SPOKEN_TEXTS = 3;
/** A name or value is cut after this many words, or characters. */
const MAX_VALUE_WORDS = 12;
const MAX_VALUE_CHARS = 90;
const MAX_FIELD_WORDS = 6;
/** What the voice endpoint takes; see `speak_approval` in the backend. */
const MAX_PIECES = 16;
const MAX_PIECE_CHARS = 400;
const MAX_CARD_CHARS = 2_000;

/**
 * Marks where a name or value was cut; each language says it its own way
 * ("… gekürzt"). Private use, so it never occurs in a value.
 */
export const SPOKEN_CUT = "\uE010";

/** A name or value cut by rule, so no card is too long to be spoken. */
export const shorten = (
  text: string,
  maxWords = MAX_VALUE_WORDS,
  maxChars = MAX_VALUE_CHARS,
): string => {
  const all = text.trim().split(/\s+/);
  if (all.length <= maxWords && text.length <= maxChars) return text;
  const kept: string[] = [];
  let length = 0;
  for (const word of all) {
    if (kept.length >= maxWords || length + word.length > maxChars) break;
    kept.push(word);
    length += word.length + 1;
  }
  const head =
    kept.length > 0 ? kept.join(" ") : (all[0] ?? "").slice(0, maxChars);
  return `${head}${SPOKEN_CUT}`;
};
/** Above this a text is named with its size instead of read. */
export const MAX_READ_WORDS = 15;

export type SpokenDetail =
  | { type: "set"; field: string; value: EarValue; loss: false }
  | {
      type: "changed";
      field: string;
      from: EarValue;
      to: EarValue;
      loss: false;
    }
  | { type: "emptied"; field: string; loss: true }
  | {
      type: "list_replaced";
      field: string;
      values: EarValue[];
      /** The card cannot tell whether the list is replaced or added to. */
      unknown: boolean;
      loss: true;
    }
  | { type: "list_removed"; field: string; values: EarValue[]; loss: true }
  | {
      type: "list_added";
      field: string;
      values: EarValue[];
      /** Only the tool's word says the items are added. */
      claimed: boolean;
      loss: false;
    }
  | { type: "unreadable"; field: string; loss: false }
  /** A name a field of the call gives an item the card names only by its ID. */
  | { type: "named"; field: string; value: EarValue; loss: false }
  /** Many losses at once, counted instead of listed. */
  | { type: "losses"; emptied: number; lists: number; loss: true };

export interface SpokenText {
  field: string;
  words: number;
  /** The text itself when it is short enough to read. */
  read?: string;
}

export type SpokenConsequence =
  | "permanent"
  | "restorable"
  | "restore_unknown"
  | "rows_unknown"
  | "instruction_unknown"
  | "nothing_changes"
  | "destructive";

export interface SpokenRecipients {
  names: string[];
  total: number;
  /** How many are outside the organisation, when that is known. */
  outside?: number;
}

/** What the card says, sorted and cut by the rules; words come per language. */
export interface SpokenFacts {
  action: GistAction;
  kind: GistKind;
  /** How many things the call acts on. */
  count: number;
  server?: string;
  /** Names the call's things go by, at most three. */
  names: string[];
  /** The one thing the call acts on was never read in this chat. */
  unread: boolean;
  where: string[];
  recipients?: SpokenRecipients;
  statement?: ToolCallOpaqueKind;
  /** An update that only moves an event's dates. */
  reschedule: boolean;
  details: SpokenDetail[];
  detailsOmitted: number;
  texts: SpokenText[];
  consequences: SpokenConsequence[];
}

/** Where a card sits in a stop with several approvals. */
export interface SpokenQueuePosition {
  /** 0-based, in the order the screen shows them. */
  index: number;
  total: number;
  /** The item said before this one has the same verb, kind and server. */
  sameAsPrevious: boolean;
}

export interface SpokenCardInput {
  label: ToolCallLabel | null | undefined;
  input: unknown;
  /** The tool's title as the card shows it, for a call the card cannot describe. */
  toolTitle: string;
  server?: string;
}

/** What a card for one approval needs from the screen. */
export type SpokenApproval =
  | ({ type: "call" } & SpokenCardInput)
  /** A card the voice only points to: a limit, a plan, a built-in tool, files. */
  | { type: "pointer" };

export interface SpokenOptions {
  language: string;
  /** Dates in the current year are said without it. */
  now: Date;
  /** The zone times with an offset are said in. */
  timeZone?: string;
  position?: SpokenQueuePosition;
}

export interface SpokenWords {
  /** How a cut name or value ends ("… gekürzt"). */
  cut(): string;
  /** The sentence the voice says when it does not read the card. */
  pointer(): string;
  count(total: number): string;
  /** What, where and, for something that exists, which item. */
  what(facts: SpokenFacts, position?: SpokenQueuePosition): string;
  /** Which item, for something new; empty when `what` names it. */
  item(facts: SpokenFacts, position?: SpokenQueuePosition): string;
  detail(detail: SpokenDetail, facts: SpokenFacts): string;
  /** That recipients are outside the organisation, or nothing. */
  outside(recipients: SpokenRecipients): string;
  more(count: number): string;
  text(text: SpokenText): string;
  consequence(consequences: SpokenConsequence[], facts: SpokenFacts): string;
  request(): string;
  /** A call the card has no verb for: the tool's title and its server. */
  generic(toolTitle: string, server?: string): string;
}

const words = (text: string): number =>
  text.split(/\s+/).filter((word) => word.length > 0).length;

/** A glossary name carries the raw name in brackets for the eye only. */
const fieldName = (effect: { name: string; rawName: string }): string => {
  const suffix = ` (${effect.rawName})`;
  const name = effect.name.endsWith(suffix)
    ? effect.name.slice(0, -suffix.length)
    : effect.name;
  return shorten(
    name.trim().length > 0 ? name.trim() : effect.rawName,
    MAX_FIELD_WORDS,
  );
};

/** A field as its row on the card names it. */
const effectField = (effect: ChangeEffect): string =>
  fieldName({ name: effectDisplayName(effect), rawName: effect.rawName });

/** Field names that say a value is a share of a hundred. */
const PERCENT_FIELD = /percent|probability|prozent|wahrscheinlichkeit/i;

const valueOf = (
  value: ChangeValue,
  field: string,
  timeZone?: string,
): EarValue =>
  value.machineId
    ? value.text.length > 0
      ? { kind: "text", text: shorten(value.text) }
      : { kind: "unread" }
    : value.meaning
      ? { kind: "text", text: shorten(value.meaning.label) }
      : earValue(value.text, { percent: PERCENT_FIELD.test(field), timeZone });

/** A text value as said: long ones are named by size elsewhere, the rest cut by rule. */
const sayable = (value: EarValue): EarValue =>
  value.kind === "text" && !isLong(value)
    ? { kind: "text", text: shorten(value.text) }
    : value;

const isLong = (value: EarValue): boolean =>
  value.kind === "text" && words(value.text) > MAX_READ_WORDS;

const DATE_KINDS = new Set(["date", "datetime"]);

/** The name a nameless item gets from a field that names it, as a card shows it. */
const NAME_FIELD = /(^|[_\-.])(file)?name$|title|subject|filename/i;

interface Detailed {
  details: SpokenDetail[];
  omitted: number;
  texts: SpokenText[];
  /** A field that names the item when nothing else does. */
  naming?: string;
  reschedule: boolean;
}

/**
 * Whether a field may name the item: only for something being created, whose
 * title the call writes. An item that exists is named by what the card names
 * it by, and a name the call types beside its ID is only a detail.
 */
type FieldNaming = "names_new_item" | "beside_id" | "none";

/**
 * The details in the order the card's first view shows them, from the
 * card's own layout: what is lost, then what cannot be read, then the values
 * as the card ranks them. Losses and unreadable values are always said, as
 * the card always shows them; of the values, the card's first ones are said
 * up to three details in all, and the rest are counted.
 */
const detailsOf = (
  change: GistChange,
  action: GistAction,
  naming: FieldNaming,
  timeZone?: string,
): Detailed => {
  const ear = (value: ChangeValue, field: string) =>
    sayable(valueOf(value, field, timeZone));
  const layout = changeLayout(change);
  const replaceUnknown = listReplaceIsUnknown(change);
  const texts: SpokenText[] = [];
  let named: string | undefined;
  let typedName = false;
  const detailOf = (effect: ChangeEffect): SpokenDetail | undefined => {
    const field = effectField(effect);
    const first = effect.values[0] as ChangeValue | undefined;
    const namesItem =
      effect.effect === "set" &&
      first !== undefined &&
      !first.machineId &&
      NAME_FIELD.test(effect.rawName);
    if (naming === "names_new_item" && named === undefined && namesItem) {
      named = shorten(first.text);
      return undefined;
    }
    if (naming === "beside_id" && !typedName && namesItem) {
      typedName = true;
      return {
        type: "named",
        field,
        value: { kind: "text", text: shorten(first.text) },
        loss: false,
      };
    }
    switch (effect.effect) {
      case "unchanged":
        return undefined;
      case "emptied":
        return { type: "emptied", field, loss: true };
      case "list_replaced":
        return {
          type: "list_replaced",
          field,
          values: effect.values.map((value) => ear(value, field)),
          unknown: replaceUnknown,
          loss: true,
        };
      case "list_removed":
        return {
          type: "list_removed",
          field,
          values: effect.values.map((value) => ear(value, field)),
          loss: true,
        };
      case "list_added":
        return {
          type: "list_added",
          field,
          values: effect.values.map((value) => ear(value, field)),
          claimed: true,
          loss: false,
        };
      case "unreadable":
        return { type: "unreadable", field, loss: false };
      default: {
        if (!first) return undefined;
        const to = ear(first, field);
        if (isLong(to)) {
          texts.push({
            field,
            words: to.kind === "text" ? words(to.text) : 0,
          });
          return undefined;
        }
        return effect.effect === "changed" && effect.old
          ? {
              type: "changed",
              field,
              from: ear(effect.old, field),
              to,
              loss: false,
            }
          : { type: "set", field, value: to, loss: false };
      }
    }
  };
  const of = (effects: readonly ChangeEffect[]) =>
    effects.flatMap((effect) => detailOf(effect) ?? []);
  const losses = of([
    ...layout.emptied,
    ...layout.lists,
    ...layout.removedFromLists,
  ]);
  const unreadable = of(layout.unreadable);
  const values = of([...layout.firstRows, ...layout.collapsed]);
  let details: SpokenDetail[];
  let omitted: number;
  if (losses.length > MAX_LISTED_LOSSES) {
    const rest = [...unreadable, ...values];
    const listed = rest.slice(
      0,
      Math.max(MAX_SPOKEN_DETAILS - 1, unreadable.length),
    );
    details = [
      {
        type: "losses",
        emptied: losses.filter((detail) => detail.type === "emptied").length,
        lists: losses.filter((detail) => detail.type !== "emptied").length,
        loss: true,
      },
      ...listed,
    ];
    omitted = rest.length - listed.length;
  } else {
    const ordered = [...losses, ...unreadable, ...values];
    details = ordered.slice(
      0,
      Math.max(MAX_SPOKEN_DETAILS, losses.length + unreadable.length),
    );
    omitted = ordered.length - details.length;
  }
  for (const text of change.texts) {
    const field = fieldName(text);
    // A truncated text is counted by its length; a whole one by its words.
    const count = text.truncated
      ? Math.round(text.chars / 6.5)
      : words(text.text);
    texts.push(
      count > MAX_READ_WORDS || text.truncated
        ? { field, words: count }
        : {
            field,
            words: count,
            read: shorten(text.text, MAX_READ_WORDS, 200),
          },
    );
  }
  const spokenTexts = texts.slice(0, MAX_SPOKEN_TEXTS);
  const all = [...losses, ...unreadable, ...values];
  const reschedule =
    action === "update" &&
    all.length > 0 &&
    all.every(
      (detail) =>
        (detail.type === "changed" && DATE_KINDS.has(detail.to.kind)) ||
        (detail.type === "set" && DATE_KINDS.has(detail.value.kind)),
    );
  return {
    details,
    omitted: omitted + change.textsOmitted + texts.length - spokenTexts.length,
    texts: spokenTexts,
    naming: named,
    reschedule,
  };
};

/** What a person calls a recipient written as an address: its name part. */
const recipientName = (written: string): string => {
  const named = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(written);
  if (named) return named[1].trim();
  const at = written.indexOf("@");
  if (at <= 0) return written.trim();
  return written
    .slice(0, at)
    .split(/[._-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const recipientsOf = (recipients: ChangeRecipients): SpokenRecipients => {
  const names = recipients.groups
    .flatMap((group) => group.values)
    .map(recipientName)
    .filter((name) => name.length > 0)
    .map((name) => shorten(name));
  const outsideCount = recipients.outside.length + recipients.outsideOmitted;
  return {
    names,
    total: recipients.total,
    outside: recipients.outsideKnown ? outsideCount : undefined,
  };
};

const CONSEQUENCE_NOTES: Partial<Record<string, SpokenConsequence>> = {
  tool_says_permanent: "permanent",
  tool_says_restorable: "restorable",
  delete_outcome_unknown: "restore_unknown",
  row_count_unknown: "rows_unknown",
  instruction_outcome_unknown: "instruction_unknown",
  nothing_changes: "nothing_changes",
};

const consequencesOf = (
  change: GistChange | undefined,
  action: GistAction,
): SpokenConsequence[] => {
  const notes = change?.notes ?? [];
  const said = notes.flatMap((note) => CONSEQUENCE_NOTES[note] ?? []);
  const unique = [...new Set(said)];
  // The tool's own statement wins over "not known".
  if (unique.includes("permanent") || unique.includes("restorable")) {
    return unique.filter((consequence) => consequence !== "restore_unknown");
  }
  if (action === "delete" && unique.length === 0) return ["restore_unknown"];
  const destructive = notes.some(
    (note) =>
      note === "marked_destructive" || note === "operator_marked_destructive",
  );
  if (destructive && action !== "delete" && unique.length === 0) {
    return ["destructive"];
  }
  return unique;
};

/** Spoken names: names and short IDs a person can say, never a machine ID. */
const spokenNames = (values: GistValue[]): string[] =>
  values.flatMap((value) =>
    value.origin === "resolved" ||
    value.origin === "written" ||
    value.origin === "place"
      ? [shorten(value.text)]
      : [],
  );

/** Verbs whose item is new, so the call's title is what it is called. */
const CREATING_ACTIONS: readonly GistAction[] = ["create", "send", "upload"];

/** The facts a gist card holds, read the way the voice needs them. */
export const spokenFactsOf = (
  gist: Gist,
  server?: string,
  timeZone?: string,
): SpokenFacts => {
  const lead = gist.items[0];
  const change = gist.change;
  const batch = change?.batch;
  const rowNames = (batch?.rows ?? []).flatMap((row) =>
    row.name ? [shorten(row.name)] : [],
  );
  const names = rowNames.length > 0 ? rowNames : spokenNames(lead.names);
  const count = batch ? batch.total : lead.count;
  const unread =
    count === 1 &&
    names.length === 0 &&
    (change?.recordUnread === true || lead.hiddenIdPaths.length > 0);
  const detailed: Detailed = change
    ? detailsOf(
        change,
        gist.action,
        names.length > 0 || count !== 1
          ? "none"
          : CREATING_ACTIONS.includes(gist.action)
            ? "names_new_item"
            : "beside_id",
        timeZone,
      )
    : fieldDetailsOf(gist, timeZone);
  const where = spokenNames(lead.where);
  return {
    action: gist.action,
    kind: gist.kind,
    count,
    server,
    names:
      names.length === 0 && detailed.naming !== undefined
        ? [detailed.naming]
        : names.slice(0, MAX_SPOKEN_DETAILS),
    unread,
    where,
    recipients: change?.recipients
      ? recipientsOf(change.recipients)
      : undefined,
    statement: change?.opaque[0]?.kind,
    reschedule: gist.kind === "event" && detailed.reschedule,
    details: batch ? batchLosses(change) : detailed.details,
    detailsOmitted: batch ? 0 : detailed.omitted,
    texts: detailed.texts,
    consequences: consequencesOf(change, gist.action),
  };
};

/** A batch says its losses; its fields stay on screen. */
const batchLosses = (change: GistChange): SpokenDetail[] =>
  (change.batch?.fields ?? []).flatMap((field): SpokenDetail[] =>
    field.emptied > 0
      ? [{ type: "emptied", field: fieldName(field), loss: true }]
      : field.listsReplaced > 0
        ? [
            {
              type: "list_replaced",
              field: fieldName(field),
              values: [],
              unknown: false,
              loss: true,
            },
          ]
        : [],
  );

/** A label stored before change descriptions: its fields as the card lists them. */
const fieldDetailsOf = (gist: Gist, timeZone?: string): Detailed => {
  const lead = gist.items[0];
  const details: SpokenDetail[] = [];
  const texts: SpokenText[] = [];
  for (const field of lead.fields) {
    const [entry] = field.values;
    if (!(entry as (typeof field.values)[number] | undefined)) continue;
    const to = earOf(entry.value, field.name, timeZone);
    if (isLong(to)) {
      texts.push({ field: field.name, words: words(entry.value.text) });
      continue;
    }
    details.push(
      entry.earlier
        ? {
            type: "changed",
            field: field.name,
            from: earOf(entry.earlier, field.name, timeZone),
            to,
            loss: false,
          }
        : { type: "set", field: field.name, value: to, loss: false },
    );
  }
  for (const after of lead.after) {
    const count = words(after.text);
    texts.push(
      count > MAX_READ_WORDS || after.truncated
        ? { field: "", words: count }
        : { field: "", words: count, read: after.text },
    );
  }
  return {
    details: details.slice(0, MAX_SPOKEN_DETAILS),
    omitted: Math.max(details.length - MAX_SPOKEN_DETAILS, 0),
    texts,
    reschedule: false,
  };
};

const earOf = (value: GistValue, field: string, timeZone?: string): EarValue =>
  value.origin === "hidden_id"
    ? { kind: "unread" }
    : value.origin === "id"
      ? { kind: "id" }
      : value.origin === "resolved" || value.origin === "earlier"
        ? { kind: "text", text: value.text }
        : earValue(value.text, {
            percent: PERCENT_FIELD.test(field),
            timeZone,
          });

const DELETE_PAUSE_MS = 400;

const text = (slot: SpokenSlot, value: string): SpokenSource => ({
  slot,
  value: { kind: "text", text: value },
});
const number = (slot: SpokenSlot, value: number): SpokenSource => ({
  slot,
  value: { kind: "number", value, percent: false },
});

const whatValues = (facts: SpokenFacts): SpokenSource[] => [
  ...(facts.server ? [text("server", facts.server)] : []),
  ...(facts.count > 1 ? [number("count", facts.count)] : []),
  ...(facts.statement ? [text("statement", facts.statement)] : []),
  ...facts.names.map((name) => text("name", name)),
  ...facts.where.map((place) => text("place", place)),
  ...(facts.recipients
    ? [
        ...facts.recipients.names
          .slice(0, 1)
          .map((name) => text("recipient", name)),
        number("recipients", facts.recipients.total),
      ]
    : []),
];

const detailValues = (detail: SpokenDetail): SpokenSource[] => {
  if (detail.type === "losses") {
    return [number("count", detail.emptied), number("count", detail.lists)];
  }
  const field = text("field", detail.field);
  switch (detail.type) {
    case "set":
      return [field, { slot: "value", value: detail.value }];
    case "changed":
      return [
        field,
        { slot: "from", value: detail.from },
        { slot: "to", value: detail.to },
      ];
    case "list_replaced":
    case "list_removed":
    case "list_added":
      return [
        field,
        ...detail.values.map((value) => ({ slot: "value" as const, value })),
      ];
    case "named":
      return [field, { slot: "value", value: detail.value }];
    case "emptied":
    case "unreadable":
      return [field];
  }
};

/** A value as the source beside a piece: a cut shown as "…". */
const sourceText = (value: EarValue): EarValue =>
  value.kind === "text"
    ? { ...value, text: value.text.replaceAll(SPOKEN_CUT, "…") }
    : value;

/** Pieces a card can lose to fit the endpoint, the last ones first. */
const DROPPABLE: readonly SpokenPieceRole[] = ["text", "more", "detail"];

/**
 * The card as the endpoint takes it: each cut said in the language, a piece
 * too long for one request cut by rule, and if the card is still too long,
 * details and texts left to the screen from the last one on. Losses, the
 * consequence and the request always stay.
 */
const fitted = (pieces: SpokenPiece[], cut: string): SpokenPiece[] => {
  let card = pieces.map((piece) => {
    const text = piece.text.replaceAll(SPOKEN_CUT, cut);
    return {
      ...piece,
      text:
        text.length <= MAX_PIECE_CHARS
          ? text
          : shorten(
              text,
              Number.MAX_SAFE_INTEGER,
              MAX_PIECE_CHARS - cut.length - 1,
            ).replaceAll(SPOKEN_CUT, cut),
      values: piece.values?.map((source) => ({
        ...source,
        value: sourceText(source.value),
      })),
    };
  });
  const total = () => card.reduce((sum, piece) => sum + piece.text.length, 0);
  while (card.length > MAX_PIECES || total() > MAX_CARD_CHARS) {
    let drop = -1;
    for (let index = card.length - 1; index >= 0; index--) {
      if (!card[index].mustSay && DROPPABLE.includes(card[index].role)) {
        drop = index;
        break;
      }
    }
    if (drop === -1) break;
    card = card.filter((_, index) => index !== drop);
  }
  return card;
};

/** The pieces for one approval in the language given. */
export const spokenApprovalPieces = (
  approval: SpokenApproval,
  options: SpokenOptions,
): SpokenPiece[] =>
  fitted(
    composedPieces(approval, options),
    spokenWordsFor(options.language, options).cut(),
  );

const composedPieces = (
  approval: SpokenApproval,
  options: SpokenOptions,
): SpokenPiece[] => {
  const words = spokenWordsFor(options.language, options);
  const pointer: SpokenPiece[] = [
    { role: "pointer", text: words.pointer(), mustSay: false, values: [] },
  ];
  if (!words.full || approval.type === "pointer") return pointer;
  const { position } = options;
  const pieces: SpokenPiece[] = [];
  if (position?.index === 0 && position.total > 1) {
    pieces.push({
      role: "count",
      text: words.count(position.total),
      mustSay: false,
      values: [number("count", position.total)],
    });
  }
  const request: SpokenPiece = {
    role: "request",
    text: words.request(),
    mustSay: false,
    values: [],
  };
  const card = toolCallCardOf(approval.label, approval.input);
  if (card.kind !== "gist") {
    pieces.push({
      role: "what",
      text: words.generic(approval.toolTitle, approval.server),
      mustSay: false,
      values: [
        ...(approval.server ? [text("server", approval.server)] : []),
        text("tool", approval.toolTitle),
      ],
    });
    pieces.push(request);
    return pieces;
  }
  const facts = spokenFactsOf(card.gist, approval.server, options.timeZone);
  const loss = facts.action === "delete";
  const item = words.item(facts, position);
  pieces.push({
    role: "what",
    text: words.what(facts, position),
    mustSay: loss,
    values:
      item.length > 0 ? whatValues({ ...facts, names: [] }) : whatValues(facts),
  });
  if (item.length > 0) {
    pieces.push({
      role: "item",
      text: item,
      mustSay: loss,
      values: facts.names.slice(0, 1).map((name) => text("name", name)),
    });
  }
  const outside = facts.recipients ? words.outside(facts.recipients) : "";
  if (facts.recipients && outside.length > 0) {
    pieces.push({
      role: "outside",
      text: outside,
      mustSay: true,
      values: [
        number("outside", facts.recipients.outside ?? 0),
        number("recipients", facts.recipients.total),
      ],
    });
  }
  for (const detail of facts.details) {
    pieces.push({
      role: "detail",
      text: words.detail(detail, facts),
      mustSay: detail.loss,
      values: detailValues(detail),
    });
  }
  if (facts.detailsOmitted > 0) {
    pieces.push({
      role: "more",
      text: words.more(facts.detailsOmitted),
      mustSay: false,
      values: [number("count", facts.detailsOmitted)],
    });
  }
  for (const spokenText of facts.texts) {
    pieces.push({
      role: "text",
      text: words.text(spokenText),
      mustSay: false,
      values: [
        ...(spokenText.field ? [text("field", spokenText.field)] : []),
        spokenText.read === undefined
          ? number("words", spokenText.words)
          : text("text", spokenText.read),
      ],
    });
  }
  if (facts.consequences.length > 0) {
    pieces.push({
      role: "consequence",
      text: words.consequence(facts.consequences, facts),
      mustSay: true,
      values: facts.consequences.map((consequence) =>
        text("consequence", consequence),
      ),
    });
  }
  pieces.push(loss ? { ...request, pauseBeforeMs: DELETE_PAUSE_MS } : request);
  return pieces;
};

/** Approval kinds whose own call the voice describes; the rest it points to. */
const DESCRIBED_KINDS: readonly string[] = [
  "mcp_tool",
  "client_tool",
  "delegated_task",
];

/**
 * What the voice says for one approval of a stop of `approvalKind`: the call
 * a card describes, a task's call included, or for a limit, a plan or a
 * built-in tool only that a decision waits on screen.
 */
export const spokenApprovalFor = (
  approvalKind: string,
  call: {
    tool_name: string;
    input: unknown;
    display?: {
      title?: string;
      server_name?: string | null;
      label?: ToolCallLabel;
    } | null;
    child?: unknown;
  },
): SpokenApproval => {
  if (call.child == null && !DESCRIBED_KINDS.includes(approvalKind)) {
    return { type: "pointer" };
  }
  return {
    type: "call",
    label: call.display?.label,
    input: call.input,
    toolTitle: call.display?.title ?? call.tool_name,
    server: call.display?.server_name ?? undefined,
  };
};

/** Whether two approvals said one after another are of the same kind. */
export const sameSpokenKind = (
  a: SpokenApproval | undefined,
  b: SpokenApproval | undefined,
): boolean => {
  if (a?.type !== "call" || b?.type !== "call") return false;
  const left = toolCallCardOf(a.label, a.input);
  const right = toolCallCardOf(b.label, b.input);
  return (
    left.kind === "gist" &&
    right.kind === "gist" &&
    left.gist.action === right.gist.action &&
    left.gist.kind === right.gist.kind &&
    a.server === b.server
  );
};
