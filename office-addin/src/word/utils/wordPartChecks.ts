import { wordBlockIndex, wordCaptureSections } from "./wordDocumentOutline";
import { wordPartRanges, wordPartRowName } from "./wordDocumentParts";
import { wordTitledEntry } from "./wordPlanCoverage";

import type {
  WordPartOp,
  WordPartRow,
  WordPartsAssembly,
  WordPartsDraft,
  WordPartsPlan,
} from "./wordDocumentParts";
import type {
  WordAuthoringSnapshot,
  WordPlanBlock,
  WordPlanDiagnostics,
  WordPlanRun,
  WordSourceBlock,
} from "@erato/frontend/word-review";

/**
 * Code checks of a part against the capture (ERMAIN-1298). Every rule comes from the document
 * (its digits, its clause markers, its heading numbers) or from the section plan's terms, so no
 * language needs a word list; meaning is left to the review.
 */

/** Checks a part may waive when its change is intended; the card then names them on the row. */
export const WORD_PART_ALLOWS = [
  "numbers",
  "clause-numbering",
  "term",
  "kept-unchanged",
  "cross-reference",
] as const;
export type WordPartAllow = (typeof WORD_PART_ALLOWS)[number];

export interface WordPartCheck {
  issues: WordPlanDiagnostics;
  /** Checks that found a change the part allows. */
  waived: WordPartAllow[];
}

const NUMBER = /\p{N}+(?:[.,]\p{N}+)*/gu;
/** "(3)", "(a)", "(iv)", "3)", "a)" at the start, after at most a short lead-in such as
 * "Note: ". */
const CLAUSE_MARKER =
  /^(?:[^\s():]{1,24}(?: [^\s():]{1,24}){0,2}: )?(\((?:\p{N}{1,3}|\p{L}{1,4})\)|(?:\p{N}{1,3}|\p{L})\))(?=\s)/u;
/** A heading's own number: "§ 10", "10.1", "Article 5"; a bare "3" is not distinctive. */
const HEADING_LABEL =
  /^((?:[^\s\p{N}]{1,12} ?)?)(\p{N}+(?:\.\p{N}+)*)\.?(?=\s|$)/u;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const norm = (text: string) =>
  text.normalize("NFC").replace(/\s+/gu, " ").trim();

interface WordSectionLabel {
  label: string;
  title: string;
  /** Index of the heading block, and the blocks [from, to) of its section. */
  heading: number;
  from: number;
  to: number;
  pattern: RegExp;
}

function headingLabel(title: string): string | undefined {
  const match = HEADING_LABEL.exec(title.trim());
  if (!match) return undefined;
  const prefix = match[1].trim();
  if (!prefix && !match[2].includes(".")) return undefined;
  return prefix ? `${prefix} ${match[2]}` : match[2];
}

function labelPattern(label: string): RegExp {
  const [prefix, number] = label.includes(" ")
    ? [
        label.slice(0, label.lastIndexOf(" ")),
        label.slice(label.lastIndexOf(" ") + 1),
      ]
    : ["", label];
  const lead = prefix
    ? `(?<![\\p{L}\\p{N}])${escapeRegExp(prefix)}\\s?`
    : "(?<![\\p{N}.,])";
  return new RegExp(
    `${lead}${escapeRegExp(number)}(?![\\p{N}]|[.,]\\p{N})`,
    "giu",
  );
}

const labelsCache = new WeakMap<
  WordAuthoringSnapshot,
  { fingerprint: string; labels: WordSectionLabel[] }
>();

/** The document's section numbers, by which its text refers to its sections. */
export function wordSectionLabels(
  snapshot: WordAuthoringSnapshot,
): readonly WordSectionLabel[] {
  const cached = labelsCache.get(snapshot);
  if (cached?.fingerprint === snapshot.fingerprint) return cached.labels;
  const index = wordBlockIndex(snapshot);
  const seen = new Set<string>();
  const labels: WordSectionLabel[] = [];
  for (const entry of wordCaptureSections(snapshot).outline) {
    if (!wordTitledEntry(entry)) continue;
    const label = headingLabel(entry.title);
    const heading = index.get(entry.ref);
    if (!label || heading === undefined || seen.has(label.toLowerCase()))
      continue;
    seen.add(label.toLowerCase());
    labels.push({
      label,
      title: entry.title,
      heading,
      from: entry.from,
      to: entry.to,
      pattern: labelPattern(label),
    });
  }
  labelsCache.set(snapshot, { fingerprint: snapshot.fingerprint, labels });
  return labels;
}

const runsText = (runs: readonly WordPlanRun[] | undefined, text: string) =>
  runs?.length ? runs.map((run) => run.text).join("") : text;

function planBlockText(block: WordPlanBlock): string {
  if (block.type === "table")
    return block.rows
      .map((row) =>
        row.cells
          .map((cell) => (cell.blocks ?? []).map(planBlockText).join("\n"))
          .join("\t"),
      )
      .join("\n");
  return runsText(block.runs, block.text);
}

interface Text {
  text: string;
  heading: boolean;
}

const sourceText = (block: WordSourceBlock): Text => ({
  text: block.text,
  heading: block.type === "heading" || block.outlineLevel !== undefined,
});
const targetText = (block: WordPlanBlock): Text => ({
  text: planBlockText(block),
  heading: block.type === "heading",
});

function withoutReferences(
  text: string,
  labels: readonly WordSectionLabel[],
): string {
  let out = text;
  for (const { pattern } of labels) out = out.replace(pattern, " ");
  return out;
}

/** Numbers and amounts, without clause markers, a heading's own number or section references,
 * which the clause and reference checks cover. */
function numbers(
  { text, heading }: Text,
  labels: readonly WordSectionLabel[],
): string[] {
  let body = text.normalize("NFC");
  if (heading) body = body.replace(HEADING_LABEL, " ");
  body = body.replace(CLAUSE_MARKER, " ");
  return withoutReferences(body, labels).match(NUMBER) ?? [];
}

const clauseMarker = (text: string) =>
  CLAUSE_MARKER.exec(text.normalize("NFC").trim())?.[1];

type Bag = Map<string, number>;
const bag = (items: readonly string[]): Bag => {
  const out: Bag = new Map();
  for (const item of items) out.set(item, (out.get(item) ?? 0) + 1);
  return out;
};
/** `a` minus `b`, as a list with repeats. */
const minus = (a: Bag, b: Bag): string[] =>
  [...a].flatMap(([item, n]) =>
    Array<string>(Math.max(0, n - (b.get(item) ?? 0))).fill(item),
  );
/** Takes from `budget` what `items` uses of it. */
const take = (items: readonly string[], budget: Bag): string[] =>
  items.filter((item) => {
    const left = budget.get(item) ?? 0;
    if (!left) return false;
    budget.set(item, left - 1);
    return true;
  });

const list = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** "Line 3", "Lines 3–9", "Lines 3–9 and 12". */
function linesLabel(lines: readonly number[]): string {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const spans: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    spans.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  const shown = spans.length > 5 ? [...spans.slice(0, 5), "more"] : spans;
  return `${sorted.length > 1 ? "Lines" : "Line"} ${list(shown)}`;
}

/** The verb for a lines label: "Line 3 has", "Lines 3–9 have". */
const verb = (lines: readonly number[], one: string, many: string) =>
  new Set(lines).size > 1 ? many : one;

/** Positions of `a` and `b` outside their longest common subsequence. */
function unmatched(
  a: readonly string[],
  b: readonly string[],
): { lost: number[]; extra: number[] } {
  const table = a.map(() => new Array<number>(b.length + 1).fill(0));
  table.push(new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
  const lost: number[] = [];
  const extra: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (
      j >= b.length ||
      (i < a.length && table[i + 1][j] >= table[i][j + 1])
    )
      lost.push(i++);
    else extra.push(j++);
  }
  return { lost, extra };
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** One op of a part with what it replaced and what it writes, paired line by line when it writes
 * as many blocks as it replaces. */
interface WrittenOp {
  k: number;
  field: "text" | "insert";
  sources: number[];
  targets: { block: WordPlanBlock; line: number }[];
}
interface Pair {
  sources: number[];
  targets: { block: WordPlanBlock; line: number }[];
}

const pairs = (op: WrittenOp): Pair[] =>
  op.sources.length && op.sources.length === op.targets.length
    ? op.sources.map((source, i) => ({
        sources: [source],
        targets: [op.targets[i]],
      }))
    : [{ sources: op.sources, targets: op.targets }];

function writtenOps(
  r: number,
  ops: readonly WordPartOp[],
  assembly: Pick<WordPartsAssembly, "plan" | "entries">,
  index: ReadonlyMap<string, number>,
): WrittenOp[] {
  const out = new Map<number, WrittenOp>();
  assembly.plan.entries.forEach((entry, e) => {
    const origin = assembly.entries[e];
    if (origin.row !== r || !("op" in origin) || entry.kind === "keep") return;
    const op = ops[origin.op];
    out.set(origin.op, {
      k: origin.op,
      field: op.kind === "insert" ? "insert" : "text",
      sources:
        op.kind === "replace" ? op.refs.map((ref) => index.get(ref)!) : [],
      targets: entry.blocks.map((block, i) => ({
        block,
        line: origin.lines?.[i]?.line ?? 1,
      })),
    });
  });
  return [...out.values()].sort((a, b) => a.k - b.k);
}

const runLook = (runs: readonly WordPlanRun[] | undefined) =>
  (runs ?? [])
    .filter((run) => run.bold || run.italic)
    .map(
      (run) =>
        `${run.bold ? "b" : ""}${run.italic ? "i" : ""}:${norm(run.text)}`,
    )
    .join("|");

/** A written block that repeats its source word for word, in the same kind of block and look. */
function repeats(source: WordSourceBlock, target: WordPlanBlock): boolean {
  if (source.type === "native" || target.type === "table") return false;
  const kind = (type: string, level?: number) =>
    type === "heading" ? `heading${level ?? 1}` : type;
  return (
    kind(source.type, source.level) === kind(target.type, target.level) &&
    norm(source.text) === norm(planBlockText(target)) &&
    runLook(source.runs) === runLook(target.runs)
  );
}

const isParagraph = (block: WordSourceBlock) =>
  block.type === "paragraph" && !!block.text.trim();

export interface WordPartCheckInput {
  snapshot: WordAuthoringSnapshot;
  plan: WordPartsPlan;
  row: number;
  ops: readonly WordPartOp[];
  assembly: Pick<WordPartsAssembly, "plan" | "entries">;
  allow: ReadonlySet<WordPartAllow>;
}

/** The checks of one written row, with paths into its part. */
export function checkWordPart({
  snapshot,
  plan,
  row: r,
  ops,
  assembly,
  allow,
}: WordPartCheckInput): WordPartCheck {
  const index = wordBlockIndex(snapshot);
  const blocks = snapshot.blocks;
  const labels = wordSectionLabels(snapshot);
  const issues: WordPlanDiagnostics = [];
  const waived = new Set<WordPartAllow>();
  const issue = (path: string, code: string, message: string) => {
    if (issues.length < 16) issues.push({ path, code, message });
  };
  const fired = (code: WordPartAllow) => {
    if (!allow.has(code)) return true;
    waived.add(code);
    return false;
  };
  const written = writtenOps(r, ops, assembly, index);
  const at = (op: WrittenOp) => `/ops/${op.k}/${op.field}`;
  const refsOf = (positions: readonly number[]) =>
    wordPartRanges(
      positions.map((p) => blocks[p].ref),
      snapshot,
    );
  const rowName = wordPartRowName(r, "").toLowerCase();

  // Scope: what the row says it rewrites, it rewrites.
  const repeated = new Set<number>();
  for (const op of written) {
    const lines: number[] = [];
    const refs: number[] = [];
    for (const pair of pairs(op))
      for (const target of pair.targets) {
        const same = pair.sources.find((s) => repeats(blocks[s], target.block));
        if (same === undefined) continue;
        lines.push(target.line);
        refs.push(same);
        repeated.add(same);
      }
    if (lines.length)
      issue(
        at(op),
        "row-scope",
        `${linesLabel(lines)} ${verb(lines, "repeats", "repeat")} ${refsOf(refs)} word for word. Keep a block that stays as it is by reference with {"keep":…}, and rewrite the others as the row's change says.`,
      );
  }
  const changes = ops.some((op) => op.kind !== "keep");
  if (!changes)
    issue(
      "/ops",
      "row-scope",
      `This part keeps every block of ${rowName} as it is. Rewrite the blocks as the row's change says, or send the section plan again with ${rowName} as a keep row.`,
    );
  const paragraphs = plan.rows[r].refs
    .map((ref) => index.get(ref)!)
    .filter((p) => isParagraph(blocks[p]));
  const kept = ops
    .flatMap((op) => (op.kind === "keep" ? op.refs : []))
    .map((ref) => index.get(ref)!)
    .filter((p) => isParagraph(blocks[p]));
  const unchanged =
    kept.length + [...repeated].filter((p) => isParagraph(blocks[p])).length;
  if (
    changes &&
    paragraphs.length &&
    unchanged * 2 > paragraphs.length &&
    fired("kept-unchanged")
  )
    issue(
      "/ops",
      "kept-unchanged",
      `This part leaves ${unchanged} of the row's ${paragraphs.length} paragraphs unchanged${kept.length ? ` (kept: ${refsOf(kept)})` : ""}. Rewrite them as the row's change says, or, if they stay as they are on purpose, send the part again with allow: ["kept-unchanged"].`,
    );

  // Numbers and amounts, as a multiset over everything the part writes.
  const numbersOf = (pair: Pick<Pair, "sources" | "targets">) => ({
    before: pair.sources.flatMap((p) => numbers(sourceText(blocks[p]), labels)),
    after: pair.targets.flatMap((t) => numbers(targetText(t.block), labels)),
  });
  const all = written.map(numbersOf);
  const missing = bag(
    minus(bag(all.flatMap((n) => n.before)), bag(all.flatMap((n) => n.after))),
  );
  const added = bag(
    minus(bag(all.flatMap((n) => n.after)), bag(all.flatMap((n) => n.before))),
  );
  if ((missing.size || added.size) && fired("numbers"))
    for (const op of written) {
      const found: string[] = [];
      for (const pair of pairs(op)) {
        const { before, after } = numbersOf(pair);
        const gone = take(minus(bag(before), bag(after)), missing);
        const fresh = take(minus(bag(after), bag(before)), added);
        if (!gone.length && !fresh.length) continue;
        const lines = pair.targets.map((t) => t.line);
        const where = pair.sources.length ? refsOf(pair.sources) : "";
        const lead = `${found.length ? linesLabel(lines).toLowerCase() : linesLabel(lines)}`;
        found.push(
          gone.length && fresh.length
            ? `${lead} ${verb(lines, "has", "have")} ${list(fresh)} where ${where} has ${list(gone)}`
            : gone.length
              ? `${lead} ${verb(lines, "lacks", "lack")} ${list(gone)}, which ${where} has`
              : `${lead} ${verb(lines, "adds", "add")} ${list(fresh)}${where ? `, which ${where} does not have` : ""}`,
        );
      }
      if (found.length)
        issue(
          at(op),
          "numbers",
          `${found.slice(0, 4).join("; ")}. Keep every number and amount as the original writes it, or, if the change asks for other numbers, send the part again with allow: ["numbers"].`,
        );
    }

  // Clause numbering, where the replaced paragraphs have clause markers.
  for (const op of written) {
    const before = op.sources
      .map((p) => ({ p, marker: clauseMarker(blocks[p].text) }))
      .filter((m): m is { p: number; marker: string } => !!m.marker);
    if (!before.length) continue;
    const after = op.targets
      .map((t) => ({
        line: t.line,
        marker: clauseMarker(planBlockText(t.block)),
      }))
      .filter((m): m is { line: number; marker: string } => !!m.marker);
    if (
      before.map((m) => m.marker).join() === after.map((m) => m.marker).join()
    )
      continue;
    if (!fired("clause-numbering")) continue;
    const found: string[] = [];
    if (op.sources.length === op.targets.length)
      op.sources.forEach((p, i) => {
        const had = clauseMarker(blocks[p].text);
        const has = clauseMarker(planBlockText(op.targets[i].block));
        if (had === has) return;
        const line = `line ${op.targets[i].line}`;
        found.push(
          had && has
            ? `${line} has ${has} where ${blocks[p].ref} has ${had}`
            : had
              ? `${line} has no clause number where ${blocks[p].ref} has ${had}`
              : `${line} adds ${has}, which ${blocks[p].ref} does not have`,
        );
      });
    else {
      const { lost, extra } = unmatched(
        before.map((m) => m.marker),
        after.map((m) => m.marker),
      );
      if (lost.length)
        found.push(
          `the clause ${lost.length > 1 ? "numbers" : "number"} ${list(lost.map((k) => before[k].marker))} of ${refsOf(lost.map((k) => before[k].p))} ${lost.length > 1 ? "are" : "is"} missing`,
        );
      if (extra.length) {
        const lines = extra.map((k) => after[k].line);
        found.push(
          `${linesLabel(lines).toLowerCase()} ${verb(lines, "adds", "add")} ${list(extra.map((k) => after[k].marker))}`,
        );
      }
    }
    issue(
      at(op),
      "clause-numbering",
      `${capital(found.slice(0, 4).join("; "))}. Keep each paragraph's clause number as the original has it, or, if the change renumbers clauses on purpose, send the part again with allow: ["clause-numbering"].`,
    );
  }

  // The section plan's terms stay where the original has them.
  // A term counts where a word starts with it, so inflections and compounds keep it.
  const terms = plan.terms.map((term) => ({
    term,
    pattern: new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(term.normalize("NFC"))}`,
      "iu",
    ),
  }));
  if (terms.length)
    for (const op of written) {
      const lost = new Map<string, { lines: number[]; refs: number[] }>();
      for (const pair of pairs(op)) {
        const before = pair.sources
          .map((p) => blocks[p].text)
          .join("\n")
          .normalize("NFC");
        const after = pair.targets
          .map((t) => planBlockText(t.block))
          .join("\n")
          .normalize("NFC");
        for (const { term, pattern } of terms) {
          if (!pattern.test(before) || pattern.test(after)) continue;
          const entry = lost.get(term) ?? { lines: [], refs: [] };
          entry.lines.push(...pair.targets.map((t) => t.line));
          entry.refs.push(...pair.sources);
          lost.set(term, entry);
        }
      }
      if (!lost.size || !fired("term")) continue;
      issue(
        at(op),
        "term",
        `${[...lost]
          .slice(0, 4)
          .map(
            ([term, { lines, refs }], k) =>
              `${k ? linesLabel(lines).toLowerCase() : linesLabel(lines)} ${verb(lines, "drops", "drop")} ${term}, which ${refsOf(refs)} ${refs.length > 1 ? "have" : "has"}`,
          )
          .join(
            "; ",
          )}. Keep the section plan's terms as the document writes them, or, if the change renames a term on purpose, send the part again with allow: ["term"].`,
      );
    }
  return {
    issues,
    waived: WORD_PART_ALLOWS.filter((code) => waived.has(code)),
  };
}

/** `allow` of a part: the checks whose change is intended. */
export function parseWordPartAllow(
  value: unknown,
): { allow: Set<WordPartAllow> } | { message: string } {
  if (value === undefined) return { allow: new Set() };
  if (
    !Array.isArray(value) ||
    value.length > WORD_PART_ALLOWS.length ||
    !value.every((code) => WORD_PART_ALLOWS.includes(code as WordPartAllow))
  )
    return {
      message: `allow lists checks whose change is intended: ${list(WORD_PART_ALLOWS.map((code) => `"${code}"`))}. Use it only when a check's error says so.`,
    };
  return { allow: new Set(value as WordPartAllow[]) };
}

/** Block positions in the order the change writes them; those off the longest run in document
 * order are the ones it moves. */
function movedBlocks(order: readonly number[]): Set<number> {
  const tails: number[] = [];
  const tailAt: number[] = [];
  const previous = new Array<number>(order.length).fill(-1);
  order.forEach((value, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = value;
    tailAt[lo] = i;
    previous[i] = lo ? tailAt[lo - 1] : -1;
  });
  const inOrder = new Set<number>();
  for (let i = tailAt[tails.length - 1] ?? -1; i >= 0; i = previous[i])
    inOrder.add(order[i]);
  return new Set(order.filter((value) => !inOrder.has(value)));
}

interface WordChangeStructure {
  moved: Set<number>;
  deleted: Set<number>;
  /** Heading position → its new number, where the change renumbers it. */
  renamed: Map<number, string>;
}

function changeStructure(
  snapshot: WordAuthoringSnapshot,
  plan: WordPartsPlan,
  parts: ReadonlyMap<number, readonly WordPartOp[]>,
  assembly: Pick<WordPartsAssembly, "plan" | "entries">,
): WordChangeStructure {
  const index = wordBlockIndex(snapshot);
  const order = assembly.plan.entries.flatMap((entry) =>
    entry.kind === "insert" ? [] : entry.source.map((ref) => index.get(ref)!),
  );
  const deleted = new Set(
    assembly.plan.deleted.flatMap((d) =>
      d.source.map((ref) => index.get(ref)!),
    ),
  );
  const renamed = new Map<number, string>();
  const rename = (heading: number, text: string) => {
    const before = headingLabel(snapshot.blocks[heading].text);
    const after = headingLabel(text);
    if (before && after && before.toLowerCase() !== after.toLowerCase())
      renamed.set(heading, after);
  };
  plan.rows.forEach((row: WordPartRow, r) => {
    if (row.title) rename(index.get(row.refs[0])!, row.title);
    if (row.action !== "rewrite") return;
    for (const op of writtenOps(r, parts.get(r) ?? [], assembly, index))
      for (const pair of pairs(op))
        if (
          pair.sources.length === 1 &&
          pair.targets.length === 1 &&
          pair.targets[0].block.type === "heading"
        )
          rename(pair.sources[0], planBlockText(pair.targets[0].block));
  });
  return { moved: movedBlocks(order), deleted, renamed };
}

/** References a part's new text makes to sections the change moves, merges away or renumbers;
 * the finish names the row to send again. */
export function wordPartsReferenceIssues(
  snapshot: WordAuthoringSnapshot,
  plan: WordPartsPlan,
  parts: ReadonlyMap<number, readonly WordPartOp[]>,
  allow: ReadonlyMap<number, ReadonlySet<WordPartAllow>>,
  assembly: Pick<WordPartsAssembly, "plan" | "entries">,
  titleOf: (row: number) => string,
): { issues: WordPlanDiagnostics; waived: Map<number, WordPartAllow[]> } {
  const index = wordBlockIndex(snapshot);
  const labels = wordSectionLabels(snapshot);
  const structure = changeStructure(snapshot, plan, parts, assembly);
  const newLabels = new Set(
    [...structure.renamed.values()].map((label) => label.toLowerCase()),
  );
  const issues: WordPlanDiagnostics = [];
  const waived = new Map<number, WordPartAllow[]>();
  plan.rows.forEach((row, r) => {
    const ops = parts.get(r);
    if (row.action !== "rewrite" || !ops) return;
    const original = row.refs
      .map((ref) => snapshot.blocks[index.get(ref)!].text)
      .join("\n");
    const found: string[] = [];
    for (const op of writtenOps(r, ops, assembly, index))
      for (const { block, line } of op.targets) {
        if (block.type === "heading") continue;
        const text = planBlockText(block);
        for (const section of labels) {
          section.pattern.lastIndex = 0;
          if (!section.pattern.test(text)) continue;
          section.pattern.lastIndex = 0;
          const carried = section.pattern.test(original);
          section.pattern.lastIndex = 0;
          const renamedTo = structure.renamed.get(section.heading);
          let problem: string | undefined;
          if (renamedTo && !newLabels.has(section.label.toLowerCase()))
            problem = `refers to ${section.title}, which this change renumbers to ${renamedTo}; use ${renamedTo}`;
          else if (carried) continue;
          else if (structure.deleted.has(section.heading))
            problem = Array.from(
              { length: section.to - section.from },
              (_, k) => section.from + k,
            ).every((at) => structure.deleted.has(at))
              ? `refers to ${section.title}, which this change deletes; leave the reference out`
              : `refers to ${section.title}, whose heading this change deletes; refer to the section that now holds its text, or leave the reference out`;
          else if (structure.moved.has(section.heading)) {
            if (allow.get(r)?.has("cross-reference")) {
              waived.set(r, ["cross-reference"]);
              continue;
            }
            problem = `adds a reference to ${section.title}, which this change moves and the original row does not refer to; leave it out, or, if the request asks for it, send the row again with allow: ["cross-reference"]`;
          }
          if (!problem) continue;
          found.push(`/ops/${op.k}/${op.field} line ${line} ${problem}`);
        }
      }
    if (found.length && issues.length < 16)
      issues.push({
        path: "",
        code: "cross-reference",
        message: `${wordPartRowName(r, titleOf(r))}: at ${found.slice(0, 3).join("; at ")}. Send row ${r + 1} again with write_document_section.`,
      });
  });
  return { issues, waived };
}

/** Sections the request names by number or full title that the section plan leaves alone: one
 * fix request each, since a request may name a section only for context. */
export function wordPartsUncoveredSections(
  snapshot: WordAuthoringSnapshot,
  plan: WordPartsPlan,
  request: string | undefined,
): { entry: number; title: string }[] {
  if (!request?.trim()) return [];
  const index = wordBlockIndex(snapshot);
  const sections = wordCaptureSections(snapshot);
  const asked = norm(request).toLocaleLowerCase();
  const order = plan.rows.flatMap((row) =>
    row.refs.map((ref) => index.get(ref)!),
  );
  const moved = movedBlocks(order);
  const acted = new Set<number>();
  for (const row of plan.rows) {
    if (row.action !== "keep" || row.title)
      for (const ref of row.action === "keep" ? row.refs.slice(0, 1) : row.refs)
        acted.add(index.get(ref)!);
  }
  const out: { entry: number; title: string }[] = [];
  sections.outline.forEach((entry, e) => {
    if (!wordTitledEntry(entry)) return;
    const label = headingLabel(entry.title);
    const pattern = label ? labelPattern(label) : undefined;
    const name = norm(
      label ? entry.title.trim().replace(HEADING_LABEL, "") : entry.title,
    ).toLocaleLowerCase();
    const named =
      (pattern && pattern.test(request)) ||
      (name.split(" ").length >= 2 && asked.includes(name));
    if (!named) return;
    for (let at = entry.from; at < entry.to; at++)
      if (acted.has(at) || moved.has(at)) return;
    out.push({ entry: e, title: entry.title });
  });
  return out;
}

/** The finish checks every written row again on the final section plan, whose terms or rows may
 * have changed since, then the references across rows; a finding names the row to send again. */
export function wordPartsFinishIssues(
  snapshot: WordAuthoringSnapshot,
  draft: Pick<WordPartsDraft, "plan" | "parts" | "allow" | "waived">,
  assembly: Pick<WordPartsAssembly, "plan" | "entries">,
  titleOf: (row: number) => string,
): WordPlanDiagnostics {
  const issues: WordPlanDiagnostics = [];
  const waived = new Map<number, Set<WordPartAllow>>();
  draft.plan.rows.forEach((row, r) => {
    const ops = draft.parts.get(r);
    if (row.action !== "rewrite" || !ops) return;
    const checked = checkWordPart({
      snapshot,
      plan: draft.plan,
      row: r,
      ops,
      assembly,
      allow: draft.allow.get(r) ?? new Set(),
    });
    waived.set(r, new Set(checked.waived));
    for (const found of checked.issues)
      if (issues.length < 16)
        issues.push({
          path: "",
          code: found.code,
          message: `${wordPartRowName(r, titleOf(r))}, at ${found.path}: ${found.message} Send row ${r + 1} again with write_document_section.`,
        });
  });
  const references = wordPartsReferenceIssues(
    snapshot,
    draft.plan,
    draft.parts,
    draft.allow,
    assembly,
    titleOf,
  );
  for (const [r, codes] of references.waived)
    for (const code of codes) waived.get(r)?.add(code);
  for (const [r, codes] of waived)
    draft.waived.set(
      r,
      WORD_PART_ALLOWS.filter((code) => codes.has(code)),
    );
  return [...issues, ...references.issues].slice(0, 16);
}
