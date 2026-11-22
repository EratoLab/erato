import { WORD_PART_ALLOWS } from "./wordAuthoringContract";
import { wordBlockIndex, wordCaptureSections } from "./wordDocumentOutline";
import {
  assembleWordParts,
  wordConsecutiveRuns,
  wordPartRanges,
  wordPartRowFinding,
  wordPartRowName,
  wordUnwrittenRowsIssue,
} from "./wordDocumentParts";
import { wordMatchedPairs } from "./wordInPlaceSpanWriter";
import { wordTitledEntry } from "./wordPlanCoverage";
import { wordNamedParts } from "./wordPlanDocumentChanges";

import type {
  WordPartOp,
  WordPartsAssembly,
  WordPartsFinish,
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
 * language needs a word list; meaning is left to the review. A heading Word numbers itself has no
 * number in its text, so references to it are not checked.
 */

export type WordPartAllow = (typeof WORD_PART_ALLOWS)[number];

export interface WordPartCheck {
  issues: WordPlanDiagnostics;
  /** Checks that found a change the part allows. */
  waived: WordPartAllow[];
}

/** A finding on one written row, with the path into its part. */
export interface WordPartFinding {
  row: number;
  path: string;
  line?: number;
  code: string;
  message: string;
}

const NUMBER = /\p{N}+(?:[.,]\p{N}+)*/gu;
/** "(3)", "(a)", "(iv)", "3)", "a)" at the start, after at most a short lead-in such as
 * "Note: ". */
const CLAUSE_MARKER =
  /^(?:[^\s():]{1,24}(?: [^\s():]{1,24}){0,2}: )?(\((?:\p{N}{1,3}|\p{L}{1,4})\)|(?:\p{N}{1,3}|\p{L})\))(?=\s)/u;
/** A heading's own number: "§ 10", "10.1", "Article 5". A bare "3", which the outline takes for
 * "3. Title", is too common in text to tell a reference. */
const HEADING_LABEL =
  /^((?:[^\s\p{N}]{1,12} ?)?)(\p{N}+(?:\.\p{N}+)*)\.?(?=\s|$)/u;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const norm = (text: string) =>
  text.normalize("NFC").replace(/\s+/gu, " ").trim();
const count = (pattern: RegExp, text: string) =>
  text.match(pattern)?.length ?? 0;

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

const isHeading = (block: WordSourceBlock) =>
  block.type === "heading" || block.outlineLevel !== undefined;
const sourceText = (block: WordSourceBlock): Text => ({
  text: block.text,
  heading: isHeading(block),
});
const targetText = (block: WordPlanBlock): Text => ({
  text: planBlockText(block),
  heading: block.type === "heading",
});

/** Heading position → its new number, where a replace writes a heading again with another one: a
 * keep row's title or a rewritten heading line. */
function renamedHeadings(
  snapshot: WordAuthoringSnapshot,
  assembly: Pick<WordPartsAssembly, "plan">,
): Map<number, string> {
  const index = wordBlockIndex(snapshot);
  const renamed = new Map<number, string>();
  for (const entry of assembly.plan.entries) {
    if (entry.kind !== "replace" || entry.source.length !== entry.blocks.length)
      continue;
    entry.source.forEach((ref, k) => {
      const at = index.get(ref)!;
      const block = entry.blocks[k];
      if (block.type !== "heading" || !isHeading(snapshot.blocks[at])) return;
      const before = headingLabel(snapshot.blocks[at].text);
      const after = headingLabel(planBlockText(block));
      if (before && after && before.toLowerCase() !== after.toLowerCase())
        renamed.set(at, after);
    });
  }
  return renamed;
}

/** References by a section's old or new number, which the numbers check leaves to the
 * reference check. */
function referencePatterns(
  snapshot: WordAuthoringSnapshot,
  assembly: Pick<WordPartsAssembly, "plan">,
): RegExp[] {
  const labels = wordSectionLabels(snapshot);
  const known = new Set(labels.map(({ label }) => label.toLowerCase()));
  const renamed = [
    ...new Set(renamedHeadings(snapshot, assembly).values()),
  ].filter((label) => !known.has(label.toLowerCase()));
  return [
    ...labels.map(({ pattern }) => pattern),
    ...renamed.map(labelPattern),
  ];
}

/** Numbers and amounts, without clause markers, a heading's own number or section references,
 * which the clause and reference checks cover. */
function numbers({ text, heading }: Text, references: readonly RegExp[]) {
  let body = text.normalize("NFC").trimStart();
  if (heading) body = body.replace(HEADING_LABEL, " ");
  body = body.replace(CLAUSE_MARKER, " ");
  for (const pattern of references) body = body.replace(pattern, " ");
  return body.match(NUMBER) ?? [];
}

const clauseMarker = (text: string) =>
  CLAUSE_MARKER.exec(text.normalize("NFC").trim())?.[1];

type Bag = Map<string, number>;
const bag = (items: readonly string[]): Bag => {
  const out: Bag = new Map();
  for (const item of items) out.set(item, (out.get(item) ?? 0) + 1);
  return out;
};
/** `a` minus `b`, with repeats. */
const minus = (a: Bag, b: Bag): string[] =>
  [...a].flatMap(([item, n]) =>
    Array<string>(Math.max(0, n - (b.get(item) ?? 0))).fill(item),
  );
const take = (items: readonly string[], budget: Bag): string[] =>
  items.filter((item) => {
    const left = budget.get(item) ?? 0;
    if (!left) return false;
    budget.set(item, left - 1);
    return true;
  });

const list = (items: readonly string[]) => wordNamedParts(items, Infinity);

/** "Line 3", "Lines 3–9", "Lines 3–9 and 12". */
function linesLabel(lines: readonly number[]): string {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const spans = wordConsecutiveRuns(sorted).map(([from, to]) =>
    from === to ? `${from}` : `${from}–${to}`,
  );
  const shown = spans.length > 5 ? [...spans.slice(0, 5), "more"] : spans;
  return `${sorted.length > 1 ? "Lines" : "Line"} ${list(shown)}`;
}

/** The verb for a lines label: "Line 3 has", "Lines 3–9 have". */
const verb = (lines: readonly number[], one: string, many: string) =>
  new Set(lines).size > 1 ? many : one;

/** Positions of `a` and `b` outside their longest common subsequence. */
function unmatched(a: readonly string[], b: readonly string[]) {
  const pairs = wordMatchedPairs(a, b);
  const inA = new Set(pairs.map(([i]) => i));
  const inB = new Set(pairs.map(([, j]) => j));
  return {
    lost: a.flatMap((_, i) => (inA.has(i) ? [] : [i])),
    extra: b.flatMap((_, j) => (inB.has(j) ? [] : [j])),
  };
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

type Marks = { bold?: boolean; italic?: boolean };

/** Bold and italic spans as the read shows them: neighbouring runs with the same marks read as
 * one, and a paragraph without runs has the marks of its font. */
function look(
  text: string,
  runs: readonly WordPlanRun[] | undefined,
  font: Marks | undefined,
): string {
  const spans: { marks: string; text: string }[] = [];
  for (const run of runs?.length ? runs : [{ ...font, text }]) {
    const marks = `${run.bold ? "b" : ""}${run.italic ? "i" : ""}`;
    const last = spans.at(-1);
    if (last?.marks === marks) last.text += run.text;
    else spans.push({ marks, text: run.text });
  }
  return spans
    .filter((span) => span.marks && norm(span.text))
    .map((span) => `${span.marks}:${norm(span.text)}`)
    .join("|");
}

const kind = (block: { type: string; level?: number; ordered?: boolean }) =>
  block.type === "heading"
    ? `heading${block.level ?? 1}`
    : block.type === "list-item"
      ? `${block.ordered ? "numbered" : "bullet"}${block.level ?? 0}`
      : block.type;

/** A written block that repeats its source word for word, in the same kind of block and look. */
function repeats(source: WordSourceBlock, target: WordPlanBlock): boolean {
  if (source.type === "native" || target.type === "table") return false;
  const text = planBlockText(target);
  return (
    kind(source) === kind(target) &&
    norm(source.text) === norm(text) &&
    look(source.text, source.runs, source.format?.font) ===
      look(
        text,
        target.runs,
        (target as { format?: { font?: Marks } }).format?.font,
      )
  );
}

/** What a rewrite row's change is about: its paragraphs and list items, not headings or tables. */
const isBodyText = (block: WordSourceBlock) =>
  (block.type === "paragraph" || block.type === "list-item") &&
  !isHeading(block) &&
  !!block.text.trim();

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
  const references = referencePatterns(snapshot, assembly);
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
  const positions = (refs: readonly string[]) =>
    refs.map((ref) => index.get(ref)!);
  const refsOf = (at: readonly number[]) =>
    wordPartRanges(
      at.map((p) => blocks[p].ref),
      snapshot,
    );
  const rowName = wordPartRowName(r, "").toLowerCase();

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
  const body = positions(plan.rows[r].refs).filter((p) =>
    isBodyText(blocks[p]),
  );
  const kept = positions(
    ops.flatMap((op) => (op.kind === "keep" ? op.refs : [])),
  ).filter((p) => isBodyText(blocks[p]));
  const unchanged =
    kept.length + [...repeated].filter((p) => isBodyText(blocks[p])).length;
  if (
    changes &&
    body.length &&
    unchanged * 2 > body.length &&
    fired("kept-unchanged")
  )
    issue(
      "/ops",
      "kept-unchanged",
      `This part leaves ${unchanged} of the row's ${body.length} body paragraphs unchanged${kept.length ? ` (kept: ${refsOf(kept)})` : ""}. Rewrite them as the row's change says, or, if they stay as they are on purpose, send the part again with allow: ["kept-unchanged"].`,
    );

  // Numbers of blocks the part deletes may move into its new text, as in a merge.
  const numbersOf = (pair: Pick<Pair, "sources" | "targets">) => ({
    before: pair.sources.flatMap((p) =>
      numbers(sourceText(blocks[p]), references),
    ),
    after: pair.targets.flatMap((t) =>
      numbers(targetText(t.block), references),
    ),
  });
  const all = written.map(numbersOf);
  const deleted = bag(
    positions(
      ops.flatMap((op) => (op.kind === "delete" ? op.refs : [])),
    ).flatMap((p) => numbers(sourceText(blocks[p]), references)),
  );
  const missing = bag(
    minus(bag(all.flatMap((n) => n.before)), bag(all.flatMap((n) => n.after))),
  );
  const added = bag(
    minus(
      bag(
        minus(
          bag(all.flatMap((n) => n.after)),
          bag(all.flatMap((n) => n.before)),
        ),
      ),
      deleted,
    ),
  );
  if ((missing.size || added.size) && fired("numbers"))
    for (const op of written) {
      const found: string[] = [];
      let changed = 0;
      for (const pair of pairs(op)) {
        const { before, after } = numbersOf(pair);
        const gone = take(minus(bag(before), bag(after)), missing);
        const fresh = take(minus(bag(after), bag(before)), added);
        if (!gone.length && !fresh.length) continue;
        changed += Math.max(gone.length, fresh.length);
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
          `${found.slice(0, 4).join("; ")}. Keep every number and amount as the original writes it. If changing ${changed > 1 ? "these numbers" : "this number"} is intended, send the part again with allow: ["numbers"].`,
        );
    }

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
      `${capital(found.slice(0, 4).join("; "))}. Keep each paragraph's clause number as the original has it. If changing the clause numbering is intended, send the part again with allow: ["clause-numbering"].`,
    );
  }

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
          )}. Keep the section plan's terms as the document writes them. If changing ${lost.size > 1 ? "these terms" : "this term"} is intended, send the part again with allow: ["term"].`,
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

/** Each block's outermost titled section, or -1 outside them. */
function topSections(snapshot: WordAuthoringSnapshot): Int32Array {
  const { outline } = wordCaptureSections(snapshot);
  const top = new Int32Array(snapshot.blocks.length).fill(-1);
  [...outline.keys()]
    .filter((k) => wordTitledEntry(outline[k]))
    .sort((a, b) => outline[b].level - outline[a].level)
    .forEach((k) => top.fill(k, outline[k].from, outline[k].to));
  return top;
}

/** For each value, the length of the longest increasing run that ends with it. */
function runsEnding(values: readonly number[]): number[] {
  const tails: number[] = [];
  return values.map((value) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = value;
    return lo + 1;
  });
}

/**
 * The blocks of sections whose place the change alters, from block positions in the order it
 * writes them. The units are runs of one top-level section, counted alike whatever their size. A
 * unit moved when some shortest way to the new order moves it and its rank among the units
 * changed: in a swap both sides count, but not a section between them, nor the sections one moved
 * section passes.
 */
function movedBlocks(order: readonly number[], top: Int32Array): Set<number> {
  const rank = new Map(
    [...order].sort((a, b) => a - b).map((p, k) => [p, k] as const),
  );
  const units: { start: number; blocks: number[] }[] = [];
  order.forEach((p, i) => {
    const last = units.at(-1);
    const previous = order[i - 1];
    if (
      last &&
      rank.get(p) === rank.get(previous)! + 1 &&
      top[p] === top[previous]
    )
      last.blocks.push(p);
    else units.push({ start: rank.get(p)!, blocks: [p] });
  });
  const starts = units.map((unit) => unit.start);
  const ending = runsEnding(starts);
  const starting = runsEnding(starts.map((v) => -v).reverse()).reverse();
  const best = Math.max(0, ...ending);
  const onSome = (i: number) => ending[i] + starting[i] - 1 === best;
  const atLength = new Map<number, number>();
  starts.forEach((_, i) => {
    if (onSome(i)) atLength.set(ending[i], (atLength.get(ending[i]) ?? 0) + 1);
  });
  const byPlace = [...starts].sort((a, b) => a - b);
  const moved = new Set<number>();
  units.forEach((unit, i) => {
    const onEvery = onSome(i) && atLength.get(ending[i]) === 1;
    if (!onEvery && byPlace[i] !== unit.start)
      for (const p of unit.blocks) moved.add(p);
  });
  return moved;
}

interface WordChangeStructure {
  moved: Set<number>;
  deleted: Set<number>;
  /** Heading position → its new number, where the change renumbers it. */
  renamed: Map<number, string>;
}

function changeStructure(
  snapshot: WordAuthoringSnapshot,
  assembly: Pick<WordPartsAssembly, "plan">,
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
  return {
    moved: movedBlocks(order, topSections(snapshot)),
    deleted,
    renamed: renamedHeadings(snapshot, assembly),
  };
}

/** References a part's new text makes to sections the change deletes, merges away, moves or
 * renumbers; the finish names the row to send again. */
export function wordPartsReferenceIssues(
  snapshot: WordAuthoringSnapshot,
  plan: WordPartsPlan,
  parts: ReadonlyMap<number, readonly WordPartOp[]>,
  allow: ReadonlyMap<number, ReadonlySet<WordPartAllow>>,
  assembly: Pick<WordPartsAssembly, "plan" | "entries">,
): { issues: WordPartFinding[]; waived: Map<number, WordPartAllow[]> } {
  const index = wordBlockIndex(snapshot);
  const labels = wordSectionLabels(snapshot);
  const { moved, deleted, renamed } = changeStructure(snapshot, assembly);
  const byLabel = new Map(labels.map((s) => [s.label.toLowerCase(), s]));
  const byHeading = new Map(labels.map((s) => [s.heading, s]));
  const takenBy = new Map<string, WordSectionLabel>();
  for (const [heading, label] of renamed) {
    const section = byHeading.get(heading);
    if (section) takenBy.set(label.toLowerCase(), section);
  }
  const keys = [
    ...labels.map(({ label, pattern }) => ({
      key: label.toLowerCase(),
      pattern,
    })),
    ...[...new Set(renamed.values())]
      .filter((label) => !byLabel.has(label.toLowerCase()))
      .map((label) => ({
        key: label.toLowerCase(),
        pattern: labelPattern(label),
      })),
  ];
  const gone = (section: WordSectionLabel) =>
    renamed.has(section.heading) || deleted.has(section.heading);
  const textOf = (p: number) => snapshot.blocks[p].text;
  const issues: WordPartFinding[] = [];
  const waived = new Map<number, WordPartAllow[]>();
  plan.rows.forEach((row, r) => {
    const ops = parts.get(r);
    if (row.action !== "rewrite" || !ops) return;
    const original = row.refs.map((ref) => textOf(index.get(ref)!)).join("\n");
    const replaced = ops
      .flatMap((op) =>
        op.kind === "keep" || op.kind === "insert" ? [] : op.refs,
      )
      .map((ref) => index.get(ref)!)
      .filter((p) => !isHeading(snapshot.blocks[p]))
      .map(textOf)
      .join("\n");
    const targets = writtenOps(r, ops, assembly, index).flatMap((op) =>
      op.targets
        .filter(({ block }) => block.type !== "heading")
        .map(({ block, line }) => ({ op, line, text: planBlockText(block) })),
    );
    const written = targets.map(({ text }) => text).join("\n");
    // A number that another section now has still means its old section as often as the replaced
    // text used it, unless the new text writes the old section's new number or drops uses of the
    // other section's old one instead.
    const stale = new Map<string, number>();
    for (const { key, pattern } of keys) {
      const old = byLabel.get(key);
      const owner = takenBy.get(key);
      if (!old || !owner || !gone(old)) continue;
      const before = count(pattern, replaced);
      const to = renamed.get(old.heading);
      const oldUpdated =
        to !== undefined && count(labelPattern(to), written) >= before;
      const ownerUpdated =
        count(owner.pattern, written) < count(owner.pattern, replaced);
      if (before && !oldUpdated && !ownerUpdated) stale.set(key, before);
    }
    const found: WordPartFinding[] = [];
    const check = (
      op: WrittenOp,
      line: number,
      section: WordSectionLabel,
      byOldNumber: boolean,
    ) => {
      const finding = (message: string) => {
        found.push({
          row: r,
          path: `/ops/${op.k}/${op.field}`,
          line,
          code: "cross-reference",
          message,
        });
      };
      const to = renamed.get(section.heading);
      if (byOldNumber && to)
        return finding(
          `Refers to ${section.title}, which this change renumbers to ${to}; use ${to}.`,
        );
      if (deleted.has(section.heading))
        return finding(
          Array.from(
            { length: section.to - section.from },
            (_, k) => section.from + k,
          ).every((at) => deleted.has(at))
            ? `Refers to ${section.title}, which this change deletes; leave the reference out.`
            : `Refers to ${section.title}, whose heading this change deletes; refer to the section that now holds its text, or leave the reference out.`,
        );
      if (!moved.has(section.heading) || count(section.pattern, original))
        return;
      if (allow.get(r)?.has("cross-reference")) {
        waived.set(r, ["cross-reference"]);
        return;
      }
      finding(
        `Adds a reference to ${section.title}, which this change moves and the original row does not refer to; leave it out, or, if the request asks for it, send the row again with allow: ["cross-reference"].`,
      );
    };
    for (const { op, line, text } of targets)
      for (const { key, pattern } of keys) {
        const uses = count(pattern, text);
        if (!uses) continue;
        const old = byLabel.get(key);
        const owner = takenBy.get(key);
        let toOld = old ? uses : 0;
        if (old && owner && gone(old)) {
          toOld = Math.min(uses, stale.get(key) ?? 0);
          stale.set(key, (stale.get(key) ?? 0) - toOld);
        }
        if (toOld) check(op, line, old!, true);
        if (uses > toOld && owner && owner !== old)
          check(op, line, owner, false);
      }
    issues.push(...found.slice(0, 4));
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
  const order = plan.rows
    .filter((row) => row.action !== "delete")
    .flatMap((row) => row.refs.map((ref) => index.get(ref)!));
  const moved = movedBlocks(order, topSections(snapshot));
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
      (pattern && count(pattern, request) > 0) ||
      (name.split(" ").length >= 2 && asked.includes(name));
    if (!named) return;
    for (let at = entry.from; at < entry.to; at++)
      if (acted.has(at) || moved.has(at)) return;
    out.push({ entry: e, title: entry.title });
  });
  return out;
}

export interface WordPartsFinishChecked {
  /** The refusal's diagnostics; none when the finish goes on. */
  issues: WordPlanDiagnostics;
  /** Records what the refusal names, once it is returned. */
  refused: () => void;
  /** Written rows the change leaves unchanged, since a finish named their findings before. */
  leftOut: number[];
  /** What the finish stages and the pipeline checks. */
  assembly: WordPartsAssembly;
}

/**
 * The finish checks every written row again on the final section plan, whose terms or rows may
 * have changed since, then the references across rows. Its findings and the rows without a part
 * are refused once; a finish that would name only what an earlier one named leaves those rows
 * unchanged, so a row that has used its tries never costs the whole change.
 */
export function wordPartsFinishChecks(
  snapshot: WordAuthoringSnapshot,
  {
    draft,
    assembly,
    unwritten,
  }: Pick<
    Extract<WordPartsFinish, { ok: true }>,
    "draft" | "assembly" | "unwritten"
  >,
  titleOf: (row: number) => string,
): WordPartsFinishChecked {
  const findings = new Map<number, Omit<WordPartFinding, "row">[]>();
  const add = (r: number, found: Omit<WordPartFinding, "row">) =>
    findings.set(r, [...(findings.get(r) ?? []), found]);
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
    for (const found of checked.issues) add(r, found);
  });
  const references = wordPartsReferenceIssues(
    snapshot,
    draft.plan,
    draft.parts,
    draft.allow,
    assembly,
  );
  for (const { row, ...found } of references.issues) add(row, found);
  for (const [r, codes] of references.waived)
    for (const code of codes) waived.get(r)?.add(code);
  for (const [r, codes] of waived)
    draft.waived.set(
      r,
      WORD_PART_ALLOWS.filter((code) => codes.has(code)),
    );

  const blocksOf = (r: number) => draft.plan.rows[r].refs.join();
  const refused = [...findings.keys()].sort((a, b) => a - b);
  const { named } = draft;
  if (
    unwritten.every((r) => named.unwritten.has(blocksOf(r))) &&
    refused.every((r) => named.parts.has(draft.parts.get(r)!))
  ) {
    if (!refused.length)
      return { issues: [], refused: () => {}, leftOut: [], assembly };
    const parts = new Map(draft.parts);
    for (const r of refused) parts.delete(r);
    return {
      issues: [],
      refused: () => {},
      leftOut: refused,
      assembly: assembleWordParts(snapshot, draft.readToken, draft.plan, parts),
    };
  }
  return {
    refused: () => {
      for (const r of unwritten) named.unwritten.add(blocksOf(r));
      for (const r of refused) named.parts.add(draft.parts.get(r)!);
    },
    issues: [
      ...(unwritten.length
        ? [wordUnwrittenRowsIssue(draft, unwritten, snapshot)]
        : []),
      ...refused.flatMap((r) =>
        findings.get(r)!.map(({ path, line, code, message }) => ({
          path: "",
          code,
          message: wordPartRowFinding(
            r,
            titleOf(r),
            { path, line },
            message,
            `Send row ${r + 1} again with write_document_section, or finish again at revision ${draft.revision} to leave it unchanged; the card then says so.`,
          ),
        })),
      ),
    ].slice(0, 16),
    leftOut: [],
    assembly,
  };
}
