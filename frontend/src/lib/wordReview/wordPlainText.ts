import type {
  WordPlanBlock,
  WordPlanRun,
  WordSourceBlock,
} from "./wordDocumentPlan";
import type { WordTableRow } from "./wordTableContent";

/**
 * The plain-text form for new blocks of a document part (ERMAIN-1293). One
 * non-empty line is one block: `#`–`######` headings, `- ` bullets and `1. `
 * numbered items with two spaces of indent per level, `| a | b |` table rows
 * with a `|---|` line after the first row for a header row, and `**bold**` and
 * `*italic*` inside a line. A `\` at the start of a line keeps it as text.
 */

/** Where a converted top-level block came from: its line, and a table's line per row. */
export interface WordPlainTextOrigin {
  line: number;
  rows?: number[];
}

export interface WordPlainTextIssue {
  /** 1-based, counting blank lines, as the text was sent. */
  line: number;
  message: string;
}

export interface WordPlainTextOptions {
  /** Block ids and list names start with it; unique per text in a plan. */
  idPrefix: string;
  /** The table style new tables take, the document's own. */
  tableStyle?: string;
  /** The blocks a replacing text takes the place of, in order. */
  replaced?: readonly WordSourceBlock[];
}

export interface WordPlainTextResult {
  blocks: WordPlanBlock[];
  origins: WordPlainTextOrigin[];
  issues: WordPlainTextIssue[];
}

const MAX_ISSUES = 8;
const MAX_LIST_LEVEL = 8;
const KEEP_AS_TEXT = "or start the line with \\ to keep it as text";

/** `\|` is a literal bar inside a cell. */
function tableCells(line: string): string[] {
  const inner = line.trim().slice(1, -1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && inner[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (inner[i] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += inner[i];
  }
  cells.push(cell.trim());
  return cells;
}

const isSeparator = (cells: string[]) =>
  cells.every((cell) => /^:?-+:?$/u.test(cell));

const INLINE =
  /\*\*\*(?!\s)(.+?)(?<!\s)\*\*\*|\*\*(?!\s)(.+?)(?<!\s)\*\*|\*(?!\s)([^*]+?)(?<!\s)\*/gu;

/** Runs only when a line has formatting; an unclosed `**` is a slip, a lone `*` is text. */
function inlineRuns(
  value: string,
): { text: string; runs?: WordPlanRun[] } | { unclosed: true } {
  const runs: WordPlanRun[] = [];
  let last = 0;
  for (const match of value.matchAll(INLINE)) {
    const at = match.index;
    if (at > last) runs.push({ text: value.slice(last, at) });
    if (match[1] !== undefined)
      runs.push({ text: match[1], bold: true, italic: true });
    else if (match[2] !== undefined) runs.push({ text: match[2], bold: true });
    else runs.push({ text: match[3], italic: true });
    last = at + match[0].length;
  }
  if (last < value.length) runs.push({ text: value.slice(last) });
  if (runs.some((run) => !run.bold && !run.italic && run.text.includes("**")))
    return { unclosed: true };
  const text = runs.map((run) => run.text).join("");
  return runs.some((run) => run.bold || run.italic)
    ? { text, runs: runs.filter((run) => run.text) }
    : { text };
}

/** The nearest replaced block of `type` to output position `at`, ties to the earlier one. */
function nearest(
  replaced: readonly WordSourceBlock[],
  type: WordSourceBlock["type"],
  at: number,
): WordSourceBlock | undefined {
  let best: WordSourceBlock | undefined;
  let distance = Infinity;
  replaced.forEach((source, k) => {
    if (source.type === type && Math.abs(k - at) < distance) {
      best = source;
      distance = Math.abs(k - at);
    }
  });
  return best;
}

export function wordPlainTextBlocks(
  text: string,
  { idPrefix, tableStyle, replaced = [] }: WordPlainTextOptions,
): WordPlainTextResult {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: WordPlanBlock[] = [];
  const origins: WordPlainTextOrigin[] = [];
  const issues: WordPlainTextIssue[] = [];
  let sequence = 0;
  const nextId = () => `${idPrefix}_${++sequence}`;
  let lists = 0;
  /** The open list group per level of the current list, with the next number it shows. */
  let groups: ({ name: string; ordered: boolean; next: number } | undefined)[] =
    [];
  const issue = (line: number, message: string) => {
    if (issues.length < MAX_ISSUES)
      issues.push({ line, message: `Line ${line}: ${message}` });
  };
  const inline = (value: string, line: number) => {
    const result = inlineRuns(value);
    if ("unclosed" in result) {
      issue(line, `close **bold** with ** on the same line, ${KEEP_AS_TEXT}.`);
      return { text: value };
    }
    return result;
  };
  const push = (block: WordPlanBlock, origin: WordPlainTextOrigin) => {
    blocks.push(block);
    origins.push(origin);
  };
  const paragraph = (value: string, line: number, formatted = true) => {
    const content = formatted ? inline(value, line) : { text: value };
    const style = nearest(replaced, "paragraph", blocks.length)?.styleRef;
    push(
      {
        id: nextId(),
        type: "paragraph",
        ...content,
        ...(style ? { styleRef: style } : {}),
      },
      { line },
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const raw = lines[i].replace(/\t/gu, "  ");
    const trimmed = raw.trim();
    if (!trimmed) {
      groups = [];
      continue;
    }
    if (trimmed.startsWith("\\")) {
      groups = [];
      const rest = trimmed.slice(1).trim();
      if (rest) paragraph(rest, line, false);
      else
        issue(
          line,
          "a \\ keeps the rest of the line as text, but nothing follows it.",
        );
      continue;
    }
    if (trimmed.startsWith("|")) {
      groups = [];
      const rows: { cells: string[]; line: number }[] = [];
      let header = false;
      let width = 0;
      let broken = false;
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        const at = i + 1;
        const row = lines[i].trim();
        if (row.length < 2 || !row.endsWith("|") || row.endsWith("\\|")) {
          issue(
            at,
            "a table row starts and ends with |; put every cell between bars, like | a | b |.",
          );
          broken = true;
          continue;
        }
        const cells = tableCells(row);
        if (isSeparator(cells)) {
          if (rows.length !== 1 || header) {
            issue(
              at,
              "a |---| line belongs directly after a table's first row, where it makes that row the header; remove it here.",
            );
            broken = true;
          } else if (cells.length !== width) {
            issue(
              at,
              `this |---| line has ${cells.length} cells, but the table's first row (line ${rows[0].line}) has ${width}; give it one --- per column.`,
            );
            broken = true;
          } else header = true;
          continue;
        }
        if (!rows.length) width = cells.length;
        else if (cells.length !== width) {
          issue(
            at,
            `this table row has ${cells.length} cells, but the table's first row (line ${rows[0].line}) has ${width}; give every row of a table the same number of cells, leaving a cell empty as | |.`,
          );
          broken = true;
        }
        if (cells.some((cell) => /<br\s*\/?>/iu.test(cell))) {
          issue(
            at,
            "a table cell holds one line of text; write it without <br>, or keep a cell that needs several paragraphs by reference.",
          );
          broken = true;
        }
        rows.push({ cells, line: at });
      }
      i--;
      if (!rows.length) {
        if (!broken)
          issue(line, "a table needs at least one row of cells before |---|.");
        continue;
      }
      if (broken) continue;
      const tableRows: WordTableRow<WordPlanBlock>[] = rows.map(
        ({ cells, line: at }, k) => ({
          ...(header && k === 0 ? { format: { repeatHeader: true } } : {}),
          cells: cells.map((cell) => {
            if (!cell) return { blocks: [] };
            const content = inline(cell, at);
            // Without a table style a header row has no look of its own.
            const runs =
              header && k === 0 && !tableStyle
                ? (content.runs ?? [{ text: content.text }]).map((run) => ({
                    ...run,
                    bold: true,
                  }))
                : content.runs;
            return {
              blocks: [
                {
                  id: nextId(),
                  type: "paragraph" as const,
                  text: content.text,
                  ...(runs ? { runs } : {}),
                },
              ],
            };
          }),
        }),
      );
      push(
        {
          id: nextId(),
          type: "table",
          text: "",
          format: {
            ...(tableStyle ? { styleRef: tableStyle } : {}),
            firstRow: header,
          },
          rows: tableRows,
        },
        { line, rows: rows.map((row) => row.line) },
      );
      continue;
    }
    const heading = /^(#{1,})\s+(.*)$/u.exec(trimmed);
    if (heading) {
      groups = [];
      const level = heading[1].length;
      const value = heading[2].trim();
      if (level > 6)
        issue(line, `headings go from # to ######, ${KEEP_AS_TEXT}.`);
      else if (!value) issue(line, "a heading needs text after its #.");
      else
        push(
          { id: nextId(), type: "heading", level, ...inline(value, line) },
          { line },
        );
      continue;
    }
    const item = /^(\s*)([-*•]|(\d{1,9})[.)])\s+(.*)$/u.exec(raw);
    if (item) {
      const value = item[4].trim();
      if (!value) {
        issue(line, "a list item needs text after its marker.");
        continue;
      }
      // Deeper indents than one level below the item before count as one level.
      const level = Math.min(
        MAX_LIST_LEVEL,
        Math.floor(item[1].length / 2),
        groups.length,
      );
      const ordered = item[3] !== undefined;
      groups = groups.slice(0, level + 1);
      let group = groups[level];
      if (group?.ordered !== ordered) {
        group = { name: `${idPrefix}_list${++lists}`, ordered, next: 1 };
        groups[level] = group;
      }
      if (ordered) {
        const number = Number(item[3]);
        if (number !== group.next && number !== 1)
          issue(
            line,
            `this item shows as ${group.next}., not ${number}.: ${
              group.next === 1
                ? "a new numbered list always starts at 1"
                : "items are numbered in order"
            }. Number it ${group.next}., ${KEEP_AS_TEXT}.`,
          );
        group.next++;
      }
      const style = nearest(replaced, "list-item", blocks.length)?.styleRef;
      push(
        {
          id: nextId(),
          type: "list-item",
          list: group.name,
          level,
          ordered,
          ...inline(value, line),
          ...(style ? { styleRef: style } : {}),
        },
        { line },
      );
      continue;
    }
    groups = [];
    if (/^(```|~~~)/u.test(trimmed))
      issue(
        line,
        `code fences are not part of the plain-text form; leave the fence out, ${KEEP_AS_TEXT}.`,
      );
    else if (/^([-*_])(\s*\1){2,}$/u.test(trimmed))
      issue(
        line,
        `a line of dashes or stars is not part of the plain-text form; leave it out, ${KEEP_AS_TEXT}.`,
      );
    else paragraph(trimmed, line);
  }
  return { blocks, origins, issues };
}

/** The style of the document's tables, for new ones: the most used, else a defined Table Grid. */
export function wordDocumentTableStyle(snapshot: {
  blocks: readonly WordSourceBlock[];
  styles: readonly { id: string; name: string; type?: string }[];
}): string | undefined {
  const counts = new Map<string, number>();
  for (const block of snapshot.blocks) {
    const style = block.content?.format.styleRef;
    if (block.nativeKind === "table" && style)
      counts.set(style, (counts.get(style) ?? 0) + 1);
  }
  const used = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (used && snapshot.styles.some((s) => s.id === used && s.type === "table"))
    return used;
  return snapshot.styles.find(
    (s) =>
      s.type === "table" &&
      (s.id.toLowerCase() === "tablegrid" ||
        s.name.toLowerCase() === "table grid"),
  )?.id;
}
