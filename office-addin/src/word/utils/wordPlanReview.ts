import { wordPlanOutput } from "./wordDocumentPlan";
import { resolveWordSource, wordSourceDetails } from "./wordRichContent";
import { wordBlockChildEntries } from "./wordRichPlan";
import { readWordTableContent } from "./wordTableContent";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
  WordSourceBlock,
} from "./wordDocumentPlan";
import type {
  WordPageLayout,
  WordSectionPlan,
  WordSectionSource,
  WordSectionStories,
  WordStoryType,
} from "./wordStories";
import type { WordTableBlock, WordTableContent } from "./wordTableContent";

export const SMALL_MAX_CHANGED_BLOCKS = 5;
export const LARGE_MIN_TOUCHED_SECTIONS = 3;
export const LARGE_MIN_CHANGED_BLOCKS = 40;
export const MEDIUM_MAX_TOUCHED_SECTIONS = 2;
export const LARGE_INSERT_TABLE_ROWS = 10;

export type WordPlanReviewSize = "small" | "medium" | "large";
export type WordPlanReviewVariant = "addition" | "layout" | "restructured";
export type WordPlanGroupStatus =
  | "rewritten"
  | "changed"
  | "new"
  | "removed"
  | "unchanged";
export type WordPlanRowStatus =
  | "new"
  | "removed"
  | "changed"
  | "kept"
  | "updated"
  | "unchanged";
export type WordPlanObjectKind =
  | NonNullable<WordSourceBlock["nativeKind"]>
  | "drawing"
  | "bookmark";
export type WordPlanScopePart =
  | "headers"
  | "footers"
  | "notes"
  | "comments"
  | "layout";

export interface WordPlanChangedCell {
  row: number;
  col: number;
  before: string;
  after: string;
}
export type WordLayoutProperty =
  | "orientation"
  | "width"
  | "height"
  | "marginTop"
  | "marginRight"
  | "marginBottom"
  | "marginLeft"
  | "marginHeader"
  | "marginFooter"
  | "marginGutter"
  | "columns"
  | "columnSpacing"
  | "break"
  | "pageNumberStart"
  | "differentFirstPage"
  | "differentOddEvenPages";
export type WordLayoutValue = string | number | boolean;
export interface WordLayoutChange {
  property: WordLayoutProperty;
  /** Lengths stay in points; the component converts them for display. */
  length: boolean;
  before?: WordLayoutValue;
  after?: WordLayoutValue;
}

interface WordPlanRowBase {
  key: string;
  status: WordPlanRowStatus;
  locateRef?: string;
}
export type WordPlanRow = WordPlanRowBase &
  (
    | {
        family: "text";
        blockType: "paragraph" | "heading" | "list-item";
        level?: number;
        before?: string;
        beforeLevel?: number;
        after?: WordPlanBlock;
      }
    | {
        family: "table";
        rows: number;
        cols: number;
        sameShape: boolean;
        changedCells: WordPlanChangedCell[];
        rowsAdded: number;
        rowsRemoved: number;
        headerRow: string[];
        changedRowIndexes: number[];
        block?: WordTableBlock<WordPlanBlock>;
        original?: WordTableContent<WordPlanBlock>;
      }
    | {
        family: "object";
        objectKind: WordPlanObjectKind;
        name?: string;
        text?: string;
      }
    | {
        family: "part";
        storyType: WordStoryType;
        storyId: string;
        bindings: (keyof WordSectionStories)[];
        before?: string;
        after?: string;
      }
    | {
        family: "layout";
        sectionId: string;
        changes: WordLayoutChange[];
        beforeAvailable: boolean;
      }
    | {
        family: "unchanged";
        count: number;
        paragraphs: number;
        tables: number;
        objects: number;
      }
  );
export type WordPlanRowOf<F extends WordPlanRow["family"]> = Extract<
  WordPlanRow,
  { family: F }
>;

export interface WordPlanGroupSummary {
  text: number;
  tables: number;
  cells: number;
  rowsAdded: number;
  rowsRemoved: number;
  objects: number;
  removed: number;
}
export interface WordPlanGroup {
  key: string;
  /** Undefined for the content before the first heading. */
  heading?: { text: string; level?: number };
  status: WordPlanGroupStatus;
  rows: WordPlanRow[];
  summary: WordPlanGroupSummary;
}

export type WordPlanRiskKind =
  | "headings-lost"
  | "natives-removed"
  | "sections-removed"
  | "parts-changed"
  | "layout-changed";
export interface WordPlanRiskItem {
  rowKey: string;
  text?: string;
  objectKind?: WordPlanObjectKind;
  storyType?: WordStoryType;
}
export interface WordPlanRisk {
  kind: WordPlanRiskKind;
  count: number;
  items: WordPlanRiskItem[];
  rowKey: string;
}

export type WordPlanTitle =
  | { kind: "cells"; n: number }
  | { kind: "paragraphs-added"; n: number }
  | { kind: "blocks-added"; n: number }
  | { kind: "paragraphs-changed"; n: number }
  | { kind: "removed"; n: number }
  | {
      kind: "sections";
      changed: number;
      total: number;
      parts: WordStoryType[];
      layout: boolean;
    }
  | { kind: "layout"; sections: number; parts: WordStoryType[] }
  | { kind: "summary" }
  | {
      kind: "blocks-changed";
      n: number;
      parts: WordStoryType[];
      layout: boolean;
    };

export interface WordPlanScope {
  /** Applying re-imports the whole file rather than replacing the body. */
  wholeFile: boolean;
  unchanged: WordPlanScopePart[];
}

export interface WordPlanReview {
  size: WordPlanReviewSize;
  variant?: WordPlanReviewVariant;
  title: WordPlanTitle;
  scope: WordPlanScope;
  risks: WordPlanRisk[];
  /** No live capture: risks cannot be computed and are omitted. */
  riskUnknown: boolean;
  groups: WordPlanGroup[];
  rows: WordPlanRow[];
  partsRows: WordPlanRow[];
  changedBlocks: number;
  touchedSections: number;
  /** Native, drawing or layout content whose appearance is only checkable in Word. */
  checkInWord: boolean;
}

export interface WordPlanCounts {
  kept: number;
  replaced: number;
  removed: number;
  added: number;
}
export function planCounts(plan: WordDocumentPlan): WordPlanCounts {
  return plan.entries.reduce(
    (counts, entry) => {
      if (entry.kind === "keep") counts.kept += entry.source.length;
      else if (entry.kind === "replace") counts.replaced += entry.source.length;
      else counts.added += entry.blocks.length;
      return counts;
    },
    {
      kept: 0,
      replaced: 0,
      added: 0,
      removed: plan.deleted.reduce((n, d) => n + d.source.length, 0),
    },
  );
}

/** Word restarts deeper levels of the same list whenever a shallower item follows. */
export function createWordListNumbering(): (block: {
  type: string;
  list?: string;
  level?: number;
}) => number | undefined {
  const counts = new Map<string, number>();
  return (block) => {
    if (block.type !== "list-item") return undefined;
    const list = block.list ?? "";
    const level = block.level ?? 0;
    for (const key of counts.keys()) {
      const separator = key.lastIndexOf(":");
      if (
        key.slice(0, separator) === list &&
        Number(key.slice(separator + 1)) > level
      )
        counts.delete(key);
    }
    const key = `${list}:${level}`;
    const ordinal = (counts.get(key) ?? 0) + 1;
    counts.set(key, ordinal);
    return ordinal;
  };
}

export const pointsToCentimeters = (pt: number) => (pt * 2.54) / 72;
export const pointsToMillimeters = (pt: number) => (pt * 25.4) / 72;
/** Lengths under one centimetre read better in millimetres. */
export function wordLength(pt: number): { value: number; unit: "cm" | "mm" } {
  const mm = pointsToMillimeters(pt);
  return Math.abs(mm) < 10
    ? { value: Math.round(mm * 10) / 10, unit: "mm" }
    : { value: Math.round(mm * 10) / 100, unit: "cm" };
}

export function wordSourceTable(
  snapshot: WordAuthoringSnapshot,
  ref: string | undefined,
): WordTableContent<WordPlanBlock> | undefined {
  if (!ref) return undefined;
  const block = snapshot.blocks.find((source) => source.ref === ref);
  if (block?.content) return block.content;
  const source = resolveWordSource(snapshot, ref);
  if (!source) return undefined;
  const root = new DOMParser().parseFromString(
    source.xml,
    "application/xml",
  ).documentElement;
  const tables = [
    root,
    ...Array.from(
      root.getElementsByTagNameNS(
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "tbl",
      ),
    ),
  ].filter((e, i, all) => e.localName === "tbl" && all.indexOf(e) === i);
  const table = tables[source.index ?? 0];
  return table ? readWordTableContent<WordPlanBlock>(table) : undefined;
}

const TEXT_TYPES = new Set(["paragraph", "heading", "list-item"]);
const LARGE_NATIVE_KINDS = new Set(["table", "image", "drawing"]);
const baseRef = (ref: string) =>
  ref.replace(/_(table|image|drawing)_[1-9][0-9]*$/, "");
const blockText = (block: WordPlanBlock): string =>
  block.text ||
  wordBlockChildEntries(block, "")
    .map((child) => blockText(child.block))
    .filter(Boolean)
    .join("\n");

function sourceObjects(source: WordSourceBlock) {
  return (
    source.objects ?? wordSourceDetails(source.xml, source.ref).objects ?? []
  );
}
function containsLargeNative(source: WordSourceBlock) {
  return (
    (!!source.nativeKind && LARGE_NATIVE_KINDS.has(source.nativeKind)) ||
    (source.type === "native" &&
      sourceObjects(source).some((o) => LARGE_NATIVE_KINDS.has(String(o.kind))))
  );
}
function objectName(object: Record<string, unknown> | undefined) {
  if (!object) return undefined;
  for (const key of ["title", "name", "tag", "alt", "instruction"]) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function insertedObjectName(block: WordPlanBlock): string | undefined {
  switch (block.type) {
    case "image":
      return block.image.title || block.image.alt || undefined;
    case "drawing":
      return block.drawing.title || block.drawing.alt || undefined;
    case "field":
      return block.field.instruction;
    case "bookmark":
      return block.bookmark.name;
    case "content-control":
      return block.control.title || block.control.tag || undefined;
    default:
      return undefined;
  }
}

function tableRow(
  key: string,
  status: WordPlanRowStatus,
  block: WordTableBlock<WordPlanBlock> | undefined,
  original: WordTableContent<WordPlanBlock> | undefined,
  bySourceIndex: boolean,
  locateRef?: string,
): WordPlanRowOf<"table"> {
  const width = (cells: { colSpan?: number }[] | undefined) =>
    (cells ?? []).reduce((sum, cell) => sum + (cell.colSpan ?? 1), 0);
  if (!block) {
    const rows = original?.rows ?? [];
    return {
      key,
      family: "table",
      status,
      locateRef,
      rows: rows.length,
      cols: width(rows[0]?.cells),
      sameShape: false,
      changedCells: [],
      rowsAdded: 0,
      rowsRemoved: rows.length,
      headerRow: rows[0]?.cells.map((c) => c.text) ?? [],
      changedRowIndexes: [],
      original,
    };
  }
  const originalRows = original?.rows ?? [];
  const usedRows = new Set<number>();
  const changedCells: WordPlanChangedCell[] = [];
  const changedRows = new Set<number>();
  const headerRow: string[] = [];
  let rowsAdded = 0;
  for (const [r, row] of block.rows.entries()) {
    const sourceRow = bySourceIndex
      ? row.sourceIndex === undefined
        ? undefined
        : originalRows.find((o) => o.sourceIndex === row.sourceIndex)
      : originalRows[r];
    if (sourceRow) usedRows.add(originalRows.indexOf(sourceRow));
    else {
      rowsAdded++;
      changedRows.add(r);
    }
    for (const [c, cell] of row.cells.entries()) {
      const sourceCell = !sourceRow
        ? undefined
        : bySourceIndex
          ? cell.sourceIndex === undefined
            ? undefined
            : sourceRow.cells.find((o) => o.sourceIndex === cell.sourceIndex)
          : sourceRow.cells[c];
      const retained = sourceCell?.text ?? "";
      const after = cell.textEdit
        ? cell.textEdit.text
        : cell.blocks
          ? cell.blocks.map(blockText).join("\n")
          : retained;
      const before = cell.textEdit
        ? (cell.textEdit.expectedText ?? retained)
        : retained;
      if (r === 0) headerRow.push(after);
      if (sourceRow && (!sourceCell || before !== after)) {
        changedCells.push({ row: r, col: c, before, after });
        changedRows.add(r);
      }
    }
  }
  const rowsRemoved = original ? originalRows.length - usedRows.size : 0;
  const cols = width(block.rows[0]?.cells);
  return {
    key,
    family: "table",
    status,
    locateRef,
    rows: block.rows.length,
    cols,
    sameShape:
      !!original &&
      rowsAdded === 0 &&
      rowsRemoved === 0 &&
      cols === width(originalRows[0]?.cells),
    changedCells,
    rowsAdded,
    rowsRemoved,
    headerRow,
    changedRowIndexes: [...changedRows].sort((a, b) => a - b),
    block,
    original,
  };
}

const LAYOUT_PROPERTIES: [
  WordLayoutProperty,
  (layout: WordPageLayout) => WordLayoutValue | undefined,
  boolean,
][] = [
  ["orientation", (l) => l.orientation, false],
  ["width", (l) => l.width, true],
  ["height", (l) => l.height, true],
  ["marginTop", (l) => l.margins?.top, true],
  ["marginRight", (l) => l.margins?.right, true],
  ["marginBottom", (l) => l.margins?.bottom, true],
  ["marginLeft", (l) => l.margins?.left, true],
  ["marginHeader", (l) => l.margins?.header, true],
  ["marginFooter", (l) => l.margins?.footer, true],
  ["marginGutter", (l) => l.margins?.gutter, true],
  ["columns", (l) => l.columns, false],
  ["columnSpacing", (l) => l.columnSpacing, true],
  ["break", (l) => l.break, false],
  ["pageNumberStart", (l) => l.pageNumberStart, false],
  ["differentFirstPage", (l) => l.differentFirstPage, false],
  ["differentOddEvenPages", (l) => l.differentOddEvenPages, false],
];
function layoutChanges(
  after: WordPageLayout | undefined,
  before: WordPageLayout | undefined,
): WordLayoutChange[] {
  if (!after) return [];
  return LAYOUT_PROPERTIES.flatMap(([property, read, length]) => {
    const value = read(after);
    if (value === undefined) return [];
    if (!before) return [{ property, length, after: value }];
    const previous = read(before);
    return previous === value
      ? []
      : [{ property, length, before: previous, after: value }];
  });
}

function sectionRows(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot | undefined,
): { rows: WordPlanRowOf<"layout">[]; removed: WordPlanRowOf<"layout">[] } {
  if (!plan.sections) return { rows: [], removed: [] };
  const sources = snapshot?.sections;
  const rows = plan.sections.flatMap<WordPlanRowOf<"layout">>((section) => {
    const source: WordSectionSource | undefined = section.source
      ? sources?.find((s) => s.id === section.source)
      : undefined;
    const beforeAvailable = !!source;
    const changes = layoutChanges(section.layout, source?.layout);
    if (beforeAvailable && !changes.length) return [];
    return [
      {
        key: `section:${section.id}`,
        family: "layout",
        status: section.source ? "changed" : "new",
        locateRef: section.after,
        sectionId: section.id,
        changes,
        beforeAvailable,
      },
    ];
  });
  const referenced = new Set(plan.sections.map((s) => s.source));
  const removed = (sources ?? [])
    .filter((source) => !referenced.has(source.id))
    .map<WordPlanRowOf<"layout">>((source) => ({
      key: `section-removed:${source.id}`,
      family: "layout",
      status: "removed",
      locateRef: source.afterBlock,
      sectionId: source.id,
      changes: [],
      beforeAvailable: true,
    }));
  return { rows: rows, removed };
}

function storyRows(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot | undefined,
): WordPlanRowOf<"part">[] {
  const bindings = (id: string) => {
    const found = new Set<keyof WordSectionStories>();
    const sections: (WordSectionPlan | WordSectionSource)[] =
      plan.sections ?? snapshot?.sections ?? [];
    for (const section of sections)
      for (const mapping of [section.headers, section.footers])
        for (const [variant, ref] of Object.entries(mapping ?? {}))
          if (ref === id) found.add(variant as keyof WordSectionStories);
    return (["default", "first", "even"] as const).filter((v) => found.has(v));
  };
  return (plan.stories ?? []).map((story) => {
    const existing = snapshot?.stories?.find((s) => s.id === story.id);
    return {
      key: `story:${story.id}`,
      family: "part",
      status:
        story.kind === "delete"
          ? "removed"
          : existing || !snapshot
            ? "changed"
            : "new",
      storyType: story.type,
      storyId: story.id,
      bindings: bindings(story.id),
      before: existing?.text,
      after:
        story.kind === "delete"
          ? undefined
          : (story.blocks ?? []).map(blockText).join("\n"),
    };
  });
}

interface GroupDraft {
  key: string;
  order: [number, number];
  heading?: { text: string; level?: number };
  isNew: boolean;
  rows: WordPlanRow[];
  replaced: boolean;
}

export function buildWordPlanReview(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot | undefined,
): WordPlanReview {
  const sources = new Map(snapshot?.blocks.map((b) => [b.ref, b]) ?? []);
  const rangeOf = new Map<string, number>();
  const ranges: GroupDraft[] = [];
  const openRange = (heading?: WordSourceBlock) =>
    ranges.push({
      key: `range:${ranges.length}`,
      order: [ranges.length, 0],
      heading: heading && { text: heading.text, level: heading.level },
      isNew: false,
      rows: [],
      replaced: false,
    });
  openRange();
  for (const block of snapshot?.blocks ?? []) {
    if (block.type === "heading") openRange(block);
    rangeOf.set(block.ref, ranges.length - 1);
  }
  const groups = [...ranges];
  const newGroupCount = new Map<number, number>();
  const touched = new Set<string>();
  const rowKeyByRef = new Map<string, string>();
  const removedNatives: { row: WordPlanRow; large: boolean }[] = [];
  let changedBlocks = 0;
  let restructured = false;
  let hasReplace = false;
  let hasInsert = false;
  let largeInsert = false;
  let checkInWord = false;
  let current: GroupDraft = ranges[0];

  const push = (group: GroupDraft, row: WordPlanRow) => {
    const last = group.rows[group.rows.length - 1];
    if (row.family === "unchanged" && last?.family === "unchanged") {
      last.count += row.count;
      last.paragraphs += row.paragraphs;
      last.tables += row.tables;
      last.objects += row.objects;
    } else group.rows.push(row);
  };
  const groupFor = (ref: string | undefined) =>
    ranges[ref === undefined ? 0 : (rangeOf.get(ref) ?? 0)];
  const removedSourceRow = (
    source: WordSourceBlock,
    key: string,
  ): WordPlanRow => {
    if (source.type !== "native")
      return {
        key,
        family: "text",
        status: "removed",
        locateRef: source.ref,
        blockType: source.type,
        level: source.level,
        before: source.text,
        beforeLevel: source.level,
      };
    checkInWord = true;
    const row: WordPlanRow =
      source.nativeKind === "table"
        ? tableRow(
            key,
            "removed",
            undefined,
            wordSourceTable(snapshot!, source.ref),
            true,
            source.ref,
          )
        : {
            key,
            family: "object",
            status: "removed",
            locateRef: source.ref,
            objectKind: source.nativeKind ?? "rich-content",
            name: source.description,
            text: source.text || undefined,
          };
    if (source.nativeKind !== "section-break")
      removedNatives.push({ row, large: containsLargeNative(source) });
    return row;
  };

  const outputRows = (
    blocks: WordPlanBlock[],
    sourceBlocks: WordSourceBlock[],
    locateRef: string | undefined,
    replacing: boolean,
  ): WordPlanRow[] => {
    const textSources = sourceBlocks.filter((s) => s.type !== "native");
    const nativeSources = sourceBlocks.filter((s) => s.type === "native");
    const textBlocks = blocks.filter((b) => TEXT_TYPES.has(b.type));
    const pairByIndex = textSources.length === textBlocks.length;
    const referenced = new Set<string>();
    const types = new Set<string>();
    const visit = (block: WordPlanBlock) => {
      types.add(block.type);
      if ("sourceRef" in block && block.sourceRef)
        referenced.add(baseRef(block.sourceRef));
      if (block.type === "image" && block.image.sourceRef)
        referenced.add(baseRef(block.image.sourceRef));
      if (block.type === "drawing" && block.drawing.sourceRef)
        referenced.add(baseRef(block.drawing.sourceRef));
      wordBlockChildEntries(block, "").forEach((c) => visit(c.block));
    };
    blocks.forEach(visit);
    const tableSource = nativeSources.find((s) => s.nativeKind === "table");
    const rows: WordPlanRow[] = [];
    let textIndex = 0;
    for (const block of blocks) {
      const key = `output:${block.id}`;
      if (
        block.type === "paragraph" ||
        block.type === "heading" ||
        block.type === "list-item"
      ) {
        const source = pairByIndex
          ? textSources[textIndex]
          : textIndex === 0 && textSources.length
            ? {
                text: textSources.map((s) => s.text).join("\n"),
                level: textSources[0].level,
              }
            : undefined;
        textIndex++;
        rows.push({
          key,
          family: "text",
          status: source || (replacing && !snapshot) ? "changed" : "new",
          locateRef,
          blockType: block.type,
          level: block.level,
          before: source?.text,
          beforeLevel: source?.level,
          after: block,
        });
      } else if (block.type === "table") {
        const original =
          (snapshot && wordSourceTable(snapshot, block.sourceRef)) ??
          (tableSource && snapshot
            ? wordSourceTable(snapshot, tableSource.ref)
            : undefined);
        const row = tableRow(
          key,
          original ? "changed" : "new",
          block,
          original,
          !!block.sourceRef,
          locateRef,
        );
        if (!original && block.rows.length >= LARGE_INSERT_TABLE_ROWS)
          largeInsert = true;
        rows.push(row);
      } else if (block.type === "native-edit") {
        checkInWord = true;
        const source = sourceBlocks.find(
          (s) => s.ref === baseRef(block.sourceRef),
        );
        const objects = source ? sourceObjects(source) : [];
        if (!block.edits.length)
          rows.push({
            key,
            family: "object",
            status: "kept",
            locateRef,
            objectKind: source?.nativeKind ?? "rich-content",
            name: source?.description,
          });
        for (const edit of block.edits) {
          const row: WordPlanRow = {
            key: `${key}:${edit.kind}:${edit.target}`,
            family: "object",
            status: edit.operation === "update" ? "updated" : "removed",
            locateRef,
            objectKind: edit.kind === "image" ? "image" : edit.kind,
            name: objectName(
              objects.find(
                (o) => o.kind === edit.kind && o.target === edit.target,
              ),
            ),
          };
          rows.push(row);
          if (edit.operation !== "update")
            removedNatives.push({
              row,
              large: edit.kind === "image" || edit.kind === "drawing",
            });
        }
      } else {
        checkInWord = true;
        const spec =
          block.type === "image"
            ? block.image
            : block.type === "drawing"
              ? block.drawing
              : undefined;
        const carried = !!spec?.sourceRef;
        const onlyReference =
          carried &&
          Object.keys(spec).every((k) =>
            ["sourceRef", "sourceIndex"].includes(k),
          );
        rows.push({
          key,
          family: "object",
          status: onlyReference ? "kept" : carried ? "updated" : "new",
          locateRef,
          objectKind: block.type,
          name: insertedObjectName(block),
          text: block.text || undefined,
        });
      }
    }
    if (!textBlocks.length)
      for (const source of textSources)
        rows.push(removedSourceRow(source, `replaced:${source.ref}`));
    for (const source of nativeSources) {
      const carried =
        referenced.has(source.ref) ||
        (source.nativeKind === "table" && types.has("table")) ||
        (source.nativeKind === "image" &&
          (types.has("image") || types.has("drawing"))) ||
        (source.nativeKind === "field" && types.has("field")) ||
        (source.nativeKind === "content-control" &&
          types.has("content-control"));
      if (!carried)
        rows.push(removedSourceRow(source, `replaced:${source.ref}`));
    }
    return rows;
  };

  for (const entry of plan.entries) {
    if (entry.kind === "keep") {
      for (const ref of entry.source) {
        const source = sources.get(ref);
        current = groupFor(ref);
        push(current, {
          key: `keep:${ref}`,
          family: "unchanged",
          status: "unchanged",
          locateRef: ref,
          count: 1,
          paragraphs: !source || source.type !== "native" ? 1 : 0,
          tables: source?.nativeKind === "table" ? 1 : 0,
          objects:
            source?.type === "native" && source.nativeKind !== "table" ? 1 : 0,
        });
      }
      continue;
    }
    changedBlocks += entry.blocks.length;
    if (entry.kind === "replace") {
      hasReplace = true;
      const spanned = new Set(entry.source.map((ref) => rangeOf.get(ref) ?? 0));
      spanned.forEach((range) => touched.add(`range:${range}`));
      if (snapshot && spanned.size >= 2) restructured = true;
      current = groupFor(entry.source[0]);
      current.replaced = true;
      const rows = outputRows(
        entry.blocks,
        entry.source.flatMap((ref) => sources.get(ref) ?? []),
        entry.source[0],
        true,
      );
      for (const row of rows) push(current, row);
      for (const ref of entry.source)
        rowKeyByRef.set(
          ref,
          rows.find((r) => r.key === `replaced:${ref}`)?.key ??
            rows[0]?.key ??
            "",
        );
      continue;
    }
    hasInsert = true;
    const anchor = entry.contextRefs?.[0];
    if (anchor !== undefined) current = groupFor(anchor);
    const range = current.order[0];
    if (snapshot && entry.blocks[0]?.type === "heading") {
      const sub = (newGroupCount.get(range) ?? 0) + 1;
      newGroupCount.set(range, sub);
      current = {
        key: `new:${entry.blocks[0].id}`,
        order: [range, sub],
        heading: {
          text: entry.blocks[0].text,
          level: entry.blocks[0].level,
        },
        isNew: true,
        rows: [],
        replaced: false,
      };
      groups.push(current);
    }
    touched.add(current.key);
    for (const row of outputRows(
      entry.blocks,
      [],
      anchor ?? current.rows[0]?.locateRef,
      false,
    ))
      push(current, row);
  }
  for (const deletion of plan.deleted)
    for (const ref of deletion.source) {
      changedBlocks++;
      const group = groupFor(ref);
      touched.add(group.key);
      const source = sources.get(ref);
      const row: WordPlanRow = source
        ? removedSourceRow(source, `deleted:${ref}`)
        : {
            key: `deleted:${ref}`,
            family: "text",
            status: "removed",
            blockType: "paragraph",
          };
      rowKeyByRef.set(ref, row.key);
      push(group, row);
    }

  const summarize = (rows: WordPlanRow[]): WordPlanGroupSummary => {
    const summary = {
      text: 0,
      tables: 0,
      cells: 0,
      rowsAdded: 0,
      rowsRemoved: 0,
      objects: 0,
      removed: 0,
    };
    for (const row of rows) {
      if (row.status === "removed") summary.removed++;
      if (row.family === "text") summary.text++;
      else if (row.family === "object") summary.objects++;
      else if (row.family === "table") {
        summary.tables++;
        summary.cells += row.changedCells.length;
        summary.rowsAdded += row.rowsAdded;
        summary.rowsRemoved += row.rowsRemoved;
      }
    }
    return summary;
  };
  const finalGroups = groups
    .filter((g) => g.rows.length)
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1])
    .map<WordPlanGroup>((g) => {
      const changed = g.rows.filter((r) => r.family !== "unchanged");
      const status: WordPlanGroupStatus = g.isNew
        ? "new"
        : !changed.length
          ? "unchanged"
          : changed.length === g.rows.length &&
              changed.every((r) => r.status === "removed")
            ? "removed"
            : changed.length === g.rows.length && g.replaced
              ? "rewritten"
              : "changed";
      return {
        key: g.key,
        heading: g.heading,
        status,
        rows: g.rows,
        summary: summarize(changed),
      };
    });
  const rows = finalGroups.flatMap((g) => g.rows);
  const stories = storyRows(plan, snapshot);
  const sections = sectionRows(plan, snapshot);
  const partsRows: WordPlanRow[] = [
    ...stories,
    ...sections.rows,
    ...sections.removed,
  ];
  if (sections.rows.length || sections.removed.length) checkInWord = true;

  const risks: WordPlanRisk[] = [];
  const addRisk = (kind: WordPlanRiskKind, items: WordPlanRiskItem[]) => {
    if (items.length)
      risks.push({ kind, count: items.length, items, rowKey: items[0].rowKey });
  };
  if (snapshot) {
    const outputHeadings = wordPlanOutput(plan, snapshot)
      .filter((o) => o.block.type === "heading")
      .map((o) => o.block.text.trim());
    const sourceHeadings = snapshot.blocks.filter((b) => b.type === "heading");
    const lost = sourceHeadings.length - outputHeadings.length;
    if (lost > 0) {
      const remaining = [...outputHeadings];
      const missing = sourceHeadings.filter((h) => {
        const at = remaining.indexOf(h.text.trim());
        if (at < 0) return true;
        remaining.splice(at, 1);
        return false;
      });
      addRisk(
        "headings-lost",
        missing.slice(0, lost).map((h) => ({
          rowKey: rowKeyByRef.get(h.ref) ?? `keep:${h.ref}`,
          text: h.text,
        })),
      );
    }
    addRisk(
      "natives-removed",
      removedNatives.map(({ row }) => ({
        rowKey: row.key,
        objectKind:
          row.family === "object"
            ? row.objectKind
            : row.family === "table"
              ? "table"
              : undefined,
        text: row.family === "object" ? row.name : undefined,
      })),
    );
    addRisk(
      "sections-removed",
      sections.removed.map((row) => ({ rowKey: row.key })),
    );
    addRisk(
      "parts-changed",
      stories.map((row) => ({ rowKey: row.key, storyType: row.storyType })),
    );
    addRisk(
      "layout-changed",
      sections.rows.map((row) => ({ rowKey: row.key })),
    );
  }

  const bodyChanged = hasReplace || hasInsert || plan.deleted.length > 0;
  const partsChanged = !!(plan.stories?.length || plan.sections?.length);
  const changedGroups = finalGroups.filter((g) => g.status !== "unchanged");
  const touchedSections = snapshot ? touched.size : 0;
  const variant: WordPlanReviewVariant | undefined = restructured
    ? "restructured"
    : !bodyChanged && partsChanged
      ? "layout"
      : hasInsert && !hasReplace && !plan.deleted.length && !partsChanged
        ? "addition"
        : undefined;
  const nothingRemoved = !plan.deleted.length && !removedNatives.length;
  const size: WordPlanReviewSize =
    touchedSections >= LARGE_MIN_TOUCHED_SECTIONS ||
    changedBlocks >= LARGE_MIN_CHANGED_BLOCKS ||
    removedNatives.some((n) => n.large) ||
    (bodyChanged && partsChanged)
      ? "large"
      : changedBlocks <= SMALL_MAX_CHANGED_BLOCKS &&
          touchedSections <= MEDIUM_MAX_TOUCHED_SECTIONS &&
          nothingRemoved &&
          !partsChanged &&
          !largeInsert &&
          !(plan.scope === "document" && snapshot?.fullDocument)
        ? "small"
        : "medium";

  const storyTypes = [...new Set((plan.stories ?? []).map((s) => s.type))];
  const layout = sections.rows.length + sections.removed.length > 0;
  const changedRows = rows.filter((r) => r.family !== "unchanged");
  const topLevelInserted = plan.entries.flatMap((e) =>
    e.kind === "insert" ? e.blocks : [],
  );
  const cellsOnly =
    !partsChanged &&
    changedRows.length > 0 &&
    changedRows.every(
      (r) =>
        r.family === "table" &&
        r.status === "changed" &&
        r.sameShape &&
        r.changedCells.length > 0,
    );
  const title: WordPlanTitle =
    variant === "restructured"
      ? { kind: "summary" }
      : variant === "layout"
        ? {
            kind: "layout",
            sections: sections.rows.length + sections.removed.length,
            parts: storyTypes,
          }
        : cellsOnly
          ? {
              kind: "cells",
              n: changedRows.reduce(
                (n, r) =>
                  n + (r.family === "table" ? r.changedCells.length : 0),
                0,
              ),
            }
          : variant === "addition"
            ? topLevelInserted.every((b) => TEXT_TYPES.has(b.type))
              ? { kind: "paragraphs-added", n: topLevelInserted.length }
              : { kind: "blocks-added", n: topLevelInserted.length }
            : size === "large" && finalGroups.length > 1
              ? {
                  kind: "sections",
                  changed: changedGroups.length,
                  total: finalGroups.length,
                  parts: storyTypes,
                  layout,
                }
              : !partsChanged &&
                  changedRows.length > 0 &&
                  changedRows.every((r) => r.status === "removed")
                ? { kind: "removed", n: changedBlocks }
                : !partsChanged &&
                    nothingRemoved &&
                    changedRows.length > 0 &&
                    changedRows.every((r) => r.family === "text")
                  ? { kind: "paragraphs-changed", n: changedRows.length }
                  : {
                      kind: "blocks-changed",
                      n: changedBlocks,
                      parts: storyTypes,
                      layout,
                    };

  const present = new Set<WordPlanScopePart>();
  const categoryOf = (type: string): WordPlanScopePart =>
    type.startsWith("header")
      ? "headers"
      : type.startsWith("footer")
        ? "footers"
        : type.startsWith("comment")
          ? "comments"
          : "notes";
  if (snapshot) {
    snapshot.stories?.forEach((s) => present.add(categoryOf(s.type)));
    snapshot.preservedStories?.forEach((s) => present.add(categoryOf(s)));
  } else {
    present.add("headers");
    present.add("footers");
  }
  (plan.stories ?? []).forEach((s) => present.delete(categoryOf(s.type)));
  const unchanged = (
    ["headers", "footers", "notes", "comments"] as WordPlanScopePart[]
  ).filter((part) => present.has(part));
  if (!plan.sections) unchanged.push("layout");

  return {
    size,
    variant,
    title,
    scope: { wholeFile: !!snapshot?.fullDocument, unchanged },
    risks,
    riskUnknown: !snapshot,
    groups: finalGroups,
    rows,
    partsRows,
    changedBlocks,
    touchedSections,
    checkInWord:
      checkInWord ||
      !!snapshot?.blocks.some((b) => b.type === "native") ||
      partsChanged,
  };
}
