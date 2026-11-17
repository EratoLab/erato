/* eslint-disable lingui/no-unlocalized-strings -- entry keys and piece roles of this module; the spoken words are in spokenCardWords */
import { toolCallCardOf } from "./gist";
import {
  detailValues,
  spokenApprovalPieces,
  spokenFactsOf,
  spokenPiecesOf,
  whatValues,
} from "./spokenCard";
import { spokenWordsFor } from "./spokenCardWords";

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
 * words do not mention is marked as not asked for, so nothing changes
 * unheard. A card about another item, or a withdrawn card the user hardly
 * heard, is said in full instead.
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

/** A thing a card says that a later card can say differently. */
interface Entry {
  key: string;
  /** The id of the piece that said it on a card, for what was heard. */
  heardAs: string;
  role: SpokenPieceRole;
  sentence: string;
  /** What has to be equal for the entry to be unchanged. */
  compare: string;
  /** The field it is about, for the sentence of an entry that is gone. */
  field?: string;
  mustSay: boolean;
  values: SpokenSource[];
  readOut?: SpokenReadOut;
}

const pieceId = (role: SpokenPieceRole, field?: string) =>
  Array.from(field ? `${role}:${field}` : role)
    .slice(0, 60)
    .join("");

const CREATING: readonly string[] = ["create", "send", "upload"];

/** What the call acts on: when this differs, the card is about another item. */
const identityOf = (gist: Gist, server: string | undefined): string => {
  const lead = gist.items[0];
  const named = (values: typeof lead.names) =>
    values.map((value) => `${value.origin}:${value.written ?? value.text}`);
  return JSON.stringify([
    gist.action,
    gist.kind,
    server ?? "",
    lead.count,
    // Where a message goes is its recipients, compared on their own.
    gist.change?.recipients ? [] : named(lead.where),
    gist.change?.opaque[0]?.kind ?? "",
    CREATING.includes(gist.action) ? [] : named(lead.names),
    lead.hiddenIdPaths.length,
  ]);
};

const entriesOf = (facts: SpokenFacts, words: LanguageWords): Entry[] => {
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
  const text = (slot: SpokenSource["slot"], value: string): SpokenSource => ({
    slot,
    value: { kind: "text", text: value },
  });
  if (CREATING.includes(facts.action) && facts.count === 1) {
    const name = facts.names.at(0);
    if (name !== undefined) {
      add({
        key: "name",
        heardAs: "item",
        role: "item",
        sentence: words.difference.title(facts.kind, name),
        compare: name,
        mustSay: true,
        values: [text("name", name)],
      });
    }
  }
  if (facts.recipients) {
    const { recipients } = facts;
    add({
      key: "recipients",
      heardAs: "what",
      role: "detail",
      sentence: words.difference.recipientsNow(recipients),
      compare: JSON.stringify([recipients.names, recipients.total]),
      mustSay: true,
      values: recipients.names.map((name) => text("recipient", name)),
    });
    const outside = words.outside(recipients);
    if (outside.length > 0) {
      add({
        key: "outside",
        heardAs: "outside",
        role: "outside",
        sentence: outside,
        compare: outside,
        mustSay: true,
        values: [],
      });
    }
  }
  for (const detail of facts.details) {
    const field = "field" in detail ? detail.field : undefined;
    const sentence = words.detail(detail, facts);
    add({
      key: pieceId("detail", field),
      heardAs: pieceId("detail", field),
      role: "detail",
      sentence,
      compare: sentence,
      field,
      mustSay: detail.loss,
      values: detailValues(detail),
    });
  }
  for (const spokenText of facts.texts) {
    const field = spokenText.field || undefined;
    add({
      key: pieceId("text", field),
      heardAs: pieceId("text", field),
      role: "text",
      sentence: words.text(spokenText),
      compare: spokenText.full?.text ?? spokenText.read ?? "",
      field,
      mustSay: false,
      values: [
        ...(field ? [text("field", field)] : []),
        spokenText.read === undefined
          ? {
              slot: "words",
              value: {
                kind: "number",
                value: spokenText.words,
                percent: false,
              },
            }
          : text("text", spokenText.read),
      ],
      ...(spokenText.read === undefined && spokenText.full
        ? { readOut: spokenText.full }
        : {}),
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
        text("consequence", consequence),
      ),
    });
  }
  return entries;
};

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

const monthNames = (month: number): string[] =>
  ["de-DE", "en-GB"].map((locale) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" })
      .format(Date.UTC(2000, month - 1, 1))
      .toLowerCase(),
  );

/** What a user may say to name a value: its words, numbers, day and month. */
const termsOfValue = (value: EarValue): string[] => {
  switch (value.kind) {
    case "text":
      return tokensOf(value.text);
    case "number":
      return [String(Math.trunc(value.value)), String(value.value)];
    case "date":
      return [
        String(value.day),
        String(value.year),
        ...monthNames(value.month),
      ];
    case "datetime":
      return [
        String(value.day),
        String(value.year),
        String(value.hour),
        ...monthNames(value.month),
      ];
    case "bool":
    case "unread":
    case "id":
      return [];
  }
};

const termsOf = (entry: Entry): string[] => [
  ...(entry.field ? tokensOf(entry.field) : []),
  ...entry.values.flatMap((source) =>
    source.slot === "words" ? [] : termsOfValue(source.value),
  ),
];

/** The words a long text gained or lost: what a user says to change it. */
const textChange = (before: string | undefined, after: string): string[] => {
  const old = new Set(tokensOf(before ?? ""));
  const now = new Set(tokensOf(after));
  return [
    ...[...now].filter((token) => !old.has(token)),
    ...[...old].filter((token) => !now.has(token)),
  ];
};

/**
 * Whether the user's words name an entry: one of its values, or its field.
 * Numbers have to match exactly; a word of four letters or more may be part
 * of a longer one ("Müllers"). When in doubt a difference counts as not
 * asked for, which only makes the voice say more.
 */
const mentions = (said: readonly string[], terms: readonly string[]) =>
  terms.some((term) => {
    if (FILLERS.has(term)) return false;
    if (/^\d+$/.test(term)) return said.includes(term);
    if (term.length < 3) return false;
    return said.some(
      (token) =>
        token === term ||
        (term.length >= 4 &&
          token.length >= 4 &&
          (token.includes(term) || term.includes(token))),
    );
  });

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
  if (previous.approval.type !== "call" || next.type !== "call") {
    return introduced(whole, "reread", words);
  }
  const before = toolCallCardOf(
    previous.approval.label,
    previous.approval.input,
  );
  const after = toolCallCardOf(next.label, next.input);
  if (before.kind !== "gist" || after.kind !== "gist") {
    const same =
      previous.approval.toolTitle === next.toolTitle &&
      previous.approval.server === next.server &&
      JSON.stringify(previous.approval.input) === JSON.stringify(next.input);
    return introduced(whole, same ? "same" : "reread", words);
  }
  if (!heard.has("what")) return introduced(whole, "reread", words);
  if (
    identityOf(before.gist, previous.approval.server) !==
    identityOf(after.gist, next.server)
  ) {
    return introduced(whole, "other_item", words);
  }

  const { timeZone } = options;
  const oldEntries = entriesOf(
    spokenFactsOf(before.gist, previous.approval.server, timeZone, true),
    words,
  );
  const newFacts = spokenFactsOf(after.gist, next.server, timeZone, true);
  const newEntries = entriesOf(newFacts, words);
  const spokenWords = tokensOf(previous.words);
  const oldByKey = new Map(oldEntries.map((entry) => [entry.key, entry]));
  const newKeys = new Set(newEntries.map((entry) => entry.key));

  const asked: ComposedPiece[] = [];
  const unasked: ComposedPiece[] = [];
  const owed: ComposedPiece[] = [];
  const differs = (entry: Entry, sentence: string, wanted: boolean) =>
    (wanted ? asked : unasked).push({
      role: entry.role,
      text: words.difference.differs(wanted, sentence),
      mustSay: true,
      values: entry.values,
      ...(entry.readOut ? { readOut: entry.readOut } : {}),
    });
  let consequence: Entry | undefined;
  let nameChanged = false;
  for (const entry of newEntries) {
    const old = oldByKey.get(entry.key);
    if (old?.compare !== entry.compare) {
      if (entry.key === "name") nameChanged = true;
      differs(
        entry,
        entry.sentence,
        mentions(spokenWords, [
          ...termsOf(entry),
          ...(old ? termsOf(old) : []),
          ...(entry.role === "text"
            ? textChange(old?.compare, entry.compare)
            : []),
        ]),
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
    if (newKeys.has(old.key) || old.field === undefined) continue;
    differs(
      { ...old, values: [] },
      words.difference.dropped(old.field),
      mentions(spokenWords, termsOf(old)),
    );
  }

  const spoken = spokenFactsOf(after.gist, next.server, timeZone);
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
            values: facts.names.slice(0, 1).map(
              (name): SpokenSource => ({
                slot: "name",
                value: { kind: "text", text: name },
              }),
            ),
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
  const differences = [...asked, ...unasked];
  if (differences.length === 0) {
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
  const beyond = differences.length - MAX_SAID_DIFFERENCES;
  const told =
    beyond > 0
      ? [
          ...differences.slice(0, MAX_SAID_DIFFERENCES - 1),
          {
            role: "more" as const,
            text: words.more(beyond + 1),
            mustSay: true,
            values: [],
          },
        ]
      : differences;
  return {
    intro: "changed",
    pieces: spokenPiecesOf(
      [
        ...lead,
        ...told,
        ...owed,
        {
          role: "more",
          text: words.difference.rest(),
          mustSay: false,
          values: [],
        },
        ...closing,
      ],
      options,
    ),
  };
};
