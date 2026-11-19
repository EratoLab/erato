import { plural, select, t } from "@lingui/core/macro";

import { wallClockParts } from "@/components/ui/Scheduled/scheduledTime";

import { changeNoteLabel } from "./changeLabels";
import { fillVariant, naturalVariant } from "./spokenSentences";
import { bothPercent } from "./spokenValues";

import type { GistKind } from "./gist";
import type {
  SpokenConsequence,
  SpokenDetail,
  SpokenFacts,
  SpokenQueuePosition,
  SpokenRecipients,
  SpokenText,
  SpokenWords,
} from "./spokenCard";
import type { SpokenNotice } from "./spokenCardFlow";
import type { DictationRelation } from "./spokenDictation";
import type {
  SpokenCondition,
  SpokenReadFacts,
  SpokenReadWords,
} from "./spokenRead";
import type { SentenceSet } from "./spokenSentences";
import type { EarValue } from "./spokenValues";

/**
 * The spoken card's sentences. Each is a catalog message, so a language
 * writes its own grammar (gender, case, number) with `select` and `plural`;
 * only number words, ordinals and German times are code. German and English
 * say the whole card; a language nobody has judged yet says only that a
 * decision waits on screen. No sentence addresses the listener with "du" or
 * "Sie".
 */

interface WordOptions {
  now: Date;
  /** The zone "today" is in; the device's when not given. */
  timeZone?: string;
  /** `natural` says details and the opening in the sentence variants. */
  wording?: "precise" | "natural";
  /** The deployment's sentence variants for this language. */
  sentences?: SentenceSet;
}

interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

const DAY_MS = 86_400_000;
/** Dates up to this far ahead are said without their year. */
const YEAR_LEFT_OUT_DAYS = 335;

/**
 * Whether a date is said without its year: from today up to about eleven
 * months ahead, where the next such date is meant. A past date, or one
 * further out, keeps its year.
 */
const leavesOutYear = (value: CalendarDay, today: CalendarDay): boolean => {
  const days =
    (Date.UTC(value.year, value.month - 1, value.day) -
      Date.UTC(today.year, today.month - 1, today.day)) /
    DAY_MS;
  return days >= 0 && days <= YEAR_LEFT_OUT_DAYS;
};

const yearsDiffer = (from: EarValue, to: EarValue): boolean =>
  (from.kind === "date" || from.kind === "datetime") &&
  (to.kind === "date" || to.kind === "datetime") &&
  from.year !== to.year;

/** How a corrected card is introduced, by what is said after it. */
export type DifferenceIntro =
  /** Only what differs from the withdrawn card follows. */
  | "changed"
  /** Nothing differs. */
  | "same"
  /** The card is about another item; it is said in full. */
  | "other_item"
  /** The withdrawn card was hardly heard; the new one is said in full. */
  | "reread";

/**
 * Whether the user's words asked for a difference: they did, they did not,
 * or they may have but the product cannot tell (a number said in words it
 * cannot read). The last is said without either claim.
 */
export type Asked = "asked" | "unasked" | "unsure";

/** The sentences that compare a corrected card with the one it replaces. */
export interface DifferenceWords {
  /** `what`, the new card's own first sentence, after its introduction. */
  intro(kind: DifferenceIntro, what: string): string;
  /** A difference, marked when the user did not ask for it. */
  differs(asked: Asked, sentence: string): string;
  /** A field the withdrawn card had and the new one leaves out. */
  dropped(field: string): string;
  /** The new title of something being created. */
  title(kind: GistKind, name: string): string;
  /** Who a group of recipients (to, copy, blind copy) is now; `names` already listed. */
  recipientsIn(
    kind: string,
    group: string,
    names: readonly string[],
    more: number,
  ): string;
  /** A statement the call runs (a query, a script) is different. */
  statement(kind: string): string;
  /** How many rows of a batch are different. */
  rows(count: number): string;
  /** A field that is different, where its value cannot be said. */
  field(field: string): string;
  /** Differences past the ones said, counted; marked like them. */
  more(count: number, asked: Asked): string;
  /** After the differences: everything else stays. */
  rest(): string;
  /** After the differences: the call differs in more than was said. */
  elsewhere(): string;
  /** The call differs only in what the voice cannot say. */
  unreadable(): string;
  /** The card came back unchanged: what can be done. */
  sameHint(): string;
}

export type LanguageWords = SpokenWords & {
  /** Whether the language says the whole card, not only the pointer. */
  full: boolean;
  read: SpokenReadWords;
  difference: DifferenceWords;
};

/** What a language says as code: number words, ordinals, times. */
interface LanguageCode {
  /** The locale `Intl` formats dates, numbers and lists in. */
  locale: string;
  numbers: readonly string[];
  ordinals: readonly string[];
  /** A time of day; `undefined` leaves it to `Intl`. */
  time?: (hour: number, minute: number) => string;
  /**
   * An old or new value with its direction, for a sentence variant, where
   * the language's value in that role carries none ("from 1 December"). A
   * German value carries it already ("vom 1. Dezember").
   */
  directed?: (role: "from" | "to", value: string) => string;
}

/* eslint-disable lingui/no-unlocalized-strings -- number words, ordinals and locales are code, not catalog copy */
const GERMAN: LanguageCode = {
  locale: "de-DE",
  numbers: [
    "null",
    "eins",
    "zwei",
    "drei",
    "vier",
    "fünf",
    "sechs",
    "sieben",
    "acht",
    "neun",
    "zehn",
    "elf",
    "zwölf",
  ],
  ordinals: [
    "erste",
    "zweite",
    "dritte",
    "vierte",
    "fünfte",
    "sechste",
    "siebte",
    "achte",
    "neunte",
    "zehnte",
  ],
  // Said as people say it: "10 Uhr", "10:30 Uhr".
  time: (hour, minute) =>
    minute === 0
      ? `${hour} Uhr`
      : `${hour}:${String(minute).padStart(2, "0")} Uhr`,
};

const ENGLISH: LanguageCode = {
  locale: "en-GB",
  directed: (role, value) => `${role} ${value}`,
  numbers: [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
  ],
  ordinals: [
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
  ],
};
/* eslint-enable lingui/no-unlocalized-strings */

/** `Intl` separates some parts with no-break spaces; a voice needs none. */
const plainSpaces = (text: string): string =>
  text.replace(/[\u00a0\u202f]/g, " ");

const capitalised = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);

const endSentence = (text: string): string =>
  /[.!?…:]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;

/** Entries of a list said before the rest are counted. */
/** List entries said one by one; more are counted. */
export const MAX_LISTED_ENTRIES = 3;

const roundWords = (count: number): number =>
  count < 20
    ? count
    : count < 200
      ? Math.round(count / 10) * 10
      : Math.round(count / 50) * 50;

/**
 * A sentence with optional parts: an empty part leaves no double space and
 * no space before punctuation. The parts go in as stand-ins, so their own
 * text is never touched.
 */
const withParts = <K extends string>(
  parts: Record<K, string>,
  frame: (slots: Record<K, string>) => string,
): string => {
  const keys = Object.keys(parts) as K[];
  const mark = (index: number) => String.fromCharCode(0xe030 + index);
  const slots = Object.fromEntries(
    keys.map((key, index) => [key, parts[key].length > 0 ? mark(index) : ""]),
  ) as Record<K, string>;
  let text = frame(slots)
    .replace(/\s+/g, " ")
    .replace(/ ([.,:])/g, "$1")
    .trim();
  keys.forEach((key, index) => {
    text = text.replaceAll(mark(index), parts[key]);
  });
  return text;
};

// ---------------------------------------------------------------------------
// The catalog's sentences

const pointerSentence = (): string =>
  t({
    id: "spokenCard.pointer",
    message: "A decision is waiting on screen.",
  });

/** The thing a call acts on, one of it, as the object of "I'd like to …". */
const oneThing = (kind: GistKind): string =>
  t({
    id: "spokenCard.thing.one",
    message: select(kind, {
      page: "a page",
      row: "a record",
      database: "a database",
      folder: "a folder",
      note: "a note",
      comment: "a comment",
      paragraph: "a paragraph",
      document: "a document",
      email: "an email",
      message: "a message",
      event: "an event",
      file: "a file",
      task: "a task",
      other: "an item",
    }),
  });

const namedThing = (kind: GistKind, name: string): string =>
  t({
    id: "spokenCard.thing.named",
    message: select(kind, {
      page: `the page ${name}`,
      row: `the record ${name}`,
      database: `the database ${name}`,
      folder: `the folder ${name}`,
      note: `the note ${name}`,
      comment: `the comment ${name}`,
      paragraph: `the paragraph ${name}`,
      document: `the document ${name}`,
      email: `the email ${name}`,
      message: `the message ${name}`,
      event: `the event ${name}`,
      file: `the file ${name}`,
      task: `the task ${name}`,
      other: `the item ${name}`,
    }),
  });

const countedThings = (kind: GistKind, countWord: string): string =>
  t({
    id: "spokenCard.thing.counted",
    message: select(kind, {
      page: `${countWord} pages`,
      row: `${countWord} records`,
      database: `${countWord} databases`,
      folder: `${countWord} folders`,
      note: `${countWord} notes`,
      comment: `${countWord} comments`,
      paragraph: `${countWord} paragraphs`,
      document: `${countWord} documents`,
      email: `${countWord} emails`,
      message: `${countWord} messages`,
      event: `${countWord} events`,
      file: `${countWord} files`,
      task: `${countWord} tasks`,
      other: `${countWord} items`,
    }),
  });

const countedThingsIncluding = (
  kind: GistKind,
  countWord: string,
  names: string,
): string =>
  t({
    id: "spokenCard.thing.including",
    message: select(kind, {
      page: `${countWord} pages, including ${names},`,
      row: `${countWord} records, including ${names},`,
      database: `${countWord} databases, including ${names},`,
      folder: `${countWord} folders, including ${names},`,
      note: `${countWord} notes, including ${names},`,
      comment: `${countWord} comments, including ${names},`,
      paragraph: `${countWord} paragraphs, including ${names},`,
      document: `${countWord} documents, including ${names},`,
      email: `${countWord} emails, including ${names},`,
      message: `${countWord} messages, including ${names},`,
      event: `${countWord} events, including ${names},`,
      file: `${countWord} files, including ${names},`,
      task: `${countWord} tasks, including ${names},`,
      other: `${countWord} items, including ${names},`,
    }),
  });

const namedThings = (kind: GistKind, names: string): string =>
  t({
    id: "spokenCard.thing.namedMany",
    message: select(kind, {
      page: `the pages ${names}`,
      row: `the records ${names}`,
      database: `the databases ${names}`,
      folder: `the folders ${names}`,
      note: `the notes ${names}`,
      comment: `the comments ${names}`,
      paragraph: `the paragraphs ${names}`,
      document: `the documents ${names}`,
      email: `the emails ${names}`,
      message: `the messages ${names}`,
      event: `the events ${names}`,
      file: `the files ${names}`,
      task: `the tasks ${names}`,
      other: `the items ${names}`,
    }),
  });

/** One thing as the subject of a short sentence, "Die zweite: eine Aufgabe". */
const oneThingShort = (kind: GistKind): string =>
  t({
    id: "spokenCard.short.one",
    message: select(kind, {
      page: "a page",
      row: "a record",
      database: "a database",
      folder: "a folder",
      note: "a note",
      comment: "a comment",
      paragraph: "a paragraph",
      document: "a document",
      email: "an email",
      message: "a message",
      event: "an event",
      file: "a file",
      task: "a task",
      other: "an item",
    }),
  });

const namedThingShort = (kind: GistKind, name: string): string =>
  t({
    id: "spokenCard.short.named",
    message: select(kind, {
      page: `the page ${name}`,
      row: `the record ${name}`,
      database: `the database ${name}`,
      folder: `the folder ${name}`,
      note: `the note ${name}`,
      comment: `the comment ${name}`,
      paragraph: `the paragraph ${name}`,
      document: `the document ${name}`,
      email: `the email ${name}`,
      message: `the message ${name}`,
      event: `the event ${name}`,
      file: `the file ${name}`,
      task: `the task ${name}`,
      other: `the item ${name}`,
    }),
  });

const titledShort = (thing: string, name: string): string =>
  t({ id: "spokenCard.short.titled", message: `${thing}, ${name}` });

/** What follows a thing nobody named: never read, or shown only by its ID. */
const unnamedClause = (kind: GistKind, unread: boolean): string =>
  unread
    ? t({
        id: "spokenCard.clause.unread",
        message: select(kind, { other: "that I haven't read in this chat" }),
      })
    : t({
        id: "spokenCard.clause.id",
        message: select(kind, { other: "whose ID is shown on screen" }),
      });

/** Where the call goes: its server, as the sentence for `direction` needs it. */
const sourcePhrase = (direction: "from" | "in", server: string): string =>
  t({
    id: "spokenCard.source",
    message: select(direction, {
      from: `from ${server}`,
      other: `in ${server}`,
    }),
  });

type DestinationShape =
  | "recipients"
  | "sendPlace"
  | "share"
  | "move"
  | "createIn";

const destinationPhrase = (
  shape: DestinationShape,
  kind: GistKind,
  target: string,
): string =>
  t({
    id: "spokenCard.destination",
    message: select(shape, {
      recipients: `to ${target}`,
      sendPlace: select(kind, { other: `to ${target}` }),
      share: `with ${target}`,
      move: `to ${target}`,
      other: `in ${target}`,
    }),
  });

/** The sentence that opens a card: what, where and which item. */
const whatSentence = (
  action: string,
  parts: {
    thing: string;
    destination: string;
    source: string;
    clause: string;
  },
): string =>
  withParts(parts, ({ thing, destination, source, clause }) =>
    t({
      id: "spokenCard.what",
      message: select(action, {
        create: `I'd like to create ${thing} ${destination} ${source} ${clause}`,
        update: `I'd like to change ${thing} ${destination} ${source} ${clause}`,
        reschedule: `I'd like to reschedule ${thing} ${destination} ${source} ${clause}`,
        delete: `I'd like to delete ${thing} ${destination} ${source} ${clause}`,
        send: `I'd like to send ${thing} ${destination} ${source} ${clause}`,
        move: `I'd like to move ${thing} ${destination} ${source} ${clause}`,
        comment: `I'd like to comment on ${thing} ${destination} ${source} ${clause}`,
        share: `I'd like to share ${thing} ${destination} ${source} ${clause}`,
        run: `I'd like to run ${thing} ${destination} ${source} ${clause}`,
        upsert: `I'd like to create or update ${thing} ${destination} ${source} ${clause}`,
        archive: `I'd like to archive ${thing} ${destination} ${source} ${clause}`,
        upload: `I'd like to upload ${thing} ${destination} ${source} ${clause}`,
        other: `I'd like to work on ${thing} ${destination} ${source} ${clause}`,
      }),
    }),
  );

const statementSentence = (statement: string, source: string): string =>
  withParts({ source }, ({ source }) =>
    t({
      id: "spokenCard.what.statement",
      message: select(statement, {
        sql: `I'd like to run an SQL query ${source}. It's shown on screen.`,
        shell: `I'd like to run a shell command ${source}. It's shown on screen.`,
        code: `I'd like to run a piece of code ${source}. It's shown on screen.`,
        other: `I'd like to run an instruction ${source}. It's shown on screen.`,
      }),
    }),
  );

const genericSentence = (tool: string, source: string): string =>
  withParts({ tool, source }, ({ tool, source }) =>
    t({
      id: "spokenCard.what.generic",
      message: `I'd like to use the tool ${tool} ${source}.`,
    }),
  );

const ordinalPrefix = (ordinal: string | undefined): string =>
  ordinal === undefined
    ? t({ id: "spokenCard.ordinal.next", message: "The next one:" })
    : t({ id: "spokenCard.ordinal", message: `The ${ordinal} one:` });

const countSentence = (countWord: string): string =>
  t({
    id: "spokenCard.count",
    message: `I need ${countWord} approvals for this.`,
  });

const subjectLine = (name: string): string =>
  t({ id: "spokenCard.item.subject", message: `Subject: ${name}` });

const recipientsPhrase = (
  shape: "unnamed" | "named",
  total: number,
  rest: number,
  name: string,
  countWord: string,
): string =>
  t({
    id: "spokenCard.recipients",
    message: select(shape, {
      unnamed: plural(total, {
        one: "one recipient",
        other: `${countWord} recipients`,
      }),
      other: plural(rest, {
        one: `${name} and one other`,
        other: `${name} and ${countWord} others`,
      }),
    }),
  });

const outsideSentence = (
  shape: "single" | "all" | "some",
  outside: number,
  countWord: string,
): string =>
  t({
    id: "spokenCard.outside",
    message: select(shape, {
      single: "The recipient is outside the organisation.",
      all: "All recipients are outside the organisation.",
      other: plural(outside, {
        one: "One recipient is outside the organisation.",
        other: `${countWord} of the recipients are outside the organisation.`,
      }),
    }),
  });

type ValueKind = "date" | "unread" | "id" | "other";

/** A value with what it plays in its sentence: what it was, what it becomes. */
const valueInRole = (
  role: "from" | "to" | "plain",
  kind: ValueKind,
  value: string,
): string =>
  t({
    id: "spokenCard.value",
    message: select(role, {
      from: select(kind, {
        unread: "a record I haven't read in this chat",
        id: "an item whose ID is shown on screen",
        // eslint-disable-next-line lingui/no-single-variables-to-translate -- the value itself, where the language adds nothing around it
        other: `${value}`,
      }),
      to: select(kind, {
        unread: "a record I haven't read in this chat",
        id: "an item whose ID is shown on screen",
        // eslint-disable-next-line lingui/no-single-variables-to-translate -- the value itself, where the language adds nothing around it
        other: `${value}`,
      }),
      other: select(kind, {
        unread: "a record I haven't read in this chat",
        id: "an item whose ID is shown on screen",
        // eslint-disable-next-line lingui/no-single-variables-to-translate -- the value itself, where the language adds nothing around it
        other: `${value}`,
      }),
    }),
  });

const percentValue = (number: string): string =>
  t({ id: "spokenCard.value.percent", message: `${number} percent` });

const yesValue = (): string =>
  t({ id: "spokenCard.value.yes", message: "yes" });

const noValue = (): string => t({ id: "spokenCard.value.no", message: "no" });

const dateTimeValue = (date: string, time: string): string =>
  t({ id: "spokenCard.value.dateTime", message: `${date} at ${time}` });

const fieldValue = (field: string, value: string): string =>
  t({ id: "spokenCard.detail.value", message: `${field}: ${value}` });

/** A value set; `kind` says whether it ends in a clause of its own. */
const detailSetTo = (kind: ValueKind, field: string, value: string): string =>
  t({
    id: "spokenCard.detail.setTo",
    message: select(kind, { other: `${field} will be set to ${value}.` }),
  });

const detailChanged = (field: string, from: string, to: string): string =>
  t({
    id: "spokenCard.detail.changed",
    message: `${field}: from ${from} to ${to}`,
  });

const detailEmptied = (field: string): string =>
  t({
    id: "spokenCard.detail.emptied",
    message: `The field ${field} will be emptied.`,
  });

const detailListReplaced = (
  shape: "values" | "none",
  field: string,
  values: string,
): string =>
  t({
    id: "spokenCard.detail.listReplaced",
    message: select(shape, {
      values: `The list ${field} will be replaced with ${values}.`,
      other: `The list ${field} will be replaced.`,
    }),
  });

/** A list the card cannot tell is replaced or added to: said as the card says it. */
const detailListMaybeReplaced = (
  shape: "values" | "none",
  field: string,
  values: string,
): string =>
  t({
    id: "spokenCard.detail.listMaybeReplaced",
    message: select(shape, {
      values: `The list ${field} gets ${values}. Whether that replaces the list or adds to it is not known.`,
      other: `Whether the list ${field} is replaced or added to is not known.`,
    }),
  });

/** Entries the tool says it removes from a list: on its word, as the card says. */
const detailListRemoved = (
  count: number,
  field: string,
  values: string,
): string =>
  t({
    id: "spokenCard.detail.listRemovedClaim",
    message: plural(count, {
      one: `${values} will be removed from ${field}, the tool says.`,
      other: `${values} will be removed from ${field}, the tool says.`,
    }),
  });

/** Entries the tool says it adds to a list: on its word, as the card says. */
const detailListAdded = (
  count: number,
  field: string,
  values: string,
): string =>
  t({
    id: "spokenCard.detail.listAddedClaim",
    message: plural(count, {
      one: `${values} will be added to ${field}, the tool says.`,
      other: `${values} will be added to ${field}, the tool says.`,
    }),
  });

/** Entries past the ones a list says, counted: "and two more". */
const moreEntries = (count: number, countWord: string): string =>
  t({
    id: "spokenCard.value.moreEntries",
    message: plural(count, {
      one: "one more",
      other: `${countWord} more`,
    }),
  });

const detailUnreadable = (field: string): string =>
  t({
    id: "spokenCard.detail.unreadable",
    message: `${field}: the value is shown on screen.`,
  });

const detailNamed = (field: string, value: string): string =>
  t({
    id: "spokenCard.detail.named",
    message: `${field} as given in the call: ${value}.`,
  });

const detailLosses = (
  emptied: number,
  lists: number,
  emptiedWord: string,
  listsWord: string,
): string => {
  const shape = emptied > 0 ? (lists > 0 ? "both" : "emptied") : "lists";
  return t({
    id: "spokenCard.detail.losses",
    message: select(shape, {
      emptied: plural(emptied, {
        one: `${emptiedWord} field will be emptied.`,
        other: `${emptiedWord} fields will be emptied.`,
      }),
      both: `${plural(emptied, {
        one: `${emptiedWord} field`,
        other: `${emptiedWord} fields`,
      })} will be emptied and ${plural(lists, {
        one: `${listsWord} list`,
        other: `${listsWord} lists`,
      })} replaced or cut down.`,
      other: plural(lists, {
        one: `${listsWord} list will be replaced or cut down.`,
        other: `${listsWord} lists will be replaced or cut down.`,
      }),
    }),
  });
};

const moreSentence = (count: number, countWord: string): string =>
  t({
    id: "spokenCard.more",
    message: plural(count, {
      one: "And one more field, shown on screen.",
      other: `And ${countWord} more fields, shown on screen.`,
    }),
  });

const longTextSentence = (
  shape: "field" | "none",
  field: string,
  words: string,
): string =>
  t({
    id: "spokenCard.text",
    message: select(shape, {
      field: `${field}: a text of about ${words} words, shown on screen.`,
      other: `Plus a text of about ${words} words, shown on screen.`,
    }),
  });

/** A long text named by where it came from: the user's dictation. */
const dictatedTextSentence = (
  shape: "field" | "none",
  relation: DictationRelation,
  field: string,
): string => {
  if (shape === "field") {
    return t({
      id: "spokenCard.text.dictated",
      message: select(relation, {
        unchanged: `${field}: the text exactly as dictated.`,
        part: `${field}: part of the dictated text, word for word.`,
        extended: `${field}: the dictated text word for word, with additions.`,
        other: `${field}: the dictated text, changed in places.`,
      }),
    });
  }
  return t({
    id: "spokenCard.text.dictatedUnnamed",
    message: select(relation, {
      unchanged: "Plus the text exactly as dictated.",
      part: "Plus part of the dictated text, word for word.",
      extended: "Plus the dictated text word for word, with additions.",
      other: "Plus the dictated text, changed in places.",
    }),
  });
};

const dictatedReadLeadSentence = (relation: DictationRelation): string =>
  t({
    id: "spokenCard.text.dictatedReadLead",
    message: select(relation, {
      part: "The card holds only part of what was dictated. It reads:",
      extended: "The card holds more than what was dictated. It reads:",
      other: "The text on the card differs from what was dictated. It reads:",
    }),
  });

/** What a consequence is about: the thing's kind, several things, or a statement. */
type ConsequenceSubject = GistKind | "many" | "statement";

const consequenceSentence = (
  consequence: SpokenConsequence,
  subject: ConsequenceSubject,
): string => {
  switch (consequence) {
    case "permanent":
      return t({
        id: "spokenCard.consequence.permanent",
        message: "This cannot be undone.",
      });
    case "restorable":
      return t({
        id: "spokenCard.consequence.restorable",
        message: select(subject, {
          many: "They can be restored.",
          other: "It can be restored.",
        }),
      });
    case "restore_unknown":
      return t({
        id: "spokenCard.consequence.restoreUnknown",
        message: select(subject, {
          many: "Whether they can be restored is not known.",
          other: "Whether it can be restored is not known.",
        }),
      });
    case "rows_unknown":
      return t({
        id: "spokenCard.consequence.rowsUnknown",
        message: "How many records this affects is not known.",
      });
    case "instruction_unknown":
      return t({
        id: "spokenCard.consequence.instructionUnknown",
        message: "What exactly happens is not known.",
      });
    case "nothing_changes":
      return t({
        id: "spokenCard.consequence.nothingChanges",
        message: "Nothing seems to change.",
      });
    // The card's own sentences for the same fact, naming who marked it.
    case "destructive":
      // eslint-disable-next-line lingui/no-unlocalized-strings -- API enum value
      return changeNoteLabel("marked_destructive");
    case "destructive_by_organisation":
      // eslint-disable-next-line lingui/no-unlocalized-strings -- API enum value
      return changeNoteLabel("operator_marked_destructive");
  }
};

const differenceIntro = (kind: DifferenceIntro, what: string): string =>
  t({
    id: "spokenCard.difference.intro",
    message: select(kind, {
      changed: `The new version: ${what}`,
      same: `The new card is the same as before: ${what}`,
      other_item: `Careful, the new card is about something different: ${what}`,
      other: `The card was changed: ${what}`,
    }),
  });

const differenceEntry = (asked: Asked, sentence: string): string =>
  t({
    id: "spokenCard.difference.entry",
    message: select(asked, {
      asked: `Changed: ${sentence}`,
      unsure: `Also changed: ${sentence}`,
      other: `Also changed, without being asked: ${sentence}`,
    }),
  });

const differenceDropped = (field: string): string =>
  t({
    id: "spokenCard.difference.dropped",
    message: `${field} is no longer part of it.`,
  });

const differenceTitle = (kind: GistKind, name: string): string => {
  const shape = kind === "email" ? "subject" : "title";
  return t({
    id: "spokenCard.difference.title",
    message: select(shape, {
      subject: `The subject is now ${name}.`,
      other: `The title is now ${name}.`,
    }),
  });
};

const differenceRecipients = (kind: string, group: string, names: string) =>
  t({
    id: "spokenCard.difference.recipients",
    message: select(kind, {
      to: `Now to: ${names}.`,
      cc: `Now in copy: ${names}.`,
      bcc: `Now in blind copy: ${names}.`,
      other: `${group} now: ${names}.`,
    }),
  });

const differenceStatement = (kind: string): string =>
  t({
    id: "spokenCard.difference.statement",
    message: select(kind, {
      sql: "The query is different now; it's on screen.",
      other: "The instruction is different now; it's on screen.",
    }),
  });

const differenceRows = (count: number, countWord: string): string =>
  t({
    id: "spokenCard.difference.rows",
    message: plural(count, {
      one: "One row is different now; it's on screen.",
      other: `${countWord} rows are different now; they're on screen.`,
    }),
  });

const differenceField = (field: string): string =>
  t({
    id: "spokenCard.difference.field",
    message: `${field} is different now; it's on screen.`,
  });

const differenceMore = (
  shape: Asked,
  count: number,
  countWord: string,
): string =>
  t({
    id: "spokenCard.difference.more",
    message: select(shape, {
      asked: plural(count, {
        one: "And one more field changed as asked; it's on screen.",
        other: `And ${countWord} more fields changed as asked; they're on screen.`,
      }),
      unsure: plural(count, {
        one: "And one more field changed; it's on screen.",
        other: `And ${countWord} more fields changed; they're on screen.`,
      }),
      other: plural(count, {
        one: "And one more field changed without being asked; it's on screen.",
        other: `And ${countWord} more fields changed without being asked; they're on screen.`,
      }),
    }),
  });

const differenceElsewhere = (): string =>
  t({
    id: "spokenCard.difference.elsewhere",
    message: "Something else is different too; it's on screen.",
  });

const differenceUnreadable = (): string =>
  t({
    id: "spokenCard.difference.unreadable",
    message:
      "I can't tell from the card whether the change is in: only something I can't read out is different. It's on screen.",
  });

const differenceRest = (): string =>
  t({
    id: "spokenCard.difference.rest",
    message: "Everything else is as before.",
  });

const differenceSameHint = (): string =>
  t({
    id: "spokenCard.difference.sameHint",
    message: "Nothing was changed. Try saying the change a different way.",
  });

const requestSentence = (): string =>
  t({ id: "spokenCard.request", message: "Please confirm on screen." });

const cutMark = (): string =>
  t({ id: "spokenCard.cut", message: "… shortened" });

const restSentence = (count: number, countWord: string): string =>
  t({
    id: "spokenCard.rest",
    message: plural(count, {
      one: "One more thing:",
      other: `${countWord} more things:`,
    }),
  });

const nothingLeftSentence = (): string =>
  t({ id: "spokenCard.nothingLeft", message: "That was everything." });

const textCutSentence = (): string =>
  t({
    id: "spokenCard.textCut",
    message: "The rest of the text is on screen.",
  });

const noticeSentence = (notice: SpokenNotice, locale: string): string => {
  switch (notice.kind) {
    case "decide_on_screen": {
      const { decision } = notice;
      return t({
        id: "spokenCard.notice.decideOnScreen",
        message: select(decision, {
          approve: "For now, approving is done on screen.",
          other: "For now, declining is done on screen.",
        }),
      });
    }
    case "change_on_screen": {
      const { reason } = notice;
      return t({
        id: "spokenCard.notice.changeOnScreen",
        message: select(reason, {
          others:
            "First decide on the other approvals on screen; then this card can be changed by voice.",
          other:
            "This card can't be changed by voice. Please decide it on screen.",
        }),
      });
    }
    case "changing":
      return t({
        id: "spokenCard.notice.changing",
        message: "All right, I'll change that.",
      });
    case "change_failed":
      return t({
        id: "spokenCard.notice.changeFailed",
        message: "The change couldn't be sent. The card is waiting on screen.",
      });
    case "change_conflict":
      return t({
        id: "spokenCard.notice.changeConflict",
        message:
          "The card has changed in the meantime. Please check the screen.",
      });
    case "change_no_card": {
      const shape = notice.several ? "several" : "once";
      return t({
        id: "spokenCard.notice.changeNoCard",
        message: select(shape, {
          several:
            "After several changes no new card came, and nothing was run. Please say again what should happen.",
          other:
            "No new card came, and nothing was run. Just say how to go on.",
        }),
      });
    }
    case "new_request_on_screen":
      return t({
        id: "spokenCard.notice.newRequest",
        message:
          "First this card: decide on it on screen, or say what should be different. Then please say the new request again.",
      });
    case "unclear": {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- select keys
      const commands = notice.hasText ? "withText" : "withoutText";
      return t({
        id: "spokenCard.notice.unclear",
        message: select(commands, {
          withText:
            "I didn't catch that. You can say: go on, what else, again, read the text, or stop.",
          other:
            "I didn't catch that. You can say: go on, what else, again, or stop.",
        }),
      });
    }
    case "no_text":
      return t({
        id: "spokenCard.notice.noText",
        message: "This card has no long text.",
      });
    case "which_text": {
      // Field names only: the vocabulary knows no gender for an article.
      const named = notice.fields.every((field) => field.length > 0);
      const texts = named
        ? new Intl.ListFormat(locale, { type: "disjunction" }).format(
            notice.fields,
          )
        : "";

      const shape = named ? "named" : "unnamed";
      return t({
        id: "spokenCard.notice.whichText",
        message: select(shape, {
          named: `Which text: ${texts}?`,
          other: "Which text? The texts are on screen.",
        }),
      });
    }
    case "unavailable":
      return t({
        id: "spokenCard.notice.unavailable",
        message:
          "Voice commands aren't working right now. The card is waiting on screen.",
      });
  }
};

// ---------------------------------------------------------------------------
// Reads

/** Things of a kind in general, as what a read looks at. */
const readThings = (kind: GistKind): string =>
  t({
    id: "spokenCard.read.things",
    message: select(kind, {
      page: "pages",
      row: "records",
      database: "databases",
      folder: "folders",
      note: "notes",
      comment: "comments",
      paragraph: "paragraphs",
      document: "documents",
      email: "emails",
      message: "messages",
      event: "events",
      file: "files",
      task: "tasks",
      other: "items",
    }),
  });

/** The tables a statement reads from. */
const readTables = (count: number, tables: string): string =>
  t({
    id: "spokenCard.read.tables",
    message: plural(count, {
      one: `from the table ${tables}`,
      other: `from the tables ${tables}`,
    }),
  });

type ReadShapeWord =
  | "search"
  | "searchIn"
  | "searchLong"
  | "searchInLong"
  | "read"
  | "list";

/** What a read looks up, where, and by what. */
const readWhatSentence = (
  shape: ReadShapeWord,
  parts: {
    source: string;
    thing: string;
    tables: string;
    text: string;
    clause: string;
  },
): string =>
  withParts(parts, ({ source, thing, tables, text, clause }) =>
    t({
      id: "spokenCard.read.what",
      message: select(shape, {
        search: `I'd like to search ${source} for ${text} ${clause}`,
        searchIn: `I'd like to search ${thing} ${source} for ${text} ${clause}`,
        searchLong: `I'd like to search ${source} for a text of about ${text} words, shown on screen ${clause}`,
        searchInLong: `I'd like to search ${thing} ${source} for a text of about ${text} words, shown on screen ${clause}`,
        read: `I'd like to read ${thing} ${tables} ${source} ${clause}`,
        other: `I'd like to list ${thing} ${source} ${clause}`,
      }),
    }),
  );

const readConditionsLead = (): string =>
  t({
    id: "spokenCard.read.conditionsLead",
    message: ", with these conditions:",
  });

const readWhereSentence = (places: string): string =>
  t({ id: "spokenCard.read.where", message: `Where: ${places}.` });

const readConditionSentence = (
  operator: string,
  kind: "date" | "other",
  column: string,
  value: string,
  second: string,
): string =>
  t({
    id: "spokenCard.read.condition",
    message: select(operator, {
      equals: `${column} is ${value}.`,
      not_equals: `${column} is not ${value}.`,
      less: select(kind, {
        date: `${column} is before ${value}.`,
        other: `${column} is less than ${value}.`,
      }),
      at_most: select(kind, {
        date: `${column} is on or before ${value}.`,
        other: `${column} is at most ${value}.`,
      }),
      greater: select(kind, {
        date: `${column} is after ${value}.`,
        other: `${column} is greater than ${value}.`,
      }),
      at_least: select(kind, {
        date: `${column} is on or after ${value}.`,
        other: `${column} is at least ${value}.`,
      }),
      contains: `${column} contains ${value}.`,
      starts_with: `${column} starts with ${value}.`,
      ends_with: `${column} ends with ${value}.`,
      is_empty: `${column} is empty.`,
      is_not_empty: `${column} is not empty.`,
      in: `${column} is ${value}.`,
      neither: `${column} is neither ${value} nor ${second}.`,
      not_in: `${column} is not ${value}.`,
      between: select(kind, {
        date: `${column} is between ${value} and ${second}.`,
        other: `${column} is between ${value} and ${second}.`,
      }),
      other: `${column} is compared with ${value}.`,
    }),
  });

/** A column of one of several tables a statement reads. */
const readColumnOf = (column: string, table: string): string =>
  t({ id: "spokenCard.read.columnOf", message: `${column} of ${table}` });

/** Tables past the ones said, counted, after "from the tables". */
const readMoreTables = (count: number, countWord: string): string =>
  t({
    id: "spokenCard.read.moreTables",
    message: plural(count, {
      one: "one more table",
      other: `${countWord} more tables`,
    }),
  });

/** Values of a condition past the ones said, counted. */
const readMoreValues = (count: number, countWord: string): string =>
  t({
    id: "spokenCard.read.moreValues",
    message: plural(count, {
      one: "one more value",
      other: `${countWord} more values`,
    }),
  });

/** A condition whose value is too long to say. */
const readConditionLongSentence = (column: string, words: string): string =>
  t({
    id: "spokenCard.read.conditionLong",
    message: `${column} is compared with a text of about ${words} words, shown on screen.`,
  });

const readMoreConditionsSentence = (
  shape: "unknown" | "counted" | "after",
  count: number,
  countWord: string,
): string =>
  t({
    id: "spokenCard.read.moreConditions",
    message: select(shape, {
      unknown: "With conditions shown on screen.",
      counted: plural(count, {
        one: "With one condition, shown on screen.",
        other: `With ${countWord} conditions, shown on screen.`,
      }),
      other: plural(count, {
        one: "And one more condition, shown on screen.",
        other: `And ${countWord} more conditions, shown on screen.`,
      }),
    }),
  });

const readLimitSentence = (shape: "one" | "many", things: string): string =>
  t({
    id: "spokenCard.read.limit",
    message: select(shape, {
      one: "Only the first result.",
      other: `At most ${things}.`,
    }),
  });

// ---------------------------------------------------------------------------
// Composing the card from the sentences

const ACTIONS_ON_NEW: readonly string[] = ["create", "send", "upload"];
const isNew = (facts: SpokenFacts) => ACTIONS_ON_NEW.includes(facts.action);

const isShort = (position: SpokenQueuePosition | undefined) =>
  position !== undefined && position.index > 0 && position.sameAsPrevious;

const words = (
  code: LanguageCode,
  options: WordOptions,
  language: string,
): LanguageWords => {
  const natural = options.wording === "natural";
  /** The natural variant for `key`, or `undefined` for the precise sentence. */
  const variant = (key: string, oneField?: string): string | undefined =>
    natural
      ? naturalVariant(language, key, options.sentences, oneField)
      : undefined;
  const directed = (role: "from" | "to", said: string): string =>
    code.directed?.(role, said) ?? said;
  const today = wallClockParts(options.now, options.timeZone);
  const count = (value: number): string =>
    code.numbers[value] ?? new Intl.NumberFormat(code.locale).format(value);
  const list = (items: readonly string[]): string =>
    new Intl.ListFormat(code.locale, { type: "conjunction" }).format(items);
  const date = (value: CalendarDay, withYear = false): string =>
    plainSpaces(
      new Intl.DateTimeFormat(code.locale, {
        day: "numeric",
        month: "long",
        ...(!withYear && leavesOutYear(value, today)
          ? {}
          : { year: "numeric" }),
        timeZone: "UTC",
      }).format(Date.UTC(value.year, value.month - 1, value.day)),
    );
  const time = (hour: number, minute: number): string =>
    code.time?.(hour, minute) ??
    plainSpaces(
      new Intl.DateTimeFormat(code.locale, {
        hour: "numeric",
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Intl option
        ...(minute === 0 ? {} : { minute: "2-digit" }),
        hour12: true,
        timeZone: "UTC",
      }).format(Date.UTC(2000, 0, 1, hour, minute)),
    );

  const value = (
    ear: EarValue,
    role: "from" | "to" | "plain" = "plain",
    unit = true,
    withYear = false,
  ): string => {
    switch (ear.kind) {
      case "date":
        return valueInRole(role, "date", date(ear, withYear));
      case "datetime":
        return valueInRole(
          role,
          "date",
          dateTimeValue(date(ear, withYear), time(ear.hour, ear.minute)),
        );
      case "number": {
        const number = new Intl.NumberFormat(code.locale, {
          maximumFractionDigits: 20,
        }).format(ear.value);
        return valueInRole(
          role,
          "other",
          ear.percent && unit ? percentValue(number) : number,
        );
      }
      case "bool":
        return valueInRole(role, "other", ear.value ? yesValue() : noValue());
      case "text":
        return valueInRole(role, "other", ear.text);
      case "unread":
        return valueInRole(role, "unread", "");
      case "id":
        return valueInRole(role, "id", "");
    }
  };

  const recipients = ({ names, total }: SpokenRecipients): string => {
    if (names.length === 0) {
      return recipientsPhrase("unnamed", total, 0, "", count(total));
    }
    if (total <= 2 && names.length >= total) {
      return list(names.slice(0, total));
    }
    const rest = total - 1;
    return recipientsPhrase("named", total, rest, names[0], count(rest));
  };

  const thing = (facts: SpokenFacts): string => {
    const { kind, names } = facts;
    if (facts.count > 1) {
      if (!isNew(facts) && names.length === facts.count) {
        return namedThings(kind, list(names));
      }
      return names.length > 0
        ? countedThingsIncluding(kind, count(facts.count), list(names))
        : countedThings(kind, count(facts.count));
    }
    if (isNew(facts) || names.length === 0) return oneThing(kind);
    return namedThing(kind, names[0]);
  };

  const destination = (facts: SpokenFacts): string => {
    const { action, kind, where } = facts;
    if (action === "send" || (action === "create" && facts.recipients)) {
      if (facts.recipients) {
        return destinationPhrase(
          "recipients",
          kind,
          recipients(facts.recipients),
        );
      }
      return where.length > 0
        ? // eslint-disable-next-line lingui/no-unlocalized-strings -- a select key
          destinationPhrase("sendPlace", kind, list(where))
        : "";
    }
    if (action === "share" && facts.recipients) {
      return destinationPhrase("share", kind, recipients(facts.recipients));
    }
    if (action === "move" && where.length > 0) {
      return destinationPhrase("move", kind, list(where));
    }
    if (action === "create" && where.length > 0) {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- a select key
      return destinationPhrase("createIn", kind, list(where));
    }
    return "";
  };

  const ordinal = (position: SpokenQueuePosition | undefined): string =>
    !position || position.total < 2
      ? ""
      : `${ordinalPrefix(code.ordinals[position.index])} `;

  const item = (facts: SpokenFacts): string => {
    if (!isNew(facts) || facts.count !== 1 || facts.names.length === 0) {
      return "";
    }
    return facts.kind === "email"
      ? endSentence(subjectLine(facts.names[0]))
      : endSentence(facts.names[0]);
  };

  /** A list's entries, the first few said and the rest counted. */
  const listValues = (values: EarValue[], omitted = 0) => {
    const said = values
      .slice(0, MAX_LISTED_ENTRIES)
      .map((entry) => value(entry));
    const more = values.length - said.length + omitted;
    return list(more > 0 ? [...said, moreEntries(more, count(more))] : said);
  };
  const kindOf = (ear: EarValue): ValueKind =>
    ear.kind === "date" || ear.kind === "datetime"
      ? "date"
      : ear.kind === "unread" || ear.kind === "id"
        ? ear.kind
        : "other";

  const detail = (entry: SpokenDetail, facts: SpokenFacts): string => {
    switch (entry.type) {
      case "set": {
        const type = facts.action === "update" ? "updated" : "set";
        const own = variant(type, entry.sentences?.[type]);
        // A value an update sets carries its direction, as `to` does.
        if (own !== undefined)
          return fillVariant(own, {
            field: entry.field,
            value:
              type === "updated"
                ? directed("to", value(entry.value, "to"))
                : value(entry.value),
          });
        return facts.action === "update"
          ? detailSetTo(
              kindOf(entry.value),
              entry.field,
              value(entry.value, "to"),
            )
          : endSentence(fieldValue(entry.field, value(entry.value)));
      }
      case "list_set": {
        const entries = listValues(entry.values, entry.omitted);
        return facts.action === "update"
          ? detailSetTo(
              "other",
              entry.field,
              valueInRole("to", "other", entries),
            )
          : endSentence(fieldValue(entry.field, entries));
      }
      case "changed": {
        // Old and new in different years both say their year: "from 16
        // January to 15 December" would hide which way the date moved.
        const years = yearsDiffer(entry.from, entry.to);
        const from = value(
          entry.from,
          "from",
          !bothPercent(entry.from, entry.to),
          years,
        );
        const to = value(entry.to, "to", true, years);
        const own = variant("changed", entry.sentences?.changed);
        return own === undefined
          ? endSentence(detailChanged(entry.field, from, to))
          : fillVariant(own, {
              field: entry.field,
              from: directed("from", from),
              to: directed("to", to),
            });
      }
      case "emptied":
        return detailEmptied(entry.field);
      case "list_replaced":
        return (entry.unknown ? detailListMaybeReplaced : detailListReplaced)(
          entry.values.length > 0 ? "values" : "none",
          entry.field,
          listValues(entry.values, entry.omitted),
        );
      case "list_removed":
        return detailListRemoved(
          entry.values.length + entry.omitted,
          entry.field,
          listValues(entry.values, entry.omitted),
        );
      case "list_added":
        return detailListAdded(
          entry.values.length + entry.omitted,
          entry.field,
          listValues(entry.values, entry.omitted),
        );
      case "unreadable":
        return detailUnreadable(entry.field);
      case "named":
        return detailNamed(entry.field, value(entry.value));
      case "losses":
        return capitalised(
          detailLosses(
            entry.emptied,
            entry.lists,
            count(entry.emptied),
            count(entry.lists),
          ),
        );
    }
  };

  /** Values of a condition: said one by one, the rest counted. */
  const someValues = (
    values: EarValue[],
    omitted: number,
    type: "conjunction" | "disjunction",
  ) => {
    const said = values
      .slice(0, MAX_LISTED_ENTRIES)
      .map((entry) => value(entry));
    const more = values.length - said.length + omitted;
    return new Intl.ListFormat(code.locale, { type }).format(
      more > 0 ? [...said, readMoreValues(more, count(more))] : said,
    );
  };

  const readThing = (facts: SpokenReadFacts): string => {
    const { kind, names } = facts;
    if (facts.shape !== "items") return facts.things ?? readThings(kind);
    if (facts.count > 1) {
      if (names.length === facts.count) return namedThings(kind, list(names));
      return names.length > 0
        ? countedThingsIncluding(kind, count(facts.count), list(names))
        : countedThings(kind, count(facts.count));
    }
    return names.length > 0 ? namedThing(kind, names[0]) : oneThing(kind);
  };

  const read: SpokenReadWords = {
    what(facts, conditionsFollow, position) {
      const source = facts.server ? sourcePhrase("in", facts.server) : "";
      const tables =
        facts.tables.length > 0
          ? readTables(
              facts.tables.length + facts.tablesOmitted,
              facts.tablesOmitted > 0
                ? list([
                    ...facts.tables,
                    readMoreTables(
                      facts.tablesOmitted,
                      count(facts.tablesOmitted),
                    ),
                  ])
                : list(facts.tables),
            )
          : "";
      const typed = facts.kind !== "other" && facts.kind !== "row";
      let shape: ReadShapeWord;
      let text = "";
      if (facts.shape === "search" && facts.search) {
        const long = !("text" in facts.search);
        /* eslint-disable lingui/no-unlocalized-strings -- select keys */
        shape = typed
          ? long
            ? "searchInLong"
            : "searchIn"
          : long
            ? "searchLong"
            : "search";
        /* eslint-enable lingui/no-unlocalized-strings */
        text =
          "text" in facts.search
            ? facts.search.text
            : String(roundWords(facts.search.words));
      } else {
        shape =
          facts.shape === "items" || facts.tables.length > 0 ? "read" : "list";
      }
      const unnamed =
        facts.shape === "items" &&
        facts.count === 1 &&
        facts.names.length === 0;
      const clause = unnamed ? unnamedClause(facts.kind, facts.unread) : "";
      const sentence = readWhatSentence(shape, {
        source,
        thing:
          shape === "search" || shape === "searchLong" ? "" : readThing(facts),
        tables,
        text,
        clause,
      });
      return `${ordinal(position)}${conditionsFollow ? `${sentence}${readConditionsLead()}` : endSentence(sentence)}`;
    },
    where: (places) => readWhereSentence(list(places)),
    condition(condition: SpokenCondition) {
      const first = condition.values.at(0);
      const second = condition.values.at(1);
      const column =
        condition.table === undefined
          ? condition.column
          : readColumnOf(condition.column, condition.table);
      if (condition.longWords !== undefined) {
        return readConditionLongSentence(
          column,
          String(roundWords(condition.longWords)),
        );
      }
      const neither = "neither";
      const operator =
        condition.operator === "not_in" &&
        condition.values.length === 2 &&
        condition.valuesOmitted === 0
          ? neither
          : condition.operator;
      const many = operator === "in" || operator === "not_in";
      const said = many
        ? someValues(condition.values, condition.valuesOmitted, "disjunction")
        : first
          ? value(first)
          : "";
      const dated =
        first !== undefined &&
        (first.kind === "date" || first.kind === "datetime");
      return readConditionSentence(
        operator,
        dated ? "date" : "other",
        column,
        said,
        second ? value(second) : "",
      );
    },
    moreConditions(unsaid, afterSaid) {
      if (unsaid === "unknown") {
        return readMoreConditionsSentence("unknown", 0, "");
      }
      return readMoreConditionsSentence(
        afterSaid ? "after" : "counted",
        unsaid,
        count(unsaid),
      );
    },
    limit: (limit, kind) =>
      limit === 1
        ? readLimitSentence("one", "")
        : readLimitSentence("many", countedThings(kind, count(limit))),
  };

  return {
    full: true,
    read,
    cut: () => ` ${cutMark()}`,
    pointer: pointerSentence,
    count: (total) => countSentence(count(total)),
    what(facts, position) {
      const prefix = ordinal(position);
      const source = facts.server
        ? sourcePhrase(facts.action === "send" ? "from" : "in", facts.server)
        : "";
      if (facts.statement) {
        return `${prefix}${statementSentence(facts.statement, source)}`;
      }
      if (isShort(position)) {
        const named = facts.count === 1 && facts.names.length > 0;
        if (isNew(facts) || !named) {
          const subject =
            facts.count > 1
              ? countedThings(facts.kind, count(facts.count))
              : oneThingShort(facts.kind);
          return endSentence(
            `${prefix}${named ? titledShort(subject, facts.names[0]) : subject}`,
          );
        }
        return endSentence(
          `${prefix}${namedThingShort(facts.kind, facts.names[0])}`,
        );
      }
      const clause =
        isNew(facts) || facts.count !== 1 || facts.names.length > 0
          ? ""
          : unnamedClause(facts.kind, facts.unread);
      const action = facts.reschedule ? "reschedule" : facts.action;
      const parts = {
        thing: thing(facts),
        destination: destination(facts),
        source,
        clause,
      };
      // The opening's verb is the card's action: it has no variant.
      const sentence = whatSentence(action, parts);
      return `${prefix}${sentence}${item(facts).length > 0 ? ":" : "."}`;
    },
    item(facts, position) {
      return isShort(position) || facts.statement ? "" : item(facts);
    },
    detail,
    outside(entry) {
      const outside = entry.outside ?? 0;
      if (outside === 0) return "";
      return outsideSentence(
        entry.total === 1 ? "single" : outside >= entry.total ? "all" : "some",
        outside,
        capitalised(count(outside)),
      );
    },
    more: (more) => moreSentence(more, count(more)),
    text(text: SpokenText) {
      if (text.read !== undefined) {
        return endSentence(
          text.field.length > 0 ? fieldValue(text.field, text.read) : text.read,
        );
      }
      if (text.dictated) {
        return dictatedTextSentence(
          text.field.length > 0 ? "field" : "none",
          text.dictated,
          text.field,
        );
      }
      return longTextSentence(
        text.field.length > 0 ? "field" : "none",
        text.field,
        String(roundWords(text.words)),
      );
    },
    consequence(consequences, facts) {
      const subject: ConsequenceSubject = facts.statement
        ? "statement"
        : facts.count > 1
          ? "many"
          : facts.kind;
      return consequences
        .map((consequence) => consequenceSentence(consequence, subject))
        .join(" ");
    },
    request: requestSentence,
    generic: (toolTitle, server) =>
      genericSentence(
        spokenToolTitle(toolTitle),
        server ? sourcePhrase("in", server) : "",
      ),
    rest: (more) => capitalised(restSentence(more, count(more))),
    nothingLeft: nothingLeftSentence,
    readText: (field, passage) => fieldValue(field, passage),
    textCut: textCutSentence,
    dictatedReadLead: dictatedReadLeadSentence,
    notice: (notice) => noticeSentence(notice, code.locale),
    difference: {
      intro: differenceIntro,
      differs: differenceEntry,
      dropped: differenceDropped,
      title: differenceTitle,
      recipientsIn: (kind, group, names, more) =>
        differenceRecipients(
          kind,
          group,
          list(more > 0 ? [...names, moreEntries(more, count(more))] : names),
        ),
      statement: differenceStatement,
      rows: (rows) => differenceRows(rows, capitalised(count(rows))),
      field: differenceField,
      more: (more, asked) => differenceMore(asked, more, count(more)),
      rest: differenceRest,
      elsewhere: differenceElsewhere,
      unreadable: differenceUnreadable,
      sameHint: differenceSameHint,
    },
  };
};

/** A tool's machine name read as words: "read_query" as "read query". */
const spokenToolTitle = (title: string): string =>
  title.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

/** Languages with the pointer sentence only, until a native speaker has judged the full card in them. */
const POINTER_ONLY: readonly string[] = ["fr", "es", "pl"];

/**
 * The words for `language` ("de", "de-DE", …), from the catalog of the
 * language shown; the code parts are English for a language without its own.
 */
export const spokenWordsFor = (
  language: string,
  options: WordOptions,
): LanguageWords => {
  const code = language.split(/[-_]/)[0]?.toLowerCase() ?? "en";
  const said = words(code === "de" ? GERMAN : ENGLISH, options, code);
  return POINTER_ONLY.includes(code) ? { ...said, full: false } : said;
};
