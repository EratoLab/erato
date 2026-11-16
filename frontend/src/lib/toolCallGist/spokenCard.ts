/* eslint-disable lingui/no-unlocalized-strings -- effect, note and piece names from the API and this module; the spoken words are in spokenCardWords */
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

export interface SpokenPiece {
  role: SpokenPieceRole;
  text: string;
  /** A loss or a consequence: said even when the listener skips ahead. */
  mustSay: boolean;
  /** Silence before the piece, for a delete's request to decide. */
  pauseBeforeMs?: number;
}

/** Details read before the rest is counted. */
export const MAX_SPOKEN_DETAILS = 3;
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
  | { type: "list_replaced"; field: string; values: EarValue[]; loss: true }
  | { type: "list_removed"; field: string; values: EarValue[]; loss: true }
  | { type: "list_added"; field: string; values: EarValue[]; loss: false }
  | { type: "unreadable"; field: string; loss: false };

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
  return name.trim().length > 0 ? name.trim() : effect.rawName;
};

/** A link shows the linked record's name, so its field drops a last "ID". */
const linkFieldName = (effect: ChangeEffect): string => {
  const name = fieldName(effect);
  if (!effect.link) return name;
  const match = /^(.*\S)\s+id$/i.exec(name);
  return match ? match[1] : name;
};

/** Field names that say a value is a share of a hundred. */
const PERCENT_FIELD = /percent|probability|prozent|wahrscheinlichkeit/i;

const valueOf = (
  value: ChangeValue,
  field: string,
  timeZone?: string,
): EarValue =>
  value.machineId
    ? value.text.length > 0
      ? { kind: "text", text: value.text }
      : { kind: "unread" }
    : value.meaning
      ? { kind: "text", text: value.meaning.label }
      : earValue(value.text, { percent: PERCENT_FIELD.test(field), timeZone });

const isLong = (value: EarValue): boolean =>
  value.kind === "text" && words(value.text) > MAX_READ_WORDS;

/** Dates first, then numbers and choices, then short text, then linked records. */
const setRank = (detail: SpokenDetail, effect: ChangeEffect): number => {
  if (detail.type !== "set") return 4;
  const kind = detail.value.kind;
  if (kind === "date" || kind === "datetime") return 0;
  if (kind === "number" || kind === "bool" || effect.values[0]?.meaning)
    return 1;
  if (effect.link) return 3;
  return 2;
};

const LOSS_EFFECTS = new Set(["emptied", "list_replaced", "list_removed"]);

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

const detailsOf = (
  change: GistChange,
  action: GistAction,
  needsName: boolean,
  timeZone?: string,
): Detailed => {
  const ear = (value: ChangeValue, field: string) =>
    valueOf(value, field, timeZone);
  const ranked: { detail: SpokenDetail; rank: number; order: number }[] = [];
  const texts: SpokenText[] = [];
  let naming: string | undefined;
  change.effects.forEach((effect, order) => {
    const field = linkFieldName(effect);
    if (effect.effect === "unchanged") return;
    const first = effect.values[0] as ChangeValue | undefined;
    if (
      needsName &&
      naming === undefined &&
      effect.effect === "set" &&
      first &&
      !first.machineId &&
      NAME_FIELD.test(effect.rawName)
    ) {
      naming = first.text;
      return;
    }
    let detail: SpokenDetail;
    switch (effect.effect) {
      case "emptied":
        detail = { type: "emptied", field, loss: true };
        break;
      case "list_replaced":
        detail = {
          type: "list_replaced",
          field,
          values: effect.values.map((value) => ear(value, field)),
          loss: true,
        };
        break;
      case "list_removed":
        detail = {
          type: "list_removed",
          field,
          values: effect.removed.map((value) => ear(value, field)),
          loss: true,
        };
        break;
      case "list_added":
        detail = {
          type: "list_added",
          field,
          values: effect.added.map((value) => ear(value, field)),
          loss: false,
        };
        break;
      case "unreadable":
        detail = { type: "unreadable", field, loss: false };
        break;
      default: {
        if (!first) return;
        const to = ear(first, field);
        if (isLong(to)) {
          texts.push({
            field,
            words: to.kind === "text" ? words(to.text) : 0,
          });
          return;
        }
        detail =
          effect.effect === "changed" && effect.old
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
    const rank = LOSS_EFFECTS.has(effect.effect)
      ? -2
      : detail.type === "changed"
        ? -1
        : setRank(detail, effect);
    ranked.push({ detail, rank, order });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
  const losses = ranked.filter(({ detail }) => detail.loss);
  const kept = Math.max(MAX_SPOKEN_DETAILS, losses.length);
  const details = ranked.slice(0, kept).map(({ detail }) => detail);
  for (const text of change.texts) {
    const field = fieldName(text);
    // A truncated text is counted by its length; a whole one by its words.
    const count = text.truncated
      ? Math.round(text.chars / 6.5)
      : words(text.text);
    texts.push(
      count > MAX_READ_WORDS || text.truncated
        ? { field, words: count }
        : { field, words: count, read: text.text },
    );
  }
  const reschedule =
    action === "update" &&
    ranked.length > 0 &&
    ranked.every(
      ({ detail }) =>
        (detail.type === "changed" && DATE_KINDS.has(detail.to.kind)) ||
        (detail.type === "set" && DATE_KINDS.has(detail.value.kind)),
    );
  return {
    details,
    omitted: ranked.length - details.length + change.textsOmitted,
    texts,
    naming,
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
    .filter((name) => name.length > 0);
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
      ? [value.text]
      : [],
  );

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
    row.name ? [row.name] : [],
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
        names.length === 0 && count === 1,
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

/** The pieces for one approval in the language given. */
export const spokenApprovalPieces = (
  approval: SpokenApproval,
  options: SpokenOptions,
): SpokenPiece[] => {
  const words = spokenWordsFor(options.language, options);
  const pointer: SpokenPiece[] = [
    { role: "pointer", text: words.pointer(), mustSay: false },
  ];
  if (!words.full || approval.type === "pointer") return pointer;
  const { position } = options;
  const pieces: SpokenPiece[] = [];
  if (position?.index === 0 && position.total > 1) {
    pieces.push({
      role: "count",
      text: words.count(position.total),
      mustSay: false,
    });
  }
  const card = toolCallCardOf(approval.label, approval.input);
  if (card.kind !== "gist") {
    pieces.push({
      role: "what",
      text: words.generic(approval.toolTitle, approval.server),
      mustSay: false,
    });
    pieces.push({ role: "request", text: words.request(), mustSay: false });
    return pieces;
  }
  const facts = spokenFactsOf(card.gist, approval.server, options.timeZone);
  const loss = facts.action === "delete";
  pieces.push({
    role: "what",
    text: words.what(facts, position),
    mustSay: loss,
  });
  const item = words.item(facts, position);
  if (item.length > 0) pieces.push({ role: "item", text: item, mustSay: loss });
  const outside = facts.recipients ? words.outside(facts.recipients) : "";
  if (outside.length > 0) {
    pieces.push({ role: "outside", text: outside, mustSay: true });
  }
  for (const detail of facts.details) {
    pieces.push({
      role: "detail",
      text: words.detail(detail, facts),
      mustSay: detail.loss,
    });
  }
  if (facts.detailsOmitted > 0) {
    pieces.push({
      role: "more",
      text: words.more(facts.detailsOmitted),
      mustSay: false,
    });
  }
  for (const text of facts.texts) {
    pieces.push({ role: "text", text: words.text(text), mustSay: false });
  }
  if (facts.consequences.length > 0) {
    pieces.push({
      role: "consequence",
      text: words.consequence(facts.consequences, facts),
      mustSay: true,
    });
  }
  pieces.push({
    role: "request",
    text: words.request(),
    mustSay: false,
    ...(loss ? { pauseBeforeMs: DELETE_PAUSE_MS } : {}),
  });
  return pieces;
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
