import {
  WORDPROCESSING_NS as W,
  readWordRunFormatting,
} from "./wordBlockFormatting";
import { isBuiltInHeadingStyle } from "./wordBuiltInStyles";
import { wordPlanOutput } from "./wordDocumentPlan";
import { wordBlockParagraphs } from "./wordLiveParagraphs";
import { wordTableCellTextEditIssue } from "./wordTableCellText";

import type { WordRunFormatting } from "./wordBlockFormatting";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
  WordPlanRun,
  WordSourceBlock,
} from "./wordDocumentPlan";
import type { WordInPlaceCapabilities } from "./wordInPlaceCapabilities";
import type { WordTableCellTextEdit } from "./wordTableCellText";

/** Routing ladder: when several rules fail, the earliest code is reported. */
export const WORD_IN_PLACE_FALLBACKS = [
  "stories",
  "sections",
  "moved",
  "insert",
  "delete",
  "split",
  "restyle",
  "list",
  "story-text",
  "native-target",
  "rich-block",
  "new-list",
  "format",
  "run-format",
  "source-shape",
  "empty-text",
  "inherited-format",
  "not-invertible",
  "too-many-ops",
  "program-mismatch",
] as const;
export type WordInPlaceFallback = (typeof WORD_IN_PLACE_FALLBACKS)[number];

export const MAX_WORD_IN_PLACE_OPS = 50;

export interface WordInPlaceMarks {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}
export interface WordInPlaceRun extends WordInPlaceMarks {
  text: string;
}
export type WordInPlaceOp =
  | {
      kind: "text";
      ref: string;
      /** Index among the paragraphs of the block. */
      paragraph: number;
      runs: WordInPlaceRun[];
      original: WordInPlaceRun[];
    }
  | {
      kind: "cell";
      ref: string;
      paragraph: number;
      rowIndex: number;
      cellIndex: number;
      text: string;
      original: string;
    };
export type WordInPlaceClassification =
  | { ops: WordInPlaceOp[] }
  | { fallback: WordInPlaceFallback };

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XMLNS = "http://www.w3.org/2000/xmlns/";
const RSIDS = new Set(["rsidR", "rsidRPr", "rsidDel", "rsidRDefault"]);
const MARK_ELEMENTS = new Set(["b", "bCs", "i", "iCs", "u"]);
const TYPED = new Set(["paragraph", "heading", "list-item"]);
/** insertText turns these into new paragraphs or breaks instead of text. */
const STRUCTURAL_TEXT = /[\n\r\v\f\u2028\u2029]/u;

const isW = (e: Element, name: string) =>
  e.namespaceURI === W && e.localName === name;
const children = (e: Element, name?: string) =>
  Array.from(e.children).filter((c) => !name || isW(c, name));
const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, "application/xml").documentElement;

export function stableJson(value: unknown): string {
  return (
    JSON.stringify(value, (_key, v: unknown) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([, entry]) => entry !== undefined)
              .sort(([a], [b]) => a.localeCompare(b)),
          )
        : v,
    ) ?? ""
  );
}

/** An empty format object and no format are the same paragraph. */
const sameFormat = (a: object | undefined, b: object | undefined) =>
  stableJson(a && Object.keys(a).length ? a : undefined) ===
  stableJson(b && Object.keys(b).length ? b : undefined);

/** Adjacent runs with the same marks are one span; Word may split or join them freely. */
export function mergeWordInPlaceRuns(
  runs: readonly WordInPlaceRun[],
): WordInPlaceRun[] {
  const merged: WordInPlaceRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const previous = merged.at(-1);
    if (
      previous &&
      previous.bold === run.bold &&
      previous.italic === run.italic &&
      previous.underline === run.underline
    )
      previous.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}

/** Marks as the import would write them: run values over the paragraph's default font. */
export function wordPlanBlockRuns(block: {
  text: string;
  runs?: WordPlanRun[];
  format?: { font?: WordRunFormatting };
}): WordInPlaceRun[] {
  const font = block.format?.font ?? {};
  return mergeWordInPlaceRuns(
    (block.runs ?? [{ text: block.text }]).map((run) => {
      const effective = { ...font, ...run };
      return {
        text: run.text,
        bold: effective.bold === true,
        italic: effective.italic === true,
        underline: effective.underline === true,
      };
    }),
  );
}

/** Run properties other than b/i/u, as the typed reader sees them. */
export function wordNonMarkRunProperties(
  run: WordRunFormatting & { text?: string },
): string {
  const rest: Record<string, unknown> = { ...run };
  for (const key of ["text", "bold", "italic", "underline"]) delete rest[key];
  return stableJson(rest);
}

export function wordHeadingStyleId(
  snapshot: Pick<WordAuthoringSnapshot, "styles">,
  level: number,
): string {
  return (
    snapshot.styles.find(
      (style) =>
        style.type === "paragraph" &&
        isBuiltInHeadingStyle(style.id, style.name, level),
    )?.id ?? `Heading${level}`
  );
}

/** The compiler writes "Normal" for an omitted paragraph style. */
export const effectiveWordStyle = (styleRef: string | undefined) =>
  styleRef ?? "Normal";

const on = (e: Element | undefined) =>
  !!e && !["0", "false", "off"].includes(e.getAttributeNS(W, "val") ?? "");
const onlyAttributes = (e: Element, allowed: (a: Attr) => boolean) =>
  Array.from(e.attributes).every((a) => a.namespaceURI === XMLNS || allowed(a));
const rsid = (a: Attr) => a.namespaceURI === W && RSIDS.has(a.localName);

/** Whether the run text keeps its outer whitespace (xml:space="preserve" on it or an ancestor). */
function keepsWhitespace(t: Element): boolean {
  for (let e: Element | null = t; e; e = e.parentElement) {
    const space = e.getAttributeNS(XML_NS, "space");
    if (space) return space === "preserve";
  }
  return false;
}

/** What insertText and the b/i/u font setters write, so an inverse write reproduces it exactly. */
type SourceRuns =
  | { runs: WordInPlaceRun[]; nonMark: string }
  | { fallback: "source-shape" | "not-invertible" };

export function wordInPlaceSourceRuns(paragraph: Element): SourceRuns {
  if (
    !isW(paragraph, "p") ||
    children(paragraph).some(
      (c) => !["pPr", "r", "proofErr"].some((name) => isW(c, name)),
    )
  )
    return { fallback: "source-shape" };
  const runs: WordInPlaceRun[] = [];
  let base: string | undefined;
  let nonMark = "{}";
  let canonical = true;
  const serializer = new XMLSerializer();
  for (const run of children(paragraph, "r")) {
    if (!onlyAttributes(run, rsid)) return { fallback: "source-shape" };
    const parts = children(run);
    const props = parts.filter((c) => isW(c, "rPr"));
    const texts = parts.filter((c) => isW(c, "t"));
    if (props.length > 1 || props.length + texts.length !== parts.length)
      return { fallback: "source-shape" };
    if (props[0] && parts[0] !== props[0]) return { fallback: "source-shape" };
    let text = "";
    for (const t of texts) {
      if (
        t.children.length ||
        !onlyAttributes(
          t,
          (a) => a.namespaceURI === XML_NS && a.localName === "space",
        )
      )
        return { fallback: "source-shape" };
      const value = t.textContent ?? "";
      if (!keepsWhitespace(t) && value !== value.trim())
        return { fallback: "source-shape" };
      text += value;
    }
    const rPr = props[0];
    // An empty run without properties leaves no trace in the paragraph's signature.
    if (!text) {
      if (rPr?.children.length) return { fallback: "source-shape" };
      continue;
    }
    if (rPr && !onlyAttributes(rPr, rsid)) return { fallback: "source-shape" };
    const marks = (name: string) =>
      rPr ? children(rPr).filter((c) => isW(c, name)) : [];
    const rest = rPr
      ? children(rPr).filter(
          (c) => c.namespaceURI !== W || !MARK_ELEMENTS.has(c.localName),
        )
      : [];
    const restXml = rest.map((c) => serializer.serializeToString(c)).join("");
    if (base === undefined) {
      base = restXml;
      const typed = rPr ? readWordRunFormatting(rPr) : {};
      if (typed.underlineStyle) return { fallback: "source-shape" };
      nonMark = wordNonMarkRunProperties(typed);
    } else if (base !== restXml) return { fallback: "source-shape" };
    const [b, bCs, i, iCs, u] = ["b", "bCs", "i", "iCs", "u"].map(marks);
    if ([b, bCs, i, iCs, u].some((list) => list.length > 1))
      return { fallback: "source-shape" };
    // The b/i font setters write the complex-script twin as well.
    const pair = (main: Element[], complex: Element[]) =>
      main.length === complex.length &&
      [...main, ...complex].every(
        (e) =>
          on(e) &&
          onlyAttributes(
            e,
            (a) => a.namespaceURI === W && a.localName === "val",
          ),
      );
    const underline = u[0];
    if (
      !pair(b, bCs) ||
      !pair(i, iCs) ||
      (underline &&
        (underline.getAttributeNS(W, "val") !== "single" ||
          !onlyAttributes(
            underline,
            (a) => a.namespaceURI === W && a.localName === "val",
          )))
    )
      canonical = false;
    runs.push({
      text,
      bold: b.length > 0 && on(b[0]),
      italic: i.length > 0 && on(i[0]),
      underline: !!underline && underline.getAttributeNS(W, "val") !== "none",
    });
  }
  if (!canonical) return { fallback: "not-invertible" };
  return { runs: mergeWordInPlaceRuns(runs), nonMark };
}

function sameStyle(
  source: WordSourceBlock,
  block: WordPlanBlock,
  snapshot: WordAuthoringSnapshot,
): boolean {
  if (source.type === "heading")
    return (
      block.styleRef === undefined &&
      source.styleRef === wordHeadingStyleId(snapshot, source.level ?? 1)
    );
  return (
    effectiveWordStyle(block.styleRef) === effectiveWordStyle(source.styleRef)
  );
}

type OpResult = WordInPlaceOp | WordInPlaceFallback;

function textOp(
  source: WordSourceBlock,
  block: WordPlanBlock,
  snapshot: WordAuthoringSnapshot,
): OpResult {
  if (!TYPED.has(block.type)) return "rich-block";
  if (block.type !== source.type) return "restyle";
  if (block.type === "heading" && (block.level ?? 1) !== source.level)
    return "restyle";
  if (block.type === "list-item") {
    if (
      !block.list?.startsWith("existing-") ||
      !!block.ordered !== !!source.ordered
    )
      return "new-list";
    if (
      block.list !== source.list ||
      (block.level ?? 0) !== (source.level ?? 0)
    )
      return "list";
  }
  if (!sameStyle(source, block, snapshot)) return "restyle";
  const format = "format" in block ? block.format : undefined;
  if (!sameFormat(format, source.format)) return "format";
  const shape = wordInPlaceSourceRuns(parse(source.xml));
  const font = format?.font ?? {};
  const targetRuns = block.runs ?? [{ text: block.text }];
  if (
    font.underlineStyle ||
    targetRuns.some((run) => run.underlineStyle) ||
    ("runs" in shape &&
      targetRuns.some(
        (run) =>
          wordNonMarkRunProperties({ ...font, ...run }) !== shape.nonMark,
      ))
  )
    return "run-format";
  if ("fallback" in shape && shape.fallback === "source-shape")
    return "source-shape";
  if ([block, ...targetRuns].some((run) => STRUCTURAL_TEXT.test(run.text)))
    return "source-shape";
  if (!block.text || !source.text) return "empty-text";
  if ("fallback" in shape) return shape.fallback;
  return {
    kind: "text",
    ref: source.ref,
    paragraph: 0,
    runs: wordPlanBlockRuns({ ...block, format }),
    original: shape.runs,
  };
}

const keysWithin = (value: object, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

/** Exactly the canonical plan expandWordTableCellSubmission builds: every row and cell kept by its
 * original index, one plain-text cell edit, nothing else. */
function cellOp(source: WordSourceBlock, block: WordPlanBlock): OpResult {
  if (source.nativeKind !== "table" || block.type !== "table")
    return "native-target";
  const content = source.content;
  const root = parse(source.xml);
  const tables = isW(root, "tbl") ? [root] : children(root, "tbl");
  const table = tables[0];
  if (
    !keysWithin(block, ["id", "type", "text", "sourceRef", "rows"]) ||
    !block.sourceRef ||
    !(
      block.sourceRef === source.ref ||
      source.objects?.some(
        (o) => o.kind === "table" && o.ref === block.sourceRef,
      )
    ) ||
    !content?.sourcePatchSupported ||
    !table ||
    (root !== table && children(root).length !== 1) ||
    table.getElementsByTagNameNS(W, "tbl").length ||
    content.rows.length !== block.rows.length ||
    content.rows.some((r) =>
      r.cells.some((c) => (c.colSpan ?? 1) !== 1 || (c.rowSpan ?? 1) !== 1),
    )
  )
    return "native-target";
  const edits: { row: number; cell: number; edit: WordTableCellTextEdit }[] =
    [];
  for (const [r, row] of block.rows.entries()) {
    const sourceRow = content.rows[r];
    if (
      !keysWithin(row, ["sourceIndex", "cells"]) ||
      row.sourceIndex !== sourceRow.sourceIndex ||
      row.cells.length !== sourceRow.cells.length
    )
      return "native-target";
    for (const [c, cell] of row.cells.entries()) {
      if (
        !keysWithin(cell, ["sourceIndex", "textEdit"]) ||
        cell.sourceIndex !== sourceRow.cells[c].sourceIndex
      )
        return "native-target";
      if (cell.textEdit)
        edits.push({
          row: row.sourceIndex,
          cell: cell.sourceIndex,
          edit: cell.textEdit,
        });
    }
  }
  if (edits.length !== 1) return "native-target";
  const [{ row, cell, edit }] = edits;
  const tr = children(table, "tr")[row];
  const tc = tr && children(tr, "tc")[cell];
  if (!tc || wordTableCellTextEditIssue(tc, edit)) return "native-target";
  const paragraph = children(tc, "p")[0];
  if (
    Array.from(paragraph.getElementsByTagNameNS(W, "t")).some(
      (t) =>
        !keepsWhitespace(t) &&
        (t.textContent ?? "") !== (t.textContent ?? "").trim(),
    )
  )
    return "source-shape";
  if (!edit.text || !edit.expectedText) return "empty-text";
  return {
    kind: "cell",
    ref: source.ref,
    paragraph: wordBlockParagraphs(
      isW(root, "body") ? children(root) : [root],
      root,
    ).indexOf(paragraph),
    rowIndex: row,
    cellIndex: cell,
    text: edit.text,
    original: edit.expectedText,
  };
}

const ladder = (codes: ReadonlySet<WordInPlaceFallback>) =>
  WORD_IN_PLACE_FALLBACKS.find((code) => codes.has(code));

/**
 * Pure: derives the object-model program for a validated, normalized plan, or the first routing
 * rule that sends it to the full-document import. No host calls.
 */
export function classifyWordInPlacePlan(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  caps: WordInPlaceCapabilities,
  compiled?: WordAuthoringSnapshot,
): WordInPlaceClassification {
  const failures = new Set<WordInPlaceFallback>();
  if (plan.stories?.length) failures.add("stories");
  if (plan.sections) failures.add("sections");
  const order = new Map(snapshot.blocks.map((b, i) => [b.ref, i]));
  const sources = new Map(snapshot.blocks.map((b) => [b.ref, b]));
  let last = -1;
  for (const entry of plan.entries)
    for (const ref of entry.kind === "insert" ? [] : entry.source) {
      const position = order.get(ref) ?? -1;
      if (position <= last) failures.add("moved");
      last = Math.max(last, position);
    }
  if (plan.deleted.length) failures.add("delete");
  const ops: WordInPlaceOp[] = [];
  for (const entry of plan.entries) {
    if (entry.kind === "insert") failures.add("insert");
    if (entry.kind !== "replace") continue;
    if (entry.source.length !== 1 || entry.blocks.length !== 1) {
      failures.add("split");
      continue;
    }
    const source = sources.get(entry.source[0]);
    if (!source) {
      failures.add("program-mismatch");
      continue;
    }
    const result =
      source.type === "native"
        ? cellOp(source, entry.blocks[0])
        : textOp(source, entry.blocks[0], snapshot);
    if (typeof result === "string") failures.add(result);
    else if (!caps[result.kind]) failures.add("not-invertible");
    else ops.push(result);
  }
  if (ops.length > MAX_WORD_IN_PLACE_OPS) failures.add("too-many-ops");
  const first = ladder(failures);
  if (first) return { fallback: first };
  if (
    !sameWordInPlaceProgram(plan, snapshot, ops) ||
    (compiled && !matchesCompiledOutput(snapshot, ops, compiled))
  )
    return { fallback: "program-mismatch" };
  return { ops };
}

/** The ops, applied to the captured blocks, must produce exactly the plan's output. */
export function sameWordInPlaceProgram(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  ops: readonly WordInPlaceOp[],
): boolean {
  const byRef = new Map(ops.map((op) => [op.ref, op]));
  if (byRef.size !== ops.length) return false;
  const output = wordPlanOutput(plan, snapshot);
  if (output.length !== snapshot.blocks.length) return false;
  let used = 0;
  const ok = snapshot.blocks.every((source, i) => {
    const entry = output[i];
    const op = byRef.get(source.ref);
    if (entry.source.length !== 1 || entry.source[0] !== source.ref)
      return false;
    if (entry.kind === "keep") return !op;
    if (entry.kind !== "replace" || !op) return false;
    used++;
    const block = entry.block as WordPlanBlock;
    if (op.kind === "cell") {
      if (block.type !== "table") return false;
      const edits = block.rows.flatMap((row) =>
        row.cells.flatMap((cell) =>
          cell.textEdit
            ? [
                {
                  row: row.sourceIndex,
                  cell: cell.sourceIndex,
                  ...cell.textEdit,
                },
              ]
            : [],
        ),
      );
      return (
        edits.length === 1 &&
        edits[0].row === op.rowIndex &&
        edits[0].cell === op.cellIndex &&
        edits[0].text === op.text &&
        edits[0].expectedText === op.original
      );
    }
    if (!TYPED.has(block.type) || block.type !== source.type) return false;
    const format = "format" in block ? block.format : undefined;
    return (
      op.paragraph === 0 &&
      block.text === op.runs.map((r) => r.text).join("") &&
      stableJson(wordPlanBlockRuns({ ...block, format })) ===
        stableJson(mergeWordInPlaceRuns(op.runs)) &&
      sameFormat(format, source.format) &&
      sameStyle(source, block, snapshot) &&
      (block.type !== "heading" || block.level === source.level) &&
      (block.type !== "list-item" ||
        ((block.level ?? 0) === (source.level ?? 0) &&
          block.list === source.list &&
          !!block.ordered === !!source.ordered))
    );
  });
  return ok && used === ops.length;
}

/** Typed state a written paragraph must have; kept properties come from the source. */
export function wordInPlaceTypedIssue(
  source: WordSourceBlock,
  op: Extract<WordInPlaceOp, { kind: "text" }>,
  actual: WordSourceBlock,
): "text" | "runs" | "type" | "format" | "style" | "list" | undefined {
  if (actual.text !== op.runs.map((r) => r.text).join("")) return "text";
  if (actual.type !== source.type || actual.level !== source.level)
    return "type";
  if (actual.list !== source.list || actual.ordered !== source.ordered)
    return "list";
  if (
    effectiveWordStyle(actual.styleRef) !== effectiveWordStyle(source.styleRef)
  )
    return "style";
  if (!sameFormat(actual.format, source.format)) return "format";
  const typedRuns = actual.runs ?? [{ text: actual.text }];
  const sourceRuns = source.runs ?? [{ text: source.text }];
  const nonMark = wordNonMarkRunProperties(sourceRuns[0]);
  if (
    stableJson(
      mergeWordInPlaceRuns(
        typedRuns.map((run) => ({
          text: run.text,
          bold: !!run.bold,
          italic: !!run.italic,
          underline: !!run.underline,
        })),
      ),
    ) !== stableJson(mergeWordInPlaceRuns(op.runs)) ||
    typedRuns.some((run) => wordNonMarkRunProperties(run) !== nonMark)
  )
    return "runs";
  return undefined;
}

/** Cross-check against the dry-run compile: the import route would produce the same typed blocks. */
function matchesCompiledOutput(
  snapshot: WordAuthoringSnapshot,
  ops: readonly WordInPlaceOp[],
  compiled: WordAuthoringSnapshot,
): boolean {
  if (compiled.blocks.length !== snapshot.blocks.length) return false;
  const index = new Map(snapshot.blocks.map((b, i) => [b.ref, i]));
  return ops.every((op) => {
    const i = index.get(op.ref);
    if (i === undefined) return false;
    const actual = compiled.blocks[i];
    if (op.kind === "cell")
      return (
        actual.content?.rows
          .find((row) => row.sourceIndex === op.rowIndex)
          ?.cells.find((cell) => cell.sourceIndex === op.cellIndex)?.text ===
        op.text
      );
    return !wordInPlaceTypedIssue(snapshot.blocks[i], op, actual);
  });
}
