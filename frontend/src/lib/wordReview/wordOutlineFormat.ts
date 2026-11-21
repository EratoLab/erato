import { wordBodyRef, wordBodyRefIndex } from "./wordBodyRef";

/**
 * The heading_outline text a request carries for a document too large for a
 * complete read. The add-in writes it and a stored card reads it back, so both
 * use the definitions here.
 */

/** Titles are cut to this many code points. */
export const WORD_OUTLINE_TITLE_CHARS = 80;
/** The title of the part before the first heading, which has none of its own. */
export const WORD_OUTLINE_START_OF_DOCUMENT = "(start of document)";
export const WORD_OUTLINE_HEADER =
  "Each line: [ref|H<level> heading, S numbered section or P part|size|paragraphs] title";
const OMISSION_TAIL = "; section:{ref, throughRef} reads any range of blocks.";
const LEVELS_ONLY = ", all deeper than the levels listed";

/** H: a heading; S: a numbered section; P: a part of about 20 KiB where nothing else structures a span. */
export type WordOutlineTag = "H" | "S" | "P";

export interface WordOutlineLineEntry {
  ref: string;
  level: number;
  tag: WordOutlineTag;
  title: string;
  kib: number;
  paragraphs: number;
}

export function wordOutlineLine(entry: WordOutlineLineEntry): string {
  const tag = entry.tag === "H" ? `H${entry.level}` : entry.tag;
  return `[${entry.ref}|${tag}|${entry.kib.toFixed(1)} KiB|${entry.paragraphs} ¶] ${entry.title}`;
}

const omissionStart = (count: number) =>
  `${count} more ${count === 1 ? "entry is" : "entries are"} left out`;

/** The last line when entries are left out; `endsBefore` is the first entry a cut tail left out. */
export function wordOutlineOmission(
  count: number,
  endsBefore?: string,
): string {
  const left = omissionStart(count);
  return endsBefore
    ? `${left} and the outline ends before ${endsBefore}${OMISSION_TAIL}`
    : `${left}${LEVELS_ONLY}${OMISSION_TAIL}`;
}

export interface WordParsedOutline {
  /** The headings it lists, by ref; the part before the first heading is none. */
  headings: ReadonlyMap<string, { level: number; title: string }>;
  /** Entries were left out: only the heading levels it lists are complete. */
  shortened: boolean;
  /** A cut tail may start here: the outline says nothing about this block or the ones after it. */
  endsBefore?: string;
}

const LINE =
  /^\[([^|\]]+)\|(?:H([1-9])|(S|P))\|(\d+\.\d) KiB\|(\d+) ¶\] (.*)$/u;
const OMISSION =
  /^(\d+) more .*? left out(?: and the outline ends before ([^\s;]+))?/u;

/** Reads heading_outline text back; undefined when there is none or a line is not in this format. */
export function parseWordOutline(text: string): WordParsedOutline | undefined {
  const [header, ...lines] = text.split("\n");
  if (header !== WORD_OUTLINE_HEADER) return undefined;
  const headings = new Map<string, { level: number; title: string }>();
  let shortened = false;
  let endsBefore: string | undefined;
  let last: string | undefined;
  for (const [k, line] of lines.entries()) {
    const entry = LINE.exec(line);
    if (entry) {
      const [, ref, level, tag, kib, paragraphs, title] = entry;
      const parsed: WordOutlineLineEntry = {
        ref,
        level: Number(level ?? 0),
        tag: tag ? (tag as WordOutlineTag) : "H",
        title,
        kib: Number(kib),
        paragraphs: Number(paragraphs),
      };
      if (wordOutlineLine(parsed) !== line) return undefined;
      last = ref;
      if (parsed.tag === "H" && title !== WORD_OUTLINE_START_OF_DOCUMENT)
        headings.set(ref, { level: parsed.level, title });
      continue;
    }
    const omission = OMISSION.exec(line);
    if (!omission || k !== lines.length - 1) return undefined;
    const count = Number(omission[1]);
    shortened = true;
    if (line === wordOutlineOmission(count, omission[2]))
      endsBefore = omission[2];
    // Earlier releases wrote this line whether or not they cut the tail, so a
    // cut may start right after the last entry.
    else if (line === `${omissionStart(count)}${OMISSION_TAIL}`) {
      const at = last === undefined ? -1 : wordBodyRefIndex(last);
      if (at === undefined) return undefined;
      endsBefore = wordBodyRef(at + 1);
    } else return undefined;
  }
  return { headings, shortened, ...(endsBefore ? { endsBefore } : {}) };
}
