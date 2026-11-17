/* eslint-disable lingui/no-unlocalized-strings -- spoken sentences are written per language with their grammar, not translated from catalog labels */
import { t } from "@lingui/core/macro";

import { bothPercent, inZone } from "./spokenValues";

import type { GistAction, GistKind } from "./gist";
import type {
  SpokenConsequence,
  SpokenFacts,
  SpokenQueuePosition,
  SpokenRecipients,
  SpokenText,
  SpokenWords,
} from "./spokenCard";
import type { EarValue } from "./spokenValues";
import type { ToolCallOpaqueKind } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The spoken card's sentences, written for the ear in each language. German
 * and English say the whole card; a language nobody has judged yet says only
 * that a decision waits on screen. No sentence addresses the listener with
 * "du" or "Sie".
 */

interface WordOptions {
  now: Date;
  /** The zone "today" is in; the device's when not given. */
  timeZone?: string;
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

const todayOf = ({ now, timeZone }: WordOptions): CalendarDay =>
  inZone(now, timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);

/** The sentence for a card the voice does not read, in the language shown. */
const pointerSentence = (): string =>
  t({
    id: "spokenCard.pointer",
    message: "A decision is waiting on screen.",
  });

export type LanguageWords = SpokenWords & {
  /** Whether the language says the whole card, not only the pointer. */
  full: boolean;
};

const ACTIONS_ON_NEW: readonly GistAction[] = ["create", "send", "upload"];
const isNew = (facts: SpokenFacts) => ACTIONS_ON_NEW.includes(facts.action);

const roundWords = (count: number): number =>
  count < 20
    ? count
    : count < 200
      ? Math.round(count / 10) * 10
      : Math.round(count / 50) * 50;

const endSentence = (text: string): string =>
  /[.!?…:]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;

const joinList = (items: readonly string[], and: string): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;

// ---------------------------------------------------------------------------
// German

type Gender = "m" | "f" | "n";
interface GermanNoun {
  gender: Gender;
  one: string;
  many: string;
}

const GERMAN_NOUNS: Record<GistKind, GermanNoun> = {
  page: { gender: "f", one: "Seite", many: "Seiten" },
  row: { gender: "m", one: "Datensatz", many: "Datensätze" },
  database: { gender: "f", one: "Datenbank", many: "Datenbanken" },
  folder: { gender: "m", one: "Ordner", many: "Ordner" },
  note: { gender: "f", one: "Notiz", many: "Notizen" },
  comment: { gender: "m", one: "Kommentar", many: "Kommentare" },
  paragraph: { gender: "m", one: "Absatz", many: "Absätze" },
  document: { gender: "n", one: "Dokument", many: "Dokumente" },
  email: { gender: "f", one: "E-Mail", many: "E-Mails" },
  message: { gender: "f", one: "Nachricht", many: "Nachrichten" },
  event: { gender: "m", one: "Termin", many: "Termine" },
  file: { gender: "f", one: "Datei", many: "Dateien" },
  task: { gender: "f", one: "Aufgabe", many: "Aufgaben" },
  other: { gender: "m", one: "Eintrag", many: "Einträge" },
};

const GERMAN_ARTICLES = {
  indefiniteAccusative: { m: "einen", f: "eine", n: "ein" },
  indefiniteNominative: { m: "ein", f: "eine", n: "ein" },
  definiteAccusative: { m: "den", f: "die", n: "das" },
  definiteNominative: { m: "der", f: "die", n: "das" },
  /** Accusative relative pronoun: "den ich … gelesen habe". */
  relative: { m: "den", f: "die", n: "das" },
  /** Genitive relative pronoun: "dessen Kennung". */
  whose: { m: "dessen", f: "deren", n: "dessen" },
  pronoun: { m: "er", f: "sie", n: "es" },
} as const;

const GERMAN_VERBS: Record<GistAction, string> = {
  create: "anlegen",
  update: "ändern",
  delete: "löschen",
  send: "senden",
  move: "verschieben",
  comment: "kommentieren",
  share: "freigeben",
  run: "ausführen",
  upsert: "anlegen oder aktualisieren",
  archive: "archivieren",
  upload: "hochladen",
};

const GERMAN_STATEMENTS: Record<ToolCallOpaqueKind, GermanNoun> = {
  sql: { gender: "f", one: "SQL-Abfrage", many: "SQL-Abfragen" },
  shell: { gender: "m", one: "Shell-Befehl", many: "Shell-Befehle" },
  code: { gender: "m", one: "Programmcode", many: "Programmcode" },
  instruction: { gender: "f", one: "Anweisung", many: "Anweisungen" },
};

const GERMAN_NUMBERS = [
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
];
const germanCount = (count: number): string =>
  GERMAN_NUMBERS[count] ?? count.toLocaleString("de-DE");

const GERMAN_MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

const GERMAN_ORDINALS = [
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
];

const germanDate = (value: CalendarDay, today: CalendarDay): string =>
  `${value.day}. ${GERMAN_MONTHS[value.month - 1]}${
    leavesOutYear(value, today) ? "" : ` ${value.year}`
  }`;

const germanTime = (hour: number, minute: number): string =>
  minute === 0
    ? `${hour} Uhr`
    : `${hour}:${String(minute).padStart(2, "0")} Uhr`;

/** How a value is said in German; `role` picks the case a phrase needs. */
const germanValue = (
  value: EarValue,
  today: CalendarDay,
  role: "plain" | "from" | "to" = "plain",
  unit = true,
): string => {
  switch (value.kind) {
    case "date": {
      const date = germanDate(value, today);
      return role === "from"
        ? `vom ${date}`
        : role === "to"
          ? `auf den ${date}`
          : date;
    }
    case "datetime": {
      const at = `${germanDate(value, today)} um ${germanTime(value.hour, value.minute)}`;
      return role === "from"
        ? `vom ${at}`
        : role === "to"
          ? `auf den ${at}`
          : at;
    }
    case "number": {
      const number = new Intl.NumberFormat("de-DE", {
        maximumFractionDigits: 20,
      }).format(value.value);
      const said = value.percent && unit ? `${number} Prozent` : number;
      return role === "from"
        ? `von ${said}`
        : role === "to"
          ? `auf ${said}`
          : said;
    }
    case "bool": {
      const said = value.value ? "ja" : "nein";
      return role === "from"
        ? `von ${said}`
        : role === "to"
          ? `auf ${said}`
          : said;
    }
    case "text":
      return role === "from"
        ? `von ${value.text}`
        : role === "to"
          ? `auf ${value.text}`
          : value.text;
    case "unread": {
      const said =
        role === "to"
          ? "einen Datensatz, den ich in diesem Chat nicht gelesen habe"
          : "ein Datensatz, den ich in diesem Chat nicht gelesen habe";
      return role === "to" ? `auf ${said}` : said;
    }
    case "id":
      return role === "to"
        ? "auf einen Eintrag, dessen Kennung auf dem Bildschirm steht"
        : "ein Eintrag, dessen Kennung auf dem Bildschirm steht";
  }
};

const germanRecipients = (recipients: SpokenRecipients): string => {
  const { names, total } = recipients;
  if (names.length === 0) {
    return total === 1 ? "einen Empfänger" : `${germanCount(total)} Empfänger`;
  }
  if (total <= 2 && names.length >= total) {
    return joinList(names.slice(0, total), "und");
  }
  const rest = total - 1;
  return `${names[0]} und ${rest === 1 ? "eine weitere Person" : `${germanCount(rest)} weitere`}`;
};

const germanOutside = (recipients: SpokenRecipients): string => {
  const outside = recipients.outside ?? 0;
  if (outside === 0) return "";
  if (recipients.total === 1) return "Der Empfänger ist außerhalb der Firma.";
  if (outside >= recipients.total)
    return "Alle Empfänger sind außerhalb der Firma.";
  return outside === 1
    ? "Ein Empfänger ist außerhalb der Firma."
    : `${germanCount(outside).replace(/^./, (c) => c.toUpperCase())} der Empfänger sind außerhalb der Firma.`;
};

const germanObject = (facts: SpokenFacts, noun: GermanNoun): string => {
  const { count, names } = facts;
  const a = GERMAN_ARTICLES;
  if (count > 1) {
    if (!isNew(facts) && names.length === count) {
      return `die ${noun.many} ${joinList(names, "und")}`;
    }
    const counted = `${germanCount(count)} ${noun.many}`;
    return names.length > 0
      ? `${counted}, darunter ${joinList(names, "und")},`
      : counted;
  }
  if (isNew(facts) || names.length === 0) {
    return `${a.indefiniteAccusative[noun.gender]} ${noun.one}`;
  }
  return `${a.definiteAccusative[noun.gender]} ${noun.one} ${names[0]}`;
};

/** What follows the verb for a thing nobody named. */
const germanUnnamed = (facts: SpokenFacts, noun: GermanNoun): string => {
  if (isNew(facts) || facts.count !== 1 || facts.names.length > 0) return "";
  const a = GERMAN_ARTICLES;
  return facts.unread
    ? `, ${a.relative[noun.gender]} ich in diesem Chat nicht gelesen habe`
    : `, ${a.whose[noun.gender]} Kennung auf dem Bildschirm steht`;
};

const germanOrdinal = (position: SpokenQueuePosition | undefined): string => {
  if (!position || position.total < 2) return "";
  const ordinal = GERMAN_ORDINALS[position.index] as string | undefined;
  return ordinal ? `Die ${ordinal}: ` : "Die nächste: ";
};

const isShort = (position: SpokenQueuePosition | undefined) =>
  position !== undefined && position.index > 0 && position.sameAsPrevious;

const germanItem = (facts: SpokenFacts): string => {
  if (!isNew(facts) || facts.count !== 1 || facts.names.length === 0) {
    return "";
  }
  return facts.kind === "email"
    ? `Betreff: ${endSentence(facts.names[0])}`
    : endSentence(facts.names[0]);
};

const german = (options: WordOptions): LanguageWords => {
  const today = todayOf(options);
  return {
    full: true,
    cut: () => " … gekürzt",
    pointer: pointerSentence,
    count: (total) => `Dafür brauche ich ${germanCount(total)} Freigaben.`,
    what(facts, position) {
      const ordinal = germanOrdinal(position);
      if (facts.statement) {
        const statement = GERMAN_STATEMENTS[facts.statement];
        const server = facts.server ? `in ${facts.server} ` : "";
        return `${ordinal}Ich möchte ${server}${GERMAN_ARTICLES.indefiniteAccusative[statement.gender]} ${statement.one} ${GERMAN_VERBS.run}. ${GERMAN_ARTICLES.pronoun[
          statement.gender
        ].replace(/^./, (c) => c.toUpperCase())} steht auf dem Bildschirm.`;
      }
      const noun = GERMAN_NOUNS[facts.kind];
      if (isShort(position)) {
        const a = GERMAN_ARTICLES;
        const named = facts.count === 1 && facts.names.length > 0;
        if (isNew(facts) || !named) {
          const thing =
            facts.count > 1
              ? `${germanCount(facts.count)} ${noun.many}`
              : `${a.indefiniteNominative[noun.gender]} ${noun.one}`;
          return endSentence(
            `${ordinal}${thing}${named ? `, ${facts.names[0]}` : ""}`,
          );
        }
        return endSentence(
          `${ordinal}${a.definiteNominative[noun.gender]} ${noun.one} ${facts.names[0]}`,
        );
      }
      const server = facts.server ? `in ${facts.server} ` : "";
      let extra = "";
      if (
        facts.action === "send" ||
        (facts.action === "create" && facts.recipients)
      ) {
        if (facts.recipients)
          extra = ` an ${germanRecipients(facts.recipients)}`;
        else if (facts.where.length > 0)
          extra = ` ${facts.kind === "message" ? "in" : "an"} ${joinList(facts.where, "und")}`;
      } else if (facts.action === "share" && facts.recipients) {
        extra = ` für ${germanRecipients(facts.recipients)}`;
      } else if (facts.action === "move" && facts.where.length > 0) {
        extra = ` nach ${joinList(facts.where, "und")}`;
      } else if (facts.action === "create" && facts.where.length > 0) {
        extra = ` in ${joinList(facts.where, "und")}`;
      }
      const verb = facts.reschedule
        ? "verschieben"
        : GERMAN_VERBS[facts.action];
      const object = germanObject(facts, noun);
      const unnamed = germanUnnamed(facts, noun);
      const opens = germanItem(facts).length > 0;
      return `${ordinal}Ich möchte ${server}${object}${extra} ${verb}${unnamed}${opens ? ":" : "."}`;
    },
    item(facts, position) {
      return isShort(position) || facts.statement ? "" : germanItem(facts);
    },
    detail(detail, facts) {
      const value = (v: EarValue, role?: "from" | "to", unit?: boolean) =>
        germanValue(v, today, role, unit);
      switch (detail.type) {
        case "set":
          return facts.action === "update"
            ? `${detail.field} wird ${value(detail.value, "to")} gesetzt.`
            : endSentence(`${detail.field}: ${value(detail.value)}`);
        case "changed":
          return endSentence(
            `${detail.field}: ${value(detail.from, "from", !bothPercent(detail.from, detail.to))} ${value(detail.to, "to")}`,
          );
        case "emptied":
          return `Das Feld ${detail.field} wird geleert.`;
        case "list_replaced":
          return detail.values.length > 0
            ? `Die Liste ${detail.field} wird ersetzt durch ${joinList(
                detail.values.map((v) => value(v)),
                "und",
              )}.`
            : `Die Liste ${detail.field} wird ersetzt.`;
        case "list_removed":
          return `Aus ${detail.field} ${detail.values.length > 1 ? "werden" : "wird"} ${joinList(
            detail.values.map((v) => value(v)),
            "und",
          )} entfernt.`;
        case "list_added":
          return `Zu ${detail.field} ${detail.values.length > 1 ? "kommen" : "kommt"} ${joinList(
            detail.values.map((v) => value(v)),
            "und",
          )} dazu.`;
        case "unreadable":
          return `${detail.field}: Der Wert steht auf dem Bildschirm.`;
        case "named":
          return `${detail.field} laut Aufruf: ${value(detail.value)}.`;
        case "losses": {
          const emptied =
            detail.emptied > 0
              ? `${detail.emptied === 1 ? "ein Feld" : `${germanCount(detail.emptied)} Felder`} geleert`
              : "";
          const lists =
            detail.lists > 0
              ? `${detail.lists === 1 ? "eine Liste" : `${germanCount(detail.lists)} Listen`} ersetzt oder gekürzt`
              : "";
          return `Dabei ${detail.emptied + detail.lists === 1 ? "wird" : "werden"} ${[emptied, lists].filter(Boolean).join(" und ")}.`;
        }
      }
    },
    outside: germanOutside,
    more: (count) =>
      count === 1
        ? "Dazu kommt ein weiteres Feld, es steht auf dem Bildschirm."
        : `Dazu kommen ${germanCount(count)} weitere Felder, sie stehen auf dem Bildschirm.`,
    text(text: SpokenText) {
      const label = text.field.length > 0 ? `${text.field}: ` : "";
      if (text.read !== undefined) return endSentence(`${label}${text.read}`);
      return `${label.length > 0 ? label : "Dazu "}ein Text von etwa ${roundWords(text.words)} Wörtern, er steht auf dem Bildschirm.`;
    },
    consequence(consequences: SpokenConsequence[], facts) {
      const noun = facts.statement ? undefined : GERMAN_NOUNS[facts.kind];
      const plural = facts.count > 1;
      const pronoun = plural
        ? "sie"
        : noun
          ? GERMAN_ARTICLES.pronoun[noun.gender]
          : "das";
      const capital = pronoun.replace(/^./, (c) => c.toUpperCase());
      const lässt = plural ? "lassen" : "lässt";
      return consequences
        .map((consequence) => {
          switch (consequence) {
            case "permanent":
              return "Das lässt sich nicht rückgängig machen.";
            case "restorable":
              return `${capital} ${lässt} sich wiederherstellen.`;
            case "restore_unknown":
              return `Ob ${pronoun} sich wiederherstellen ${lässt}, ist nicht bekannt.`;
            case "rows_unknown":
              return "Wie viele Datensätze das betrifft, ist nicht bekannt.";
            case "instruction_unknown":
              return "Was dabei genau passiert, ist nicht bekannt.";
            case "nothing_changes":
              return "Dabei scheint sich nichts zu ändern.";
            case "destructive":
              return "Das Werkzeug kennzeichnet das als destruktiv.";
          }
        })
        .join(" ");
    },
    request: () => "Bitte auf dem Bildschirm bestätigen.",
    generic: (toolTitle, server) =>
      `Ich möchte ${server ? `in ${server} ` : ""}das Werkzeug ${spokenToolTitle(toolTitle)} verwenden.`,
  };
};

// ---------------------------------------------------------------------------
// English

interface EnglishNoun {
  one: string;
  many: string;
}

const ENGLISH_NOUNS: Record<GistKind, EnglishNoun> = {
  page: { one: "page", many: "pages" },
  row: { one: "record", many: "records" },
  database: { one: "database", many: "databases" },
  folder: { one: "folder", many: "folders" },
  note: { one: "note", many: "notes" },
  comment: { one: "comment", many: "comments" },
  paragraph: { one: "paragraph", many: "paragraphs" },
  document: { one: "document", many: "documents" },
  email: { one: "email", many: "emails" },
  message: { one: "message", many: "messages" },
  event: { one: "event", many: "events" },
  file: { one: "file", many: "files" },
  task: { one: "task", many: "tasks" },
  other: { one: "item", many: "items" },
};

const ENGLISH_VERBS: Record<GistAction, string> = {
  create: "create",
  update: "change",
  delete: "delete",
  send: "send",
  move: "move",
  comment: "comment on",
  share: "share",
  run: "run",
  upsert: "create or update",
  archive: "archive",
  upload: "upload",
};

const ENGLISH_STATEMENTS: Record<ToolCallOpaqueKind, string> = {
  sql: "an SQL query",
  shell: "a shell command",
  code: "a piece of code",
  instruction: "an instruction",
};

const ENGLISH_NUMBERS = [
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
];
const englishCount = (count: number): string =>
  ENGLISH_NUMBERS[count] ?? count.toLocaleString("en-GB");

const ENGLISH_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const ENGLISH_ORDINALS = [
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
];

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

const englishDate = (value: CalendarDay, today: CalendarDay): string =>
  `${value.day} ${ENGLISH_MONTHS[value.month - 1]}${
    leavesOutYear(value, today) ? "" : ` ${value.year}`
  }`;

const englishTime = (hour: number, minute: number): string => {
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0
    ? `${twelve} ${suffix}`
    : `${twelve}:${String(minute).padStart(2, "0")} ${suffix}`;
};

const englishValue = (
  value: EarValue,
  today: CalendarDay,
  unit = true,
): string => {
  switch (value.kind) {
    case "date":
      return englishDate(value, today);
    case "datetime":
      return `${englishDate(value, today)} at ${englishTime(value.hour, value.minute)}`;
    case "number": {
      const number = new Intl.NumberFormat("en-GB", {
        maximumFractionDigits: 20,
      }).format(value.value);
      return value.percent && unit ? `${number} percent` : number;
    }
    case "bool":
      return value.value ? "yes" : "no";
    case "text":
      return value.text;
    case "unread":
      return "a record I haven't read in this chat";
    case "id":
      return "an item whose ID is shown on screen";
  }
};

const englishRecipients = (recipients: SpokenRecipients): string => {
  const { names, total } = recipients;
  if (names.length === 0) {
    return total === 1 ? "one recipient" : `${englishCount(total)} recipients`;
  }
  if (total <= 2 && names.length >= total) {
    return joinList(names.slice(0, total), "and");
  }
  const rest = total - 1;
  return `${names[0]} and ${englishCount(rest)} ${rest === 1 ? "other" : "others"}`;
};

const englishOutside = (recipients: SpokenRecipients): string => {
  const outside = recipients.outside ?? 0;
  if (outside === 0) return "";
  if (recipients.total === 1)
    return "The recipient is outside the organisation.";
  if (outside >= recipients.total)
    return "All recipients are outside the organisation.";
  return outside === 1
    ? "One recipient is outside the organisation."
    : `${englishCount(outside).replace(/^./, (c) => c.toUpperCase())} of the recipients are outside the organisation.`;
};

const englishObject = (facts: SpokenFacts, noun: EnglishNoun): string => {
  const { count, names } = facts;
  if (count > 1) {
    if (!isNew(facts) && names.length === count) {
      return `the ${noun.many} ${joinList(names, "and")}`;
    }
    const counted = `${englishCount(count)} ${noun.many}`;
    return names.length > 0
      ? `${counted}, including ${joinList(names, "and")},`
      : counted;
  }
  if (isNew(facts) || names.length === 0) {
    return `${article(noun.one)} ${noun.one}`;
  }
  return `the ${noun.one} ${names[0]}`;
};

const englishOrdinal = (position: SpokenQueuePosition | undefined): string => {
  if (!position || position.total < 2) return "";
  const ordinal = ENGLISH_ORDINALS[position.index] as string | undefined;
  return ordinal ? `The ${ordinal} one: ` : "The next one: ";
};

const englishItem = (facts: SpokenFacts): string => {
  if (!isNew(facts) || facts.count !== 1 || facts.names.length === 0) {
    return "";
  }
  return facts.kind === "email"
    ? `Subject: ${endSentence(facts.names[0])}`
    : endSentence(facts.names[0]);
};

const english = (options: WordOptions): LanguageWords => {
  const today = todayOf(options);
  return {
    full: true,
    cut: () => " … shortened",
    pointer: pointerSentence,
    count: (total) => `I need ${englishCount(total)} approvals for this.`,
    what(facts, position) {
      const ordinal = englishOrdinal(position);
      const server = facts.server
        ? ` ${facts.action === "send" ? "from" : "in"} ${facts.server}`
        : "";
      if (facts.statement) {
        return `${ordinal}I'd like to run ${ENGLISH_STATEMENTS[facts.statement]}${server}. It's shown on screen.`;
      }
      const noun = ENGLISH_NOUNS[facts.kind];
      if (isShort(position)) {
        const named = facts.count === 1 && facts.names.length > 0;
        if (isNew(facts) || !named) {
          const thing =
            facts.count > 1
              ? `${englishCount(facts.count)} ${noun.many}`
              : `${article(noun.one)} ${noun.one}`;
          return endSentence(
            `${ordinal}${thing}${named ? `, ${facts.names[0]}` : ""}`,
          );
        }
        return endSentence(`${ordinal}the ${noun.one} ${facts.names[0]}`);
      }
      let extra = "";
      if (
        facts.action === "send" ||
        (facts.action === "create" && facts.recipients)
      ) {
        if (facts.recipients)
          extra = ` to ${englishRecipients(facts.recipients)}`;
        else if (facts.where.length > 0)
          extra = ` to ${joinList(facts.where, "and")}`;
      } else if (facts.action === "share" && facts.recipients) {
        extra = ` with ${englishRecipients(facts.recipients)}`;
      } else if (facts.action === "move" && facts.where.length > 0) {
        extra = ` to ${joinList(facts.where, "and")}`;
      } else if (facts.action === "create" && facts.where.length > 0) {
        extra = ` in ${joinList(facts.where, "and")}`;
      }
      const verb = facts.reschedule
        ? "reschedule"
        : ENGLISH_VERBS[facts.action];
      const object = englishObject(facts, noun);
      const unnamed =
        isNew(facts) || facts.count !== 1 || facts.names.length > 0
          ? ""
          : facts.unread
            ? " that I haven't read in this chat"
            : " whose ID is shown on screen";
      const opens = englishItem(facts).length > 0;
      return `${ordinal}I'd like to ${verb} ${object}${extra}${server}${unnamed}${opens ? ":" : "."}`;
    },
    item(facts, position) {
      return isShort(position) || facts.statement ? "" : englishItem(facts);
    },
    detail(detail, facts) {
      const value = (v: EarValue, unit?: boolean) =>
        englishValue(v, today, unit);
      switch (detail.type) {
        case "set":
          return facts.action === "update"
            ? `${detail.field} will be set to ${value(detail.value)}.`
            : endSentence(`${detail.field}: ${value(detail.value)}`);
        case "changed":
          return endSentence(
            `${detail.field}: from ${value(detail.from, !bothPercent(detail.from, detail.to))} to ${value(detail.to)}`,
          );
        case "emptied":
          return `The field ${detail.field} will be emptied.`;
        case "list_replaced":
          return detail.values.length > 0
            ? `The list ${detail.field} will be replaced with ${joinList(
                detail.values.map((v) => value(v)),
                "and",
              )}.`
            : `The list ${detail.field} will be replaced.`;
        case "list_removed":
          return `${joinList(
            detail.values.map((v) => value(v)),
            "and",
          )} will be removed from ${detail.field}.`;
        case "list_added":
          return `${joinList(
            detail.values.map((v) => value(v)),
            "and",
          )} will be added to ${detail.field}.`;
        case "unreadable":
          return `${detail.field}: the value is shown on screen.`;
        case "named":
          return `${detail.field} as given in the call: ${value(detail.value)}.`;
        case "losses": {
          const fields = `${englishCount(detail.emptied)} ${detail.emptied === 1 ? "field" : "fields"}`;
          const lists = `${englishCount(detail.lists)} ${detail.lists === 1 ? "list" : "lists"}`;
          const said =
            detail.emptied > 0 && detail.lists > 0
              ? `${fields} will be emptied and ${lists} replaced or cut down`
              : detail.emptied > 0
                ? `${fields} will be emptied`
                : `${lists} will be replaced or cut down`;
          return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`;
        }
      }
    },
    outside: englishOutside,
    more: (count) =>
      count === 1
        ? "And one more field, shown on screen."
        : `And ${englishCount(count)} more fields, shown on screen.`,
    text(text: SpokenText) {
      const label = text.field.length > 0 ? `${text.field}: ` : "Plus ";
      if (text.read !== undefined) {
        return endSentence(`${text.field.length > 0 ? label : ""}${text.read}`);
      }
      return `${label}a text of about ${roundWords(text.words)} words, shown on screen.`;
    },
    consequence(consequences, facts) {
      const plural = facts.count > 1;
      return consequences
        .map((consequence) => {
          switch (consequence) {
            case "permanent":
              return "This cannot be undone.";
            case "restorable":
              return plural ? "They can be restored." : "It can be restored.";
            case "restore_unknown":
              return plural
                ? "Whether they can be restored is not known."
                : "Whether it can be restored is not known.";
            case "rows_unknown":
              return "How many records this affects is not known.";
            case "instruction_unknown":
              return "What exactly happens is not known.";
            case "nothing_changes":
              return "Nothing seems to change.";
            case "destructive":
              return "The tool marks this as destructive.";
          }
        })
        .join(" ");
    },
    request: () => "Please confirm on screen.",
    generic: (toolTitle, server) =>
      `I'd like to use the tool ${spokenToolTitle(toolTitle)}${server ? ` in ${server}` : ""}.`,
  };
};

/** A tool's machine name read as words: "read_query" as "read query". */
const spokenToolTitle = (title: string): string =>
  title.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Languages with the pointer sentence only, until a native speaker has judged
// the full card in them.

const pointerOnly = (options: WordOptions): LanguageWords => ({
  ...english(options),
  full: false,
});

const POINTER_ONLY: readonly string[] = ["fr", "es", "pl"];

/** The words for `language` ("de", "de-DE", …); English for one without its own. */
export const spokenWordsFor = (
  language: string,
  options: WordOptions,
): LanguageWords => {
  const code = language.split(/[-_]/)[0]?.toLowerCase() ?? "en";
  if (code === "de") return german(options);
  if (POINTER_ONLY.includes(code)) return pointerOnly(options);
  return english(options);
};
