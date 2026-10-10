/**
 * A Word selection reply as a chat stores it: the word_selection facet args
 * the add-in sent and the erato-word-replace fence the model answered with.
 * The kept_items format is the add-in's wordKeptItemsArg; a contract test in
 * the add-in runs its output through this parser.
 */

export type WordKeptItemKind =
  | "field"
  | "note"
  | "picture"
  | "break"
  | "link"
  | "comment"
  | "control"
  | "bookmark";

/** What one marker number stands for, as the kept_items argument says. */
export interface WordKeptItemNote {
  /**
   * "format" for a format span: text that keeps its own bold, italic,
   * underline or strikethrough.
   */
  kind: WordKeptItemKind | "format";
  /** One point the text flows around; otherwise a span, whose ends show no text. */
  point: boolean;
  /** What a point shows, such as a field's result; "" when nothing. */
  shows: string;
  /** A format span's emphasis in kept_items' words: ["bold", "not italic"]. */
  formatting?: readonly string[];
}

export type WordKeptItemNotes = ReadonlyMap<number, WordKeptItemNote>;

const KEPT_ITEM_KINDS: Readonly<Record<string, WordKeptItemKind>> = {
  "a field": "field",
  "a link": "link",
  "a footnote or endnote reference": "note",
  "a comment": "comment",
  "a picture": "picture",
  "a line break": "break",
  "a content control": "control",
  "a bookmark": "bookmark",
};

const NAME = `(${Object.keys(KEPT_ITEM_KINDS).join("|")})`;

const KEPT_ITEM_LINES: readonly { pattern: RegExp; point: boolean }[] = [
  {
    pattern: new RegExp(
      `^\u27E6(\\d+)\u27E7 ${NAME}(?: showing "(.*)")?$`,
      "u",
    ),
    point: true,
  },
  {
    pattern: new RegExp(
      `^\u27E6(\\d+)\u27E7\u2026\u27E6/\\1\u27E7 ${NAME} around the text between; that text may change$`,
      "u",
    ),
    point: false,
  },
  {
    pattern: new RegExp(
      `^\u27E6(\\d+)\u27E7 where ${NAME} starts; it runs on past the selection$`,
      "u",
    ),
    point: false,
  },
  {
    pattern: new RegExp(
      `^\u27E6/(\\d+)\u27E7 where ${NAME} that started before the selection ends$`,
      "u",
    ),
    point: false,
  },
];

const FORMAT_LINE =
  /^\u27E6(\d+)\u27E7\u2026\u27E6\/\1\u27E7 formatting: (.+)$/u;

/** The marker numbers kept_items explains; a line it does not recognise is skipped. */
export function parseWordKeptItems(arg: string | undefined): WordKeptItemNotes {
  const notes = new Map<number, WordKeptItemNote>();
  for (const line of (arg ?? "").split(/\r?\n/u)) {
    const format = FORMAT_LINE.exec(line);
    if (format) {
      notes.set(Number(format[1]), {
        kind: "format",
        point: false,
        shows: "",
        formatting: format[2].split(", "),
      });
      continue;
    }
    for (const { pattern, point } of KEPT_ITEM_LINES) {
      const match = pattern.exec(line);
      if (!match) continue;
      notes.set(Number(match[1]), {
        kind: KEPT_ITEM_KINDS[match[2]],
        point,
        shows: match[3] ?? "",
      });
      break;
    }
  }
  return notes;
}

const WORD_MARKER = /\u27E6(\/?)(\d+)\u27E7/gu;

/** Each ⟦n⟧ and ⟦/n⟧ marker of `text` replaced by what `replace` gives for it. */
export function replaceWordMarkers(
  text: string,
  replace: (number: number, close: boolean) => string,
): string {
  return text.replace(WORD_MARKER, (_marker, close: string, number: string) =>
    replace(Number(number), close === "/"),
  );
}

/**
 * The text without markers, as the add-in's context-only fallback words it: a
 * point gives what it shows, a span's ends give nothing.
 */
export function wordSelectionWithoutMarkers(
  text: string,
  notes: WordKeptItemNotes,
): string {
  return replaceWordMarkers(text, (number, close) => {
    const note = notes.get(number);
    return !close && note?.point ? note.shows : "";
  });
}

/**
 * The passage a reply rewrites, one line per paragraph, when the request
 * stored all of it; null for context only or a cut selection.
 */
export function wordSelectionReplyOriginal(
  args: Readonly<Record<string, string>> | undefined,
): string | null {
  const text = args?.selected_text;
  if (!text || args.selection_role !== "rewrite" || args.truncated === "true")
    return null;
  return text.split("\n").length === Number(args.paragraph_count) ? text : null;
}

/**
 * The fence content as the add-in would write it: Word turns every newline
 * into a paragraph, so a single-paragraph rewrite has its line breaks joined.
 */
export function wordSelectionReplyProposal(
  content: string,
  shape: string | undefined,
): string {
  const text = content
    .replace(/\r\n?|[\u2028\u2029]/gu, "\n")
    .replace(/\n$/u, "");
  return shape === "multi_paragraph"
    ? text
    : text.replace(/^\n+|\n+$/gu, "").replace(/[ \t]*\n+[ \t]*/gu, " ");
}
