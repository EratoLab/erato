/* eslint-disable lingui/no-unlocalized-strings -- effect, note and piece names from the API and this module; the spoken words are in spokenCardWords */
import { effectDisplayName } from "./cardLayout";
import { addsOnToolsWord, changeLayout, listReplaceIsUnknown } from "./change";
import { toolCallCardOf } from "./gist";
import { MAX_LISTED_ENTRIES, spokenWordsFor } from "./spokenCardWords";
import { dictationOf } from "./spokenDictation";
import { holder } from "./spokenHold";
import {
  spokenChoice,
  spokenFieldName,
  spokenFieldSentences,
  spokenNamesFor,
} from "./spokenNames";
import { spokenReadFactsOf, spokenReadPieces } from "./spokenRead";
import { earValue } from "./spokenValues";

import type {
  ChangeEffect,
  ChangeRecipients,
  ChangeValue,
  GistChange,
} from "./change";
import type { Gist, GistAction, GistKind, GistValue } from "./gist";
import type { SpokenNotice, SpokenUtterance } from "./spokenCardFlow";
import type { DictationRelation, UserTurn } from "./spokenDictation";
import type {
  ConfirmationPhrases,
  SpokenCardLanguages,
} from "./spokenLanguageData";
import type { SpokenNames } from "./spokenNames";
import type { NumberWords } from "./spokenNumbers";
import type { SentenceSet } from "./spokenSentences";
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
  | "dictated"
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
  /**
   * Stable within a card and between a card and the one that replaces it:
   * the role, and for a detail or a text the field it is about.
   */
  id: string;
  role: SpokenPieceRole;
  text: string;
  /** A loss or a consequence: said even when the listener skips ahead. */
  mustSay: boolean;
  /** Silence before the piece, for a delete's request to decide. */
  pauseBeforeMs?: number;
  /** The values the text says, in the order it says them. */
  values?: SpokenSource[];
  /** The long text a piece only names, for reading it out on request. */
  readOut?: SpokenReadOut;
  /**
   * Held back by a short reading: said only when the rest is asked for, and
   * counted as a field or a condition until then.
   */
  held?: "field" | "condition";
}

export interface SpokenReadOut {
  text: string;
  /** The card holds only the start of the text. */
  cut: boolean;
  /** How the text relates to what the user dictated, when it is their dictation. */
  dictated?: DictationRelation;
}

/** A piece as it is composed, before the card gives it its id. */
export type ComposedPiece = Omit<SpokenPiece, "id"> & {
  /**
   * The field as the card names it, for the id, when the voice says another
   * name: ids stay the same whichever words the voice uses.
   */
  idField?: string;
};

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

/** The field as the card names it, where the voice says another name. */
interface CardField {
  cardField?: string;
  /** This field's own natural variants, from the vocabulary. */
  sentences?: Partial<Record<"changed" | "set" | "updated", string>>;
}

export type SpokenDetail = CardField &
  (
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
        /** Entries the label could not keep. */
        omitted: number;
        /** The card cannot tell whether the list is replaced or added to. */
        unknown: boolean;
        loss: true;
      }
    /** Entries the tool says it removes: its word, as the card says. */
    | {
        type: "list_removed";
        field: string;
        values: EarValue[];
        omitted: number;
        loss: true;
      }
    /** Entries the tool says it adds: its word, as the card says. */
    | {
        type: "list_added";
        field: string;
        values: EarValue[];
        omitted: number;
        loss: false;
      }
    /** A list a call sets, with every entry. */
    | {
        type: "list_set";
        field: string;
        values: EarValue[];
        omitted: number;
        loss: false;
      }
    | { type: "unreadable"; field: string; loss: false }
    /** A name a field of the call gives an item the card names only by its ID. */
    | { type: "named"; field: string; value: EarValue; loss: false }
    /** Many losses at once, counted instead of listed. */
    | { type: "losses"; emptied: number; lists: number; loss: true }
  );

export interface SpokenText extends CardField {
  field: string;
  words: number;
  /** The text itself when it is short enough to read. */
  read?: string;
  /** The whole text as the card holds it, read out only on request. */
  full?: SpokenReadOut;
  /** How the text relates to what the user dictated, when it is their dictation. */
  dictated?: DictationRelation;
}

export type SpokenConsequence =
  | "permanent"
  | "restorable"
  | "restore_unknown"
  | "rows_unknown"
  | "instruction_unknown"
  | "nothing_changes"
  /** The tool's own annotation marks it destructive. */
  | "destructive"
  /** The organisation marked the tool destructive, as the screen says. */
  | "destructive_by_organisation";

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
  /**
   * A destructive mark left out because the card says each value: said
   * after all when a short reading holds a detail back.
   */
  markIfHeld?: SpokenConsequence;
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
  /**
   * A change the server applies for an app that checked it: the card says
   * the app's own title and summary of it, not the apply call's input.
   */
  summary?: SpokenSummary;
}

/** A change as the app that prepared it names it. */
export interface SpokenSummary {
  title: string;
  description?: string;
  /** The card needs a choice on screen, so it is never decided by voice. */
  onScreen: boolean;
}

/** What a card for one approval needs from the screen. */
export type SpokenApproval =
  | ({ type: "call" } & SpokenCardInput)
  /** A card the voice only points to: a limit, a plan, a built-in tool, files. */
  | { type: "pointer" };

/** How much a card says: everything it says today, or the first few details. */
export type SpokenAmount = "full" | "short";

export interface SpokenOptions {
  language: string;
  /**
   * `short` holds back the details after the first `shortDetails` (the
   * card's own ranking): the pieces stay, the voice says how many it held
   * back, and the rest says them. Must-say pieces are never held back.
   */
  amount?: SpokenAmount;
  shortDetails?: number;
  /** `natural` says details and the opening in the sentence variants. */
  wording?: "precise" | "natural";
  /** The deployment's sentence variants for this language. */
  sentences?: SentenceSet;
  /**
   * The deployment's number words for this language, to tell a value the
   * user said in words. Without them only digits are read.
   */
  numberWords?: NumberWords;
  /** The spoken-card words of every language; the built-in ones when not given. */
  spokenCardLanguages?: SpokenCardLanguages;
  /** The confirmation phrase of every language; the built-in ones when not given. */
  confirmationPhrases?: ConfirmationPhrases;
  /** Dates in the current year are said without it. */
  now: Date;
  /** The zone times with an offset are said in. */
  timeZone?: string;
  position?: SpokenQueuePosition;
  /**
   * The user's messages in this chat before the card, the latest first,
   * with what of them was dictated. A long text that is their dictation is
   * named as such.
   */
  userTurns?: readonly UserTurn[];
  /**
   * The card may be approved by voice: its request names the phrase, where
   * `voiceApprovalOffered` allows it for the call.
   */
  voiceApproval?: boolean;
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
  /** The request to decide; with `phrase`, naming the phrase that approves. */
  request(phrase?: boolean): string;
  /** A call the card has no verb for: the tool's title and its server. */
  generic(toolTitle: string, server?: string): string;
  /** Before the rest of the card: how many pieces follow. */
  rest(count: number): string;
  /** The rest was asked for and everything was heard. */
  nothingLeft(): string;
  /** The first passage of a long text read out, after its field. */
  readText(field: string, passage: string): string;
  /** After a long text read only in part. */
  textCut(): string;
  /** Before a dictated text read out that is not word for word the dictation. */
  dictatedReadLead(relation: DictationRelation): string;
  notice(notice: SpokenNotice): string;
}

const words = (text: string): number =>
  text.split(/\s+/).filter((word) => word.length > 0).length;

/** A glossary name carries the raw name in brackets for the eye only. */
export const fieldName = (effect: {
  name: string;
  rawName: string;
}): string => {
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
export const effectField = (effect: ChangeEffect): string =>
  fieldName({ name: effectDisplayName(effect), rawName: effect.rawName });

/** Field names that say a value is a share of a hundred. */
const PERCENT_FIELD = /percent|probability|prozent|wahrscheinlichkeit/i;

const valueOf = (
  value: ChangeValue,
  field: string,
  timeZone?: string,
  spoken?: string,
): EarValue =>
  value.machineId
    ? value.text.length > 0
      ? { kind: "text", text: shorten(value.text) }
      : { kind: "unread" }
    : spoken !== undefined
      ? { kind: "text", text: shorten(spoken) }
      : value.meaning
        ? { kind: "text", text: shorten(value.meaning.label) }
        : earValue(value.text, {
            percent: PERCENT_FIELD.test(field),
            timeZone,
          });

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
  whole = false,
  names?: SpokenNames,
): Detailed => {
  // A value in an object inside the record has that object's fields and
  // codes, not the call's table's: it is said as the card shows it.
  const namesOf = (part: { nested: boolean }) =>
    part.nested ? undefined : names;
  const earOf = (value: ChangeValue, field: string, effect: ChangeEffect) =>
    sayable(
      valueOf(
        value,
        field,
        timeZone,
        value.machineId
          ? undefined
          : spokenChoice(namesOf(effect), effect.rawName, value.text),
      ),
    );
  const layout = changeLayout(change);
  const replaceUnknown = listReplaceIsUnknown(change);
  const texts: SpokenText[] = [];
  let named: string | undefined;
  let typedName = false;
  const describe = (effect: ChangeEffect): SpokenDetail | undefined => {
    const shown = effectField(effect);
    const heard = spokenFieldName(namesOf(effect), effect.rawName);
    const field = heard === undefined ? shown : shorten(heard, MAX_FIELD_WORDS);
    const ear = (value: ChangeValue, field: string) =>
      earOf(value, field, effect);
    const entries = () => effect.values.map((value) => ear(value, field));
    const first = effect.values[0] as ChangeValue | undefined;
    const namesItem =
      !effect.nested &&
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
          values: entries(),
          omitted: effect.omitted,
          unknown: replaceUnknown,
          loss: true,
        };
      case "list_removed":
        return {
          type: "list_removed",
          field,
          values: entries(),
          omitted: effect.omitted,
          loss: true,
        };
      case "unreadable":
        return { type: "unreadable", field, loss: false };
      default: {
        if (!first) return undefined;
        // A list is said with its entries; what the tool only says it adds,
        // on its word, as the card marks it.
        if (addsOnToolsWord(change, effect)) {
          return {
            type: "list_added",
            field,
            values: entries(),
            omitted: effect.omitted,
            loss: false,
          };
        }
        if (
          effect.effect === "set" &&
          (effect.list || effect.values.length > 1)
        ) {
          return {
            type: "list_set",
            field,
            values: entries(),
            omitted: effect.omitted,
            loss: false,
          };
        }
        const to = ear(first, field);
        if (isLong(to)) {
          texts.push({
            field,
            ...(heard === undefined ? {} : { cardField: shown }),
            words: to.kind === "text" ? words(to.text) : 0,
            ...(to.kind === "text"
              ? { full: { text: first.text, cut: first.truncated } }
              : {}),
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
  const detailOf = (effect: ChangeEffect): SpokenDetail | undefined => {
    const detail = describe(effect);
    if (!detail) return detail;
    const sentences = spokenFieldSentences(namesOf(effect), effect.rawName);
    return {
      ...detail,
      ...(spokenFieldName(namesOf(effect), effect.rawName) !== undefined
        ? { cardField: effectField(effect) }
        : {}),
      ...(sentences ? { sentences } : {}),
    };
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
  // The name the call typed beside an ID is the listener's only hint which
  // item is meant: it comes first, the one exception to the card's order.
  const typed = values.filter((detail) => detail.type === "named");
  const others = values.filter((detail) => detail.type !== "named");
  let details: SpokenDetail[];
  let omitted: number;
  if (whole) {
    details = [...typed, ...losses, ...unreadable, ...others];
    omitted = 0;
  } else if (losses.length > MAX_LISTED_LOSSES) {
    const rest = [...typed, ...unreadable, ...others];
    const listed = rest.slice(
      0,
      Math.max(MAX_SPOKEN_DETAILS - 1, typed.length + unreadable.length),
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
    const ordered = [...typed, ...losses, ...unreadable, ...others];
    details = ordered.slice(
      0,
      Math.max(
        MAX_SPOKEN_DETAILS,
        typed.length + losses.length + unreadable.length,
      ),
    );
    omitted = ordered.length - details.length;
  }
  // Values the label could not keep are on the card too, in its technical
  // details, and counted with the rest.
  omitted += layout.beyondCap;
  for (const text of change.texts) {
    const shown = fieldName(text);
    const heard = spokenFieldName(namesOf(text), text.rawName);
    const field = heard === undefined ? shown : shorten(heard, MAX_FIELD_WORDS);
    const cardField = heard === undefined ? {} : { cardField: shown };
    // A truncated text is counted by its length; a whole one by its words.
    const count = text.truncated
      ? Math.round(text.chars / 6.5)
      : words(text.text);
    texts.push(
      count > MAX_READ_WORDS || text.truncated
        ? {
            field,
            ...cardField,
            words: count,
            full: { text: text.text, cut: text.truncated },
          }
        : {
            field,
            ...cardField,
            words: count,
            read: shorten(text.text, MAX_READ_WORDS, 200),
          },
    );
  }
  const spokenTexts = whole ? texts : texts.slice(0, MAX_SPOKEN_TEXTS);
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
export const recipientName = (written: string): string => {
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
  if (action === "delete" || unique.length > 0) return unique;
  const marked = destructiveMark(notes);
  return marked ? [marked] : [];
};

/** Who marked the tool destructive, as the screen says: the organisation's mark wins. */
const destructiveMark = (
  notes: GistChange["notes"],
): SpokenConsequence | undefined =>
  notes.includes("operator_marked_destructive")
    ? "destructive_by_organisation"
    : notes.includes("marked_destructive")
      ? "destructive"
      : undefined;

/**
 * A create or update whose voice says each value it writes in a piece of
 * its own, from what to what: a destructive mark then adds nothing the
 * listener needs before deciding. A card that counts, summarises or holds
 * back anything keeps it.
 */
const saysEachValue = (
  change: GistChange | undefined,
  action: GistAction,
  detailed: Detailed,
): boolean =>
  (action === "create" || action === "update") &&
  change !== undefined &&
  change.complete &&
  change.batch === undefined &&
  change.opaque.length === 0 &&
  change.opaqueOmitted === 0 &&
  change.textsOmitted === 0 &&
  !change.recordUnread &&
  !change.hiddenCharacters &&
  !change.notes.includes("list_replace_unknown") &&
  !change.effects.some((effect) => effect.effect === "unreadable") &&
  detailed.omitted === 0 &&
  !detailed.details.some((detail) => detail.type === "losses");

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

/**
 * The facts a gist card holds, read the way the voice needs them. `whole`
 * keeps every detail and text instead of the few a card says, for comparing
 * two cards.
 */
export const spokenFactsOf = (
  gist: Gist,
  server?: string,
  timeZone?: string,
  whole = false,
  vocabulary?: SpokenNames,
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
        whole,
        vocabulary,
      )
    : fieldDetailsOf(gist, timeZone, whole);
  const where = spokenNames(lead.where);
  const facts: Omit<SpokenFacts, "consequences" | "markIfHeld"> = {
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
  };
  return {
    ...facts,
    ...withDestructiveMark(
      consequencesOf(change, gist.action),
      saysEachValue(change, gist.action, detailed) &&
        saysInFull(facts, lead, change),
    ),
  };
};

/** Whether the voice says a value as it is, not cut, counted or unnamed. */
const earSaysAll = (value: EarValue): boolean =>
  value.kind !== "unread" &&
  value.kind !== "id" &&
  (value.kind !== "text" || shorten(value.text) === value.text);

/**
 * Whether the voice says everything the composed card holds in full: every
 * text read, no value or title cut, no list entry or recipient counted, no
 * record or value named only by an ID nobody read.
 */
const saysInFull = (
  facts: Omit<SpokenFacts, "consequences" | "markIfHeld">,
  lead: Gist["items"][number],
  change: GistChange | undefined,
): boolean =>
  !facts.unread &&
  lead.hiddenIdPaths.length === 0 &&
  // An existing item with no name is said as the one whose ID is on screen.
  (CREATING_ACTIONS.includes(facts.action) ||
    facts.count !== 1 ||
    facts.names.length > 0) &&
  lead.names.every(
    (name) => !name.truncated && shorten(name.text) === name.text,
  ) &&
  (facts.recipients === undefined ||
    facts.recipients.names.length >= facts.recipients.total) &&
  facts.texts.every((spoken) => spoken.read !== undefined) &&
  facts.details.every((detail) =>
    "values" in detail
      ? detail.omitted === 0 &&
        detail.values.length <= MAX_LISTED_ENTRIES &&
        detail.values.every(earSaysAll)
      : detailValues(detail)
          .filter((source) => source.slot !== "field")
          .every((source) => earSaysAll(source.value)),
  ) &&
  !(change?.effects ?? []).some((effect) =>
    [...effect.values, ...effect.added, ...effect.removed, effect.old].some(
      (value) => value?.truncated === true,
    ),
  );

/**
 * The consequences to say. A destructive mark alone, on a card that says
 * each value, is kept aside: said only if a short reading holds something
 * back.
 */
const withDestructiveMark = (
  consequences: SpokenConsequence[],
  saysEach: boolean,
): Pick<SpokenFacts, "consequences" | "markIfHeld"> => {
  const [only] = consequences;
  return saysEach &&
    consequences.length === 1 &&
    (only === "destructive" || only === "destructive_by_organisation")
    ? { consequences: [], markIfHeld: only }
    : { consequences };
};

/**
 * `facts` with each long text that is the user's dictation marked so. A text
 * the card holds only in part is never compared: its rest is unknown. An
 * instruction before the dictation is read in German, English and the
 * card's `language`.
 */
export const withDictation = (
  facts: SpokenFacts,
  turns: readonly UserTurn[] | undefined,
  language: string,
  languages?: SpokenCardLanguages,
): SpokenFacts => {
  if (!turns || turns.length === 0) return facts;
  return {
    ...facts,
    texts: facts.texts.map((spoken) => {
      if (spoken.read !== undefined || !spoken.full || spoken.full.cut) {
        return spoken;
      }
      const dictated = dictationOf(
        spoken.full.text,
        turns,
        language,
        languages,
      );
      return dictated
        ? { ...spoken, dictated, full: { ...spoken.full, dictated } }
        : spoken;
    }),
  };
};

/** The values a text piece says: its field, then its words, its size or where it came from. */
export const textValues = (spoken: SpokenText): SpokenSource[] => [
  ...(spoken.field ? [text("field", spoken.field)] : []),
  spoken.read !== undefined
    ? text("text", spoken.read)
    : spoken.dictated
      ? text("dictated", spoken.dictated)
      : number("words", spoken.words),
];

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
              omitted: 0,
              unknown: false,
              loss: true,
            },
          ]
        : [],
  );

/** A label stored before change descriptions: its fields as the card lists them. */
const fieldDetailsOf = (
  gist: Gist,
  timeZone?: string,
  whole = false,
): Detailed => {
  const lead = gist.items[0];
  const details: SpokenDetail[] = [];
  const texts: SpokenText[] = [];
  for (const field of lead.fields) {
    const [entry] = field.values;
    if (!(entry as (typeof field.values)[number] | undefined)) continue;
    const to = earOf(entry.value, field.name, timeZone);
    if (isLong(to)) {
      texts.push({
        field: field.name,
        words: words(entry.value.text),
        full: { text: entry.value.text, cut: entry.value.truncated },
      });
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
        ? {
            field: "",
            words: count,
            full: { text: after.text, cut: after.truncated },
          }
        : { field: "", words: count, read: after.text },
    );
  }
  return {
    details: whole ? details : details.slice(0, MAX_SPOKEN_DETAILS),
    omitted: whole ? 0 : Math.max(details.length - MAX_SPOKEN_DETAILS, 0),
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

export const whatValues = (facts: SpokenFacts): SpokenSource[] => [
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

export const detailValues = (detail: SpokenDetail): SpokenSource[] => {
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
    case "list_set":
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
const fitted = (pieces: ComposedPiece[], cut: string): ComposedPiece[] => {
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

/** The field a detail or a text piece is about, as the card shows it. */
export const spokenPieceField = (piece: ComposedPiece): string | undefined => {
  const field = piece.values?.find((source) => source.slot === "field")?.value;
  return field?.kind === "text" && field.text.length > 0
    ? field.text
    : undefined;
};

/** Ids the voice command endpoint takes: unique, at most 64 characters. */
const MAX_ID_CHARS = 60;

const withIds = (pieces: readonly ComposedPiece[]): SpokenPiece[] => {
  const seen = new Map<string, number>();
  return pieces.map(({ idField, ...piece }) => {
    const field = idField ?? spokenPieceField(piece);
    const base = Array.from(field ? `${piece.role}:${field}` : piece.role)
      .slice(0, MAX_ID_CHARS)
      .join("");
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return {
      id: occurrence === 1 ? base : `${base}#${occurrence}`,
      ...piece,
    };
  });
};

/** The pieces for one approval in the language given. */
export const spokenApprovalPieces = (
  approval: SpokenApproval,
  options: SpokenOptions,
): SpokenPiece[] =>
  withIds(
    fitted(
      mustHearWhatIsApproved(
        composedPieces(approval, options),
        approval,
        options,
      ),
      spokenWordsFor(options.language, options).cut(),
    ),
  );

/** Composed pieces as the endpoint takes them, with their ids. */
export const spokenPiecesOf = (
  pieces: ComposedPiece[],
  options: SpokenOptions,
): SpokenPiece[] =>
  withIds(fitted(pieces, spokenWordsFor(options.language, options).cut()));

/**
 * Where the card offers the phrase, what the call does and on which record
 * must be heard before it counts, as for a delete: skipping them has the
 * voice say them again before the request.
 */
const mustHearWhatIsApproved = (
  pieces: ComposedPiece[],
  approval: SpokenApproval,
  options: SpokenOptions,
): ComposedPiece[] =>
  options.voiceApproval === true && voiceApprovalOffered(approval)
    ? pieces.map((piece) =>
        piece.role === "what" || piece.role === "item"
          ? { ...piece, mustSay: true }
          : piece,
      )
    : pieces;

const composedPieces = (
  approval: SpokenApproval,
  options: SpokenOptions,
): ComposedPiece[] => {
  const words = spokenWordsFor(options.language, options);
  const pointer: ComposedPiece[] = [
    { role: "pointer", text: words.pointer(), mustSay: false, values: [] },
  ];
  if (!words.full || approval.type === "pointer") return pointer;
  const { position } = options;
  const pieces: ComposedPiece[] = [];
  if (position?.index === 0 && position.total > 1) {
    pieces.push({
      role: "count",
      text: words.count(position.total),
      mustSay: false,
      values: [number("count", position.total)],
    });
  }
  const request: ComposedPiece = {
    role: "request",
    text: words.request(
      options.voiceApproval === true && voiceApprovalOffered(approval),
    ),
    mustSay: false,
    values: [],
  };
  if (approval.summary) {
    pieces.push(...summaryPieces(approval.summary), request);
    return pieces;
  }
  const names = spokenNamesFor(approval.label, options.language);
  const read = spokenReadFactsOf(
    approval.label,
    approval.server,
    options.timeZone,
    names,
  );
  if (read) {
    pieces.push(
      ...spokenReadPieces(read, words.read, position, options),
      request,
    );
    return pieces;
  }
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
  const facts = withDictation(
    spokenFactsOf(card.gist, approval.server, options.timeZone, false, names),
    options.userTurns,
    options.language,
    options.spokenCardLanguages,
  );
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
  const hold = holder(options);
  for (const detail of facts.details) {
    // A loss is always said; so is the name typed beside an ID, the
    // listener's only hint which item is meant, and a value the card cannot
    // name: the record is not what the listener may expect.
    const held =
      detail.loss ||
      detail.type === "named" ||
      // An addition taken on the tool's word: the card cannot vouch for it.
      detail.type === "list_added" ||
      surprises(detail)
        ? undefined
        : hold.next();
    pieces.push({
      role: "detail",
      text: words.detail(detail, facts),
      mustSay: detail.loss,
      values: detailValues(detail),
      ...(detail.cardField ? { idField: detail.cardField } : {}),
      ...(held ? { held } : {}),
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
    // A dictation the call does not take word for word is always said.
    const held =
      spokenText.dictated === undefined || spokenText.dictated === "unchanged"
        ? hold.next()
        : undefined;
    pieces.push({
      ...(held ? { held } : {}),
      role: "text",
      text: words.text(spokenText),
      mustSay: false,
      values: textValues(spokenText),
      ...(spokenText.read === undefined && spokenText.full
        ? { readOut: spokenText.full }
        : {}),
      ...(spokenText.cardField ? { idField: spokenText.cardField } : {}),
    });
  }
  const consequences =
    facts.markIfHeld && pieces.some((piece) => piece.held !== undefined)
      ? [facts.markIfHeld]
      : facts.consequences;
  if (consequences.length > 0) {
    pieces.push({
      role: "consequence",
      text: words.consequence(consequences, facts),
      mustSay: true,
      values: consequences.map((consequence) =>
        text("consequence", consequence),
      ),
    });
  }
  pieces.push(loss ? { ...request, pauseBeforeMs: DELETE_PAUSE_MS } : request);
  return hold.withMore(pieces);
};

/** An app's own sentence, ended so the voice pauses after it. */
const asSentence = (value: string): string => {
  const trimmed = value.trim();
  return /[.!?…:]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

/**
 * A change named by its app: the title as what the call does, the summary as
 * its one detail. Both are said before a decision by voice counts.
 */
const summaryPieces = (summary: SpokenSummary): ComposedPiece[] => {
  const title = shorten(summary.title, Number.MAX_SAFE_INTEGER);
  const description = summary.description?.trim();
  return [
    {
      role: "what",
      text: asSentence(title),
      mustSay: false,
      values: [text("text", title)],
    },
    ...(description
      ? [
          {
            role: "detail" as const,
            text: asSentence(
              shorten(description, Number.MAX_SAFE_INTEGER, MAX_PIECE_CHARS),
            ),
            mustSay: true,
            values: [text("text", description)],
          },
        ]
      : []),
  ];
};

/**
 * Whether a read's reading says a condition of its own: one that is not held
 * back. Otherwise the held-back sentence names the conditions without
 * "further" ("Mit zwei Bedingungen, sie stehen auf dem Bildschirm.").
 */
const saysCondition = (pieces: readonly SpokenPiece[]): boolean =>
  pieces.some(
    (piece) =>
      piece.role === "detail" &&
      piece.held === undefined &&
      (piece.values?.some((source) => source.slot === "field") ?? false),
  );

/** The values a detail says. */
const earsOf = (detail: SpokenDetail): EarValue[] => {
  switch (detail.type) {
    case "set":
    case "named":
      return [detail.value];
    case "changed":
      return [detail.from, detail.to];
    case "emptied":
      return [];
    default:
      return "values" in detail ? detail.values : [];
  }
};

/**
 * A detail that says a record was never read in this chat, or is known only
 * by an ID on screen: the listener must hear it before deciding.
 */
const surprises = (detail: SpokenDetail): boolean =>
  earsOf(detail).some((ear) => ear.kind === "unread" || ear.kind === "id");

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
      description?: string | null;
      server_name?: string | null;
      label?: ToolCallLabel;
    } | null;
    child?: unknown;
    chained?: { decide_on_screen?: boolean } | null;
  },
): SpokenApproval => {
  if (call.child == null && !DESCRIBED_KINDS.includes(approvalKind)) {
    return { type: "pointer" };
  }
  const toolTitle = call.display?.title ?? call.tool_name;
  return {
    type: "call",
    label: call.display?.label,
    input: call.input,
    toolTitle,
    server: call.display?.server_name ?? undefined,
    ...(call.child == null && call.chained
      ? {
          summary: {
            title: toolTitle,
            ...(call.display?.description
              ? { description: call.display.description }
              : {}),
            onScreen: call.chained.decide_on_screen === true,
          },
        }
      : {}),
  };
};

/** More items than this are approved on screen. */
export const MAX_VOICE_ITEMS = 20;

/** The things a label acts on: a batch's total, else the first item's names. */
const labelItemCount = (label: ToolCallLabel): number => {
  const total = label.change?.batch?.total;
  if (total !== undefined) return total;
  const item = label.items?.[0];
  const slot = (item?.title?.values?.length ?? 0) > 0 ? item?.title : item?.id;
  return Math.max((slot?.values?.length ?? 0) + (slot?.omitted ?? 0), 1);
};

/**
 * Whether a call's label lets it be approved by voice. The backend decides
 * from the same fields before it accepts the phrase (`label_is_screen_only`);
 * both are checked against `fixtures/spokenCards/voiceApprovals.json`.
 */
export const voiceApprovable = (
  label: ToolCallLabel | null | undefined,
): boolean => {
  if (!label) return false;
  // A read keeps a generic label but says what it looks at.
  const generic =
    !label.read && (label.source === "generic" || label.action === "other");
  const { change } = label;
  return (
    !generic &&
    // SQL stays on screen, a plain read included.
    !label.read?.query &&
    (label.warnings ?? []).length === 0 &&
    label.action !== "run" &&
    (change?.opaque ?? []).length === 0 &&
    (change?.opaque_omitted ?? 0) === 0 &&
    labelItemCount(label) <= MAX_VOICE_ITEMS
  );
};

/**
 * Whether the card asks for the phrase: the label allows it, and the voice
 * can say the call, as a read or as the card's own description.
 */
export const voiceApprovalOffered = (approval: SpokenApproval): boolean =>
  approval.type === "call" &&
  voiceApprovable(approval.label) &&
  (approval.summary
    ? !approval.summary.onScreen
    : spokenReadFactsOf(approval.label) !== undefined ||
      toolCallCardOf(approval.label, approval.input).kind === "gist");

/** Whether two approvals said one after another are of the same kind. */
export const sameSpokenKind = (
  a: SpokenApproval | undefined,
  b: SpokenApproval | undefined,
): boolean => {
  if (a?.type !== "call" || b?.type !== "call") return false;
  if (a.summary || b.summary) return false;
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

/** A passage of a long text read out; short, so stopping it is quick. */
const MAX_PASSAGE_CHARS = 300;

/** `text` in passages that end at a sentence, or at a word when one is too long. */
const passagesOf = (text: string): string[] => {
  const sentences = text
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .flatMap((sentence) =>
      sentence.length <= MAX_PASSAGE_CHARS
        ? [sentence]
        : sentence.split(/\s+/).reduce<string[]>((parts, word) => {
            const last = parts.at(-1);
            if (
              last !== undefined &&
              `${last} ${word}`.length <= MAX_PASSAGE_CHARS
            )
              parts[parts.length - 1] = `${last} ${word}`;
            else parts.push(word.slice(0, MAX_PASSAGE_CHARS));
            return parts;
          }, []),
    );
  return sentences.reduce<string[]>((passages, sentence) => {
    const last = passages.at(-1);
    if (last !== undefined && `${last} ${sentence}`.length <= MAX_PASSAGE_CHARS)
      passages[passages.length - 1] = `${last} ${sentence}`;
    else passages.push(sentence);
    return passages;
  }, []);
};

/**
 * A long text read out on request: its field, then the text in passages, as
 * much as one request to the voice takes; a text the card holds only in part,
 * or that is longer than that, ends by pointing to the screen.
 */
const readOutSentences = (piece: SpokenPiece, words: SpokenWords): string[] => {
  if (!piece.readOut) return [];
  const field = spokenPieceField(piece) ?? "";
  const ending = words.textCut();
  const budget = MAX_CARD_CHARS - ending.length;
  const { dictated } = piece.readOut;
  // A dictated text that differs from the dictation says so before it is read.
  const said: string[] =
    dictated && dictated !== "unchanged"
      ? [words.dictatedReadLead(dictated)]
      : [];
  const leading = said.length;
  let used = said.join("").length;
  let cut = piece.readOut.cut;
  for (const passage of passagesOf(piece.readOut.text)) {
    const sentence =
      said.length === leading && field.length > 0
        ? words.readText(field, passage)
        : passage;
    if (
      sentence.length > MAX_PIECE_CHARS ||
      used + sentence.length > budget ||
      said.length === MAX_PIECES - 1
    ) {
      cut = true;
      break;
    }
    said.push(sentence);
    used += sentence.length;
  }
  return cut ? [...said, ending] : said;
};

/**
 * What the voice says for an utterance that is not one of the card's
 * pieces: how much is left, that nothing is, a long text, or a notice. Each
 * entry is one sentence for the voice endpoint, within its limits.
 */
export const spokenUtteranceSentences = (
  utterance: SpokenUtterance,
  pieces: readonly SpokenPiece[],
  options: Pick<
    SpokenOptions,
    "language" | "now" | "timeZone" | "confirmationPhrases"
  >,
): string[] => {
  const words = spokenWordsFor(options.language, options);
  switch (utterance.type) {
    case "piece":
      return [pieces[utterance.index].text];
    case "count":
      return [words.rest(utterance.count)];
    case "nothing_left":
      return [words.nothingLeft()];
    case "held":
      return [
        utterance.kind === "condition"
          ? words.read.moreConditions(utterance.count, saysCondition(pieces))
          : words.more(utterance.count),
      ];
    case "text":
      return readOutSentences(pieces[utterance.index], words);
    case "notice":
      return [words.notice(utterance.notice)];
  }
};
