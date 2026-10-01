import type { WordInPlaceMarks, WordInPlaceRun } from "./wordInPlacePlan";

/** Paragraph.getTextRanges ending marks: one range per word, its trailing space included. */
export const WORD_SPAN_ENDING_MARKS = [" "];

/** Beyond this many token comparisons a paragraph is rewritten whole. */
const MAX_DIFF_CELLS = 250_000;

/** One changed stretch of a paragraph: live ranges [from, to) go, `insert` comes in next to an
 * unchanged range, whose marks the new text starts from. */
export interface WordSpanEdit {
  from: number;
  to: number;
  insert: WordInPlaceRun[];
  anchor: {
    range: number;
    location: "After" | "Before";
    inherited: WordInPlaceMarks;
  };
}

interface Token {
  text: string;
  marks: WordInPlaceMarks[];
}

const markKey = (m: WordInPlaceMarks) =>
  `${+m.bold}${+m.italic}${+m.underline}`;
const tokenKey = (t: Token) => `${t.marks.map(markKey).join("")}:${t.text}`;

function characterMarks(runs: readonly WordInPlaceRun[]): WordInPlaceMarks[] {
  return runs.flatMap((run) =>
    Array.from({ length: run.text.length }, () => ({
      bold: run.bold,
      italic: run.italic,
      underline: run.underline,
    })),
  );
}

/** The same split Paragraph.getTextRanges([" "], false) makes: each word with its trailing space. */
export function wordSpanTokens(text: string): string[] {
  return text.match(/[^ ]*(?: |$)/g)?.filter(Boolean) ?? [];
}

function tokens(
  texts: readonly string[],
  marks: readonly WordInPlaceMarks[],
): Token[] {
  let at = 0;
  return texts.map((text) => {
    const token = { text, marks: marks.slice(at, at + text.length) };
    at += text.length;
    return token;
  });
}

function runsOf(list: readonly Token[]): WordInPlaceRun[] {
  const runs: WordInPlaceRun[] = [];
  for (const { text, marks } of list)
    for (let i = 0; i < text.length; i++) {
      const last = runs.at(-1);
      if (last && markKey(last) === markKey(marks[i])) last.text += text[i];
      else runs.push({ text: text[i], ...marks[i] });
    }
  return runs;
}

/** Longest common subsequence of token keys, as matched index pairs. */
function matches(
  a: readonly string[],
  b: readonly string[],
): [number, number][] {
  const table = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; )
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  return pairs;
}

/**
 * Word-level edits that turn a live paragraph (its getTextRanges texts) from `original` into
 * `target`. Undefined when the ranges do not rejoin to the paragraph text, the paragraph is not the
 * captured one, or no word survives: the whole paragraph is then rewritten instead.
 */
export function planWordSpanEdits(
  ranges: readonly string[],
  liveText: string,
  original: readonly WordInPlaceRun[],
  target: readonly WordInPlaceRun[],
): WordSpanEdit[] | undefined {
  const originalText = original.map((r) => r.text).join("");
  if (ranges.join("") !== liveText || liveText !== originalText)
    return undefined;
  if (ranges.some((range) => !range)) return undefined;
  const live = tokens(ranges, characterMarks(original));
  const wanted = tokens(
    wordSpanTokens(target.map((r) => r.text).join("")),
    characterMarks(target),
  );
  if (live.length * wanted.length > MAX_DIFF_CELLS) return undefined;
  const pairs = matches(live.map(tokenKey), wanted.map(tokenKey));
  if (!pairs.length) return undefined;
  const edits: WordSpanEdit[] = [];
  const bounds: [number, number][] = [
    [-1, -1],
    ...pairs,
    [live.length, wanted.length],
  ];
  for (let k = 1; k < bounds.length; k++) {
    const [i0, j0] = bounds[k - 1];
    const [i1, j1] = bounds[k];
    const from = i0 + 1;
    const to = i1;
    const insert = runsOf(wanted.slice(j0 + 1, j1));
    if (from === to && !insert.length) continue;
    const anchor =
      from > 0
        ? {
            range: from - 1,
            location: "After" as const,
            inherited: live[from - 1].marks.at(-1)!,
          }
        : {
            range: to,
            location: "Before" as const,
            inherited: live[to].marks[0],
          };
    edits.push({ from, to, insert, anchor });
  }
  return edits;
}

function setMarks(
  range: Word.Range,
  run: WordInPlaceMarks,
  inherited: WordInPlaceMarks,
): void {
  if (run.bold !== inherited.bold) range.font.bold = run.bold;
  if (run.italic !== inherited.italic) range.font.italic = run.italic;
  if (run.underline !== inherited.underline)
    range.font.underline = run.underline ? "Single" : "None";
}

/** Queue the edits last to first, so every range still covers the text it was read with. */
export function queueWordSpanEdits(
  ranges: readonly Word.Range[],
  edits: readonly WordSpanEdit[],
): void {
  for (const edit of [...edits].reverse()) {
    if (edit.to > edit.from)
      (edit.to - edit.from === 1
        ? ranges[edit.from]
        : ranges[edit.from].expandTo(ranges[edit.to - 1])
      ).delete();
    let previous = edit.anchor.inherited;
    let range: Word.Range | undefined;
    for (const run of edit.insert) {
      range = range
        ? range.insertText(run.text, "After")
        : ranges[edit.anchor.range].insertText(run.text, edit.anchor.location);
      setMarks(range, run, previous);
      previous = run;
    }
  }
}
