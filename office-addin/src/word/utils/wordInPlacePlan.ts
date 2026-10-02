import {
  WORDPROCESSING_NS as W,
  readWordRunFormatting,
} from "./wordBlockFormatting";
import {
  isBuiltInHeadingStyle,
  wordBuiltInParagraphStyle,
} from "./wordBuiltInStyles";
import { wordPlanOutput } from "./wordDocumentPlan";
import { wordBlockParagraphs } from "./wordLiveParagraphs";
import { createNativeContentSignature } from "./wordNativeContent";
import { WORD_REVISION_ELEMENTS } from "./wordRevisionViews";
import { wordTableCellTextEditIssue } from "./wordTableCellText";

import type {
  WordParagraphFormatting,
  WordRunFormatting,
} from "./wordBlockFormatting";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
  WordPlanEntry,
  WordPlanRun,
  WordSourceBlock,
} from "./wordDocumentPlan";
import type { WordInPlaceCapabilities } from "./wordInPlaceCapabilities";
import type { WordSectionStories } from "./wordStories";
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
  "boundary",
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

const NO_MARKS: WordInPlaceMarks = {
  bold: false,
  italic: false,
  underline: false,
};

/** Whether writing `runs` over a first run carrying `inherited` calls the bold or italic setter, as
 * queueWordInPlaceTextWrite does; without the "marks" mechanism those calls cannot be undone exactly. */
export function wordInPlaceRunsSetMarks(
  runs: readonly WordInPlaceRun[],
  inherited: WordInPlaceMarks,
): boolean {
  let previous = inherited;
  for (const run of runs) {
    if (run.bold !== previous.bold || run.italic !== previous.italic)
      return true;
    previous = run;
  }
  return false;
}

const rewriteSetsMarks = (
  runs: readonly WordInPlaceRun[],
  original: readonly WordInPlaceRun[],
) =>
  wordInPlaceRunsSetMarks(runs, original[0] ?? NO_MARKS) ||
  wordInPlaceRunsSetMarks(original, runs[0] ?? NO_MARKS);
/** How the object model applies a paragraph style: by its locale-independent built-in name, or by
 * the w:name of a custom style. */
export type WordInPlaceStyle = { builtIn: string } | { name: string };
/** Typed paragraph state the object model sets after writing text: list membership, then style. */
export interface WordInPlaceState {
  type: "paragraph" | "heading" | "list-item";
  /** Heading level (1-9) or list level (0-8). */
  level?: number;
  /** The w:pStyle Word is expected to write; omitted for the default paragraph style. */
  styleRef?: string;
  style: WordInPlaceStyle;
  list?: string;
  ordered?: boolean;
  /** A captured member of `list` that stays in it: the paragraph joins that member's live List. */
  listRef?: string;
}
/** An existing header or footer the object model reaches through the one section that uses it. */
export interface WordInPlaceStoryTarget {
  kind: "header" | "footer";
  /** Package part, e.g. /word/header1.xml. */
  part: string;
  section: number;
  type: "Primary" | "FirstPage" | "EvenPages";
}
export type WordInPlaceOp =
  | {
      kind: "text";
      /** Body block, or the story ID when `story` is set. */
      ref: string;
      /** Index among the paragraphs of the block or story. */
      paragraph: number;
      runs: WordInPlaceRun[];
      original: WordInPlaceRun[];
      /** Style, heading level or list membership change, set after the text. */
      restyle?: { from: WordInPlaceState; to: WordInPlaceState };
      story?: WordInPlaceStoryTarget;
    }
  | {
      kind: "cell";
      ref: string;
      paragraph: number;
      rowIndex: number;
      cellIndex: number;
      text: string;
      original: string;
    }
  | {
      kind: "insert";
      /** The surviving paragraph the new one is inserted next to. */
      ref: string;
      paragraph: 0;
      location: "After" | "Before";
      /** Output block ID. */
      block: string;
      runs: WordInPlaceRun[];
      state: WordInPlaceState;
    }
  | {
      kind: "delete";
      ref: string;
      paragraph: 0;
      original: WordInPlaceRun[];
      state: WordInPlaceState;
      /** Undo re-creates the paragraph after the paragraph before it, or before the one after it. */
      recreate: "After" | "Before";
    };
export type WordInPlaceClassification =
  | { ops: WordInPlaceOp[] }
  | { fallback: WordInPlaceFallback };

/** Typed state a written paragraph must have once the object model is done with it. */
export interface WordInPlaceExpected {
  text: string;
  runs: WordInPlaceRun[];
  type: WordSourceBlock["type"];
  level?: number;
  styleRef?: string;
  list?: string;
  ordered?: boolean;
  format?: object;
  /** Run properties other than b/i/u every run must carry. */
  nonMark: string;
}

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XMLNS = "http://www.w3.org/2000/xmlns/";
const RSIDS = new Set(["rsidR", "rsidRPr", "rsidDel", "rsidRDefault"]);
const MARK_ELEMENTS = new Set(["b", "bCs", "i", "iCs", "u"]);
const TYPED = new Set(["paragraph", "heading", "list-item"]);
/** insertText turns these into new paragraphs or breaks instead of text. */
const STRUCTURAL_TEXT = /[\n\r\v\f\u2028\u2029]/u;
const NO_RUN_PROPERTIES = "{}";

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

const paragraphFormat = (
  block: WordPlanBlock,
): WordParagraphFormatting | undefined =>
  block.type === "paragraph" ||
  block.type === "heading" ||
  block.type === "list-item"
    ? block.format
    : undefined;

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

export const sameWordInPlaceRuns = (
  a: readonly WordInPlaceRun[],
  b: readonly WordInPlaceRun[],
) =>
  stableJson(mergeWordInPlaceRuns(a)) === stableJson(mergeWordInPlaceRuns(b));

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
  let nonMark = NO_RUN_PROPERTIES;
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

/** Paragraph properties the object model can reproduce: style and list membership only. Anything
 * else would be inherited by a paragraph inserted next to it and cannot be cleared. */
function paragraphProperties(source: WordSourceBlock): {
  clean: boolean;
  numbered: boolean;
} {
  const paragraph = parse(source.xml);
  const props = isW(paragraph, "p") ? children(paragraph, "pPr") : [];
  const pPr = props[0];
  if (!isW(paragraph, "p") || props.length > 1)
    return { clean: false, numbered: false };
  if (!pPr) return { clean: true, numbered: false };
  const numPr = children(pPr, "numPr");
  return {
    clean:
      onlyAttributes(pPr, rsid) &&
      children(pPr).every(
        (c) =>
          (isW(c, "pStyle") &&
            onlyAttributes(
              c,
              (a) => a.namespaceURI === W && a.localName === "val",
            )) ||
          (isW(c, "numPr") &&
            children(c).every(
              (n) =>
                (isW(n, "ilvl") || isW(n, "numId")) &&
                onlyAttributes(
                  n,
                  (a) => a.namespaceURI === W && a.localName === "val",
                ),
            )),
      ),
    numbered: numPr.length === 1,
  };
}

const customStyles = new WeakMap<WordAuthoringSnapshot, Set<string>>();

/** Style IDs marked w:customStyle: created by a user or template rather than built into Word. */
function customStyleIds(snapshot: WordAuthoringSnapshot): Set<string> {
  const cached = customStyles.get(snapshot);
  if (cached) return cached;
  const doc = new DOMParser().parseFromString(
    snapshot.ooxml,
    "application/xml",
  );
  const ids = new Set(
    Array.from(doc.getElementsByTagNameNS(W, "style"))
      .filter((style) =>
        ["1", "true", "on"].includes(
          style.getAttributeNS(W, "customStyle") ?? "",
        ),
      )
      .map((style) => style.getAttributeNS(W, "styleId") ?? ""),
  );
  customStyles.set(snapshot, ids);
  return ids;
}

function styleTarget(
  snapshot: WordAuthoringSnapshot,
  styleRef: string | undefined,
): WordInPlaceStyle | undefined {
  if (!styleRef) return { builtIn: "Normal" };
  const style = snapshot.styles.find(
    (s) => s.id === styleRef && (!s.type || s.type === "paragraph"),
  );
  if (!style) return styleRef === "Normal" ? { builtIn: "Normal" } : undefined;
  const builtIn = wordBuiltInParagraphStyle(style.id, style.name);
  if (builtIn) return { builtIn };
  // Paragraph.style takes a custom style's name; a built-in one goes by its localized name there,
  // which the package does not carry. A comma in the name reads as a list of aliases.
  return style.name &&
    !style.name.includes(",") &&
    customStyleIds(snapshot).has(style.id)
    ? { name: style.name }
    : undefined;
}

type Typed = Pick<
  WordInPlaceExpected,
  "type" | "level" | "styleRef" | "list" | "ordered"
>;

function sourceTyped(source: WordSourceBlock): Typed {
  return {
    type: source.type,
    ...(source.level === undefined ? {} : { level: source.level }),
    ...(source.styleRef ? { styleRef: source.styleRef } : {}),
    ...(source.list ? { list: source.list } : {}),
    ...(source.ordered === undefined ? {} : { ordered: source.ordered }),
  };
}

function blockTyped(
  block: WordPlanBlock,
  snapshot: Pick<WordAuthoringSnapshot, "styles">,
): Typed {
  if (block.type === "heading") {
    const level = block.level ?? 1;
    return {
      type: "heading",
      level,
      styleRef: wordHeadingStyleId(snapshot, level),
    };
  }
  return {
    type: block.type as Typed["type"],
    ...(block.type === "list-item" ? { level: block.level ?? 0 } : {}),
    ...(block.styleRef ? { styleRef: block.styleRef } : {}),
    ...(block.type === "list-item" && block.list
      ? { list: block.list, ordered: !!block.ordered }
      : {}),
  };
}

function withStyle(
  typed: Typed,
  snapshot: WordAuthoringSnapshot,
): WordInPlaceState | undefined {
  const style =
    typed.type === "heading" && typed.styleRef === undefined
      ? undefined
      : typed.type === "heading" &&
          isBuiltInHeadingStyle(
            typed.styleRef!,
            snapshot.styles.find((s) => s.id === typed.styleRef)?.name ?? "",
            typed.level ?? 1,
          )
        ? { builtIn: `Heading${typed.level ?? 1}` }
        : styleTarget(snapshot, typed.styleRef);
  // Attaching applies List Paragraph (probe P6), so only such list items can be re-created exactly.
  if (
    typed.type === "list-item" &&
    !(style && "builtIn" in style && style.builtIn === "ListParagraph")
  )
    return undefined;
  return style
    ? { ...(typed as Omit<WordInPlaceState, "style">), style }
    : undefined;
}

const styleChanged = (a: Typed, b: Typed) =>
  (a.type === "heading") !== (b.type === "heading") ||
  (a.type === "heading" && a.level !== b.level) ||
  effectiveWordStyle(a.styleRef) !== effectiveWordStyle(b.styleRef);
const listChanged = (a: Typed, b: Typed) =>
  (a.type === "list-item") !== (b.type === "list-item") ||
  (a.type === "list-item" && (a.list !== b.list || a.level !== b.level));

/** Shared by classification, plan equivalence and verification. */
function expectedOf(
  op: Exclude<WordInPlaceOp, { kind: "cell" | "delete" }>,
  source: WordSourceBlock | undefined,
): WordInPlaceExpected {
  const runs = mergeWordInPlaceRuns(op.runs);
  const text = runs.map((r) => r.text).join("");
  if (op.kind === "insert") {
    const { style: _style, listRef: _listRef, ...typed } = op.state;
    return { ...typed, text, runs, nonMark: NO_RUN_PROPERTIES };
  }
  const sourceRuns = source?.runs ?? [{ text: source?.text ?? "" }];
  const nonMark = wordNonMarkRunProperties(sourceRuns[0]);
  if (op.restyle) {
    const { style: _style, listRef: _listRef, ...typed } = op.restyle.to;
    return { ...typed, text, runs, nonMark };
  }
  return {
    ...(source ? sourceTyped(source) : { type: "paragraph" }),
    ...(source?.format ? { format: source.format } : {}),
    text,
    runs,
    nonMark,
  };
}

export function wordInPlaceExpected(
  op: Exclude<WordInPlaceOp, { kind: "cell" | "delete" }>,
  snapshot: Pick<WordAuthoringSnapshot, "blocks">,
): WordInPlaceExpected {
  return expectedOf(
    op,
    op.kind === "text"
      ? snapshot.blocks.find((b) => b.ref === op.ref)
      : undefined,
  );
}

/** A built-in heading may land in a style Word adds under its own (localized) ID. */
function sameStyleRef(
  expected: Typed,
  actual: WordSourceBlock,
  styles: WordAuthoringSnapshot["styles"],
): boolean {
  if (
    effectiveWordStyle(actual.styleRef) ===
    effectiveWordStyle(expected.styleRef)
  )
    return true;
  const builtInHeading = (styleRef: string | undefined) =>
    !!styleRef &&
    isBuiltInHeadingStyle(
      styleRef,
      styles.find((s) => s.id === styleRef)?.name ?? "",
      expected.level ?? 1,
    );
  return (
    expected.type === "heading" &&
    builtInHeading(expected.styleRef) &&
    builtInHeading(actual.styleRef)
  );
}

/** Typed state a written paragraph must have. */
export function wordInPlaceTypedIssue(
  expected: WordInPlaceExpected,
  actual: WordSourceBlock,
  styles: WordAuthoringSnapshot["styles"],
): "text" | "runs" | "type" | "format" | "style" | "list" | undefined {
  if (actual.text !== expected.text) return "text";
  if (actual.type !== expected.type || actual.level !== expected.level)
    return "type";
  if (actual.list !== expected.list || actual.ordered !== expected.ordered)
    return "list";
  if (!sameStyleRef(expected, actual, styles)) return "style";
  if (!sameFormat(actual.format, expected.format)) return "format";
  const typedRuns = actual.runs ?? [{ text: actual.text }];
  if (
    !sameWordInPlaceRuns(
      typedRuns.map((run) => ({
        text: run.text,
        bold: !!run.bold,
        italic: !!run.italic,
        underline: !!run.underline,
      })),
      expected.runs,
    ) ||
    typedRuns.some((run) => wordNonMarkRunProperties(run) !== expected.nonMark)
  )
    return "runs";
  return undefined;
}

type OpResult = WordInPlaceOp | WordInPlaceFallback;

interface Context {
  snapshot: WordAuthoringSnapshot;
  caps: WordInPlaceCapabilities;
  sources: Map<string, WordSourceBlock>;
  order: Map<string, number>;
  /** Removed by the plan: deleted, or merged into the block before them. */
  removed: Set<string>;
  /** Captured list members that leave their list. */
  leaving: Set<string>;
}

/** The surviving member of `list` closest to `near`, whose live List the paragraph joins. */
function listMember(
  ctx: Context,
  list: string,
  near: string,
  exclude?: string,
): string | undefined {
  const at = ctx.order.get(near) ?? 0;
  return ctx.snapshot.blocks
    .filter(
      (b) =>
        b.type === "list-item" &&
        b.list === list &&
        b.ref !== exclude &&
        !ctx.removed.has(b.ref) &&
        !ctx.leaving.has(b.ref),
    )
    .sort(
      (a, b) =>
        Math.abs(ctx.order.get(a.ref)! - at) -
        Math.abs(ctx.order.get(b.ref)! - at),
    )[0]?.ref;
}

/** The first problem with a block the object model has to create from nothing. */
function newParagraphIssue(
  block: WordPlanBlock,
): WordInPlaceFallback | undefined {
  if (!TYPED.has(block.type)) return "rich-block";
  if (block.type === "list-item" && !block.list?.startsWith("existing-"))
    return "new-list";
  const format = paragraphFormat(block);
  if (format && Object.keys(format).length) return "format";
  const runs = block.runs ?? [{ text: block.text }];
  if (
    runs.some(
      (run) =>
        run.underlineStyle ||
        wordNonMarkRunProperties(run) !== NO_RUN_PROPERTIES,
    )
  )
    return "run-format";
  if ([block, ...runs].some((run) => STRUCTURAL_TEXT.test(run.text)))
    return "source-shape";
  if (!block.text) return "empty-text";
  return undefined;
}

function textOp(
  source: WordSourceBlock,
  block: WordPlanBlock,
  ctx: Context,
): OpResult {
  const { snapshot, caps } = ctx;
  if (!TYPED.has(block.type)) return "rich-block";
  const from = sourceTyped(source);
  const to = blockTyped(block, snapshot);
  if (block.type === "list-item") {
    if (!block.list?.startsWith("existing-")) return "new-list";
    // Joining another list, or turning a numbered item into a bullet, needs new numbering.
    if (
      source.type === "list-item" &&
      (block.list !== source.list || !!block.ordered !== !!source.ordered)
    )
      return "new-list";
  }
  const restyled = styleChanged(from, to);
  const relisted = listChanged(from, to);
  if (restyled && !caps.restyle) return "restyle";
  // Word PC drops list membership when a list item's style is set (probe P6).
  if (
    restyled &&
    !caps.list &&
    (from.type === "list-item" || to.type === "list-item")
  )
    return "list";
  if (relisted && !caps.list) return "list";
  if (relisted && !caps.restyle) return "restyle";
  const format = paragraphFormat(block);
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
  const op: Extract<WordInPlaceOp, { kind: "text" }> = {
    kind: "text",
    ref: source.ref,
    paragraph: 0,
    runs: wordPlanBlockRuns({ ...block, format }),
    original: shape.runs,
  };
  if (!caps.marks && rewriteSetsMarks(op.runs, op.original))
    return "run-format";
  if (!restyled && !relisted) return op;
  const props = paragraphProperties(source);
  if (!props.clean) return "inherited-format";
  if (relisted && source.type === "list-item" && !props.numbered)
    return "not-invertible";
  const fromState = withStyle(from, snapshot);
  const toState = withStyle(to, snapshot);
  if (!fromState || !toState) return "restyle";
  if (relisted && to.type === "list-item") {
    const member = listMember(ctx, to.list!, source.ref, source.ref);
    if (!member) return "list";
    toState.listRef = member;
  }
  if (relisted && from.type === "list-item") {
    const member = listMember(ctx, from.list!, source.ref, source.ref);
    if (!member) return "not-invertible";
    fromState.listRef = member;
  }
  return { ...op, restyle: { from: fromState, to: toState } };
}

function insertOp(
  block: WordPlanBlock,
  anchor: { ref: string; location: "After" | "Before" },
  ctx: Context,
): OpResult {
  const { caps, snapshot } = ctx;
  if (!caps.insert) return "insert";
  const issue = newParagraphIssue(block);
  if (issue) return issue;
  if (block.type === "list-item" && !caps.list) return "list";
  if (!caps.restyle) return "restyle";
  if (!caps.delete) return "not-invertible";
  const runs = wordPlanBlockRuns({ ...block, format: undefined });
  if (!caps.marks && wordInPlaceRunsSetMarks(runs, NO_MARKS))
    return "run-format";
  const state = withStyle(blockTyped(block, snapshot), snapshot);
  if (!state) return "restyle";
  if (state.type === "list-item") {
    const member = listMember(ctx, state.list!, anchor.ref);
    if (!member) return "list";
    state.listRef = member;
  }
  return {
    kind: "insert",
    ref: anchor.ref,
    paragraph: 0,
    location: anchor.location,
    block: block.id,
    runs,
    state,
  };
}

/** Next to which captured paragraph a paragraph can be (re)created without inheriting anything the
 * object model cannot clear: the one before it, else the one after it. */
function anchorFor(
  before: string | undefined,
  after: string | undefined,
  ctx: Context,
): { ref: string; location: "After" | "Before" } | WordInPlaceFallback {
  for (const [ref, location] of [
    [before, "After"],
    [after, "Before"],
  ] as const) {
    const source = ref ? ctx.sources.get(ref) : undefined;
    if (!source || !TYPED.has(source.type)) continue;
    // Undoing a paragraph added after the final one would delete the final paragraph, which Word
    // keeps (see deleteOp).
    if (location === "After" && ctx.snapshot.blocks.at(-1)?.ref === source.ref)
      return "boundary";
    return paragraphProperties(source).clean
      ? { ref: source.ref, location }
      : "inherited-format";
  }
  return "boundary";
}

function deleteOp(ref: string, ctx: Context): OpResult {
  const { caps, snapshot } = ctx;
  if (!caps.delete) return "delete";
  const source = ctx.sources.get(ref);
  if (!source) return "program-mismatch";
  if (!TYPED.has(source.type)) return "native-target";
  if (
    !caps.insert ||
    !caps.restyle ||
    (source.type === "list-item" && !caps.list)
  )
    return "not-invertible";
  // Word keeps a final paragraph; deleting it would merge the body into the section properties.
  if (snapshot.blocks.at(-1)?.ref === ref) return "boundary";
  const props = paragraphProperties(source);
  if (!props.clean || (source.type === "list-item" && !props.numbered))
    return "not-invertible";
  const shape = wordInPlaceSourceRuns(parse(source.xml));
  if ("fallback" in shape || shape.nonMark !== NO_RUN_PROPERTIES)
    return "not-invertible";
  if (!caps.marks && wordInPlaceRunsSetMarks(shape.runs, NO_MARKS))
    return "not-invertible";
  const state = withStyle(sourceTyped(source), snapshot);
  if (!state) return "not-invertible";
  if (state.type === "list-item") {
    const member = listMember(ctx, state.list!, ref, ref);
    if (!member) return "not-invertible";
    state.listRef = member;
  }
  const index = ctx.order.get(ref)!;
  const neighbour = (step: number) => {
    for (let i = index + step; i >= 0 && i < snapshot.blocks.length; i += step)
      if (!ctx.removed.has(snapshot.blocks[i].ref))
        return snapshot.blocks[i].ref;
    return undefined;
  };
  const anchor = anchorFor(neighbour(-1), neighbour(1), ctx);
  if (typeof anchor === "string") return anchor;
  return {
    kind: "delete",
    ref,
    paragraph: 0,
    original: shape.runs,
    state,
    recreate: anchor.location,
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

const survivors = (entry: WordPlanEntry) =>
  entry.kind === "keep"
    ? entry.source
    : entry.kind === "replace"
      ? [entry.source[0]]
      : [];

/** Word merges adjacent tables, and the object model cannot keep two such blocks apart. */
function joinsNonParagraphs(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  order: Map<string, number>,
): boolean {
  const output = wordPlanOutput(plan, snapshot);
  return output.some((entry, i) => {
    const previous = output[i - 1];
    if (
      !previous ||
      TYPED.has(entry.block.type) ||
      TYPED.has(previous.block.type)
    )
      return false;
    const a = order.get(previous.source.at(-1) ?? "");
    const b = order.get(entry.source[0] ?? "");
    return (
      previous.kind === "insert" ||
      entry.kind === "insert" ||
      a === undefined ||
      b === undefined ||
      b !== a + 1
    );
  });
}

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
  const { ops, failures } = classify(plan, snapshot, caps, compiled);
  const first = ladder(failures);
  if (first) return { fallback: first };
  if (!sameProgram(plan, snapshot, ops, compiled))
    return { fallback: "program-mismatch" };
  return { ops };
}

/** Every routing rule the plan fails, in ladder order; empty when it can be written in place. */
export function wordInPlaceFallbacks(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  caps: WordInPlaceCapabilities,
  compiled?: WordAuthoringSnapshot,
): WordInPlaceFallback[] {
  const { ops, failures } = classify(plan, snapshot, caps, compiled);
  if (!failures.size && !sameProgram(plan, snapshot, ops, compiled))
    failures.add("program-mismatch");
  return WORD_IN_PLACE_FALLBACKS.filter((code) => failures.has(code));
}

/** Story ops were matched against the dry-run compile when they were derived. */
const sameProgram = (
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  ops: readonly WordInPlaceOp[],
  compiled: WordAuthoringSnapshot | undefined,
) => {
  const body = ops.filter((op) => op.kind !== "text" || !op.story);
  return (
    sameWordInPlaceProgram(plan, snapshot, body) &&
    (!compiled || matchesCompiledOutput(snapshot, body, compiled))
  );
};

const STORY_HOST_TYPES: Record<
  keyof WordSectionStories,
  WordInPlaceStoryTarget["type"]
> = { default: "Primary", first: "FirstPage", even: "EvenPages" };

/** The single section reference through which the object model reaches a header or footer. A story
 * the next section inherits, or one several references share, has none. */
export function wordStoryReference(
  snapshot: Pick<WordAuthoringSnapshot, "sections">,
  id: string,
  kind: "header" | "footer",
): Pick<WordInPlaceStoryTarget, "section" | "type"> | undefined {
  const sections = snapshot.sections ?? [];
  const references = sections.flatMap((section, i) =>
    Object.entries(kind === "header" ? section.headers : section.footers)
      .filter(([, story]) => story === id)
      .map(([type]) => ({ section: i, key: type as keyof WordSectionStories })),
  );
  if (references.length !== 1) return undefined;
  const [{ section, key }] = references;
  const next = sections[section + 1];
  if (next && !(kind === "header" ? next.headers : next.footers)[key])
    return undefined;
  return { section, type: STORY_HOST_TYPES[key] };
}

/** Text and run-mark rewrites of existing header/footer paragraphs, paired 1:1 with the dry-run
 * compile; any other story change needs the import. */
function storyOps(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  caps: WordInPlaceCapabilities,
  compiled: WordAuthoringSnapshot | undefined,
): WordInPlaceOp[] | WordInPlaceFallback {
  const ops: WordInPlaceOp[] = [];
  if (!compiled) return "stories";
  const sourceSignature = createNativeContentSignature(snapshot.ooxml);
  const outputSignature = createNativeContentSignature(compiled.ooxml);
  const serializer = new XMLSerializer();
  const properties = (
    p: Element,
    signature: typeof sourceSignature,
    part: string,
  ) => {
    const props = children(p, "pPr")[0];
    return props ? signature(serializer.serializeToString(props), part) : "";
  };
  const paragraphs = (xml: string) => {
    const root = parse(xml);
    return children(root).every((c) => isW(c, "p"))
      ? children(root)
      : undefined;
  };
  for (const change of plan.stories ?? []) {
    if (
      change.kind !== "upsert" ||
      (change.type !== "header" && change.type !== "footer") ||
      change.anchor ||
      change.author !== undefined ||
      change.initials !== undefined
    )
      return "stories";
    const kind = change.type;
    const source = snapshot.stories?.find(
      (s) => s.id === change.id && s.type === kind,
    );
    const reference = source && wordStoryReference(snapshot, source.id, kind);
    const output = compiled.stories?.find((s) => s.id === change.id);
    if (!source || !reference || !output || output.part !== source.part)
      return "stories";
    const from = paragraphs(source.xml);
    const to = paragraphs(output.xml);
    const blocks = change.blocks ?? [];
    if (
      !from ||
      !to ||
      from.length !== blocks.length ||
      to.length !== blocks.length
    )
      return "stories";
    for (const [index, block] of blocks.entries()) {
      const shape = wordInPlaceSourceRuns(from[index]);
      if ("fallback" in shape || block.type !== "paragraph") return "stories";
      const format = paragraphFormat(block);
      const targetRuns = block.runs ?? [{ text: block.text }];
      if (
        (format && Object.keys(format).length) ||
        targetRuns.some(
          (run) =>
            run.underlineStyle ||
            wordNonMarkRunProperties(run) !== shape.nonMark,
        ) ||
        [block, ...targetRuns].some((run) => STRUCTURAL_TEXT.test(run.text)) ||
        properties(from[index], sourceSignature, source.part) !==
          properties(to[index], outputSignature, output.part)
      )
        return "stories";
      const runs = wordPlanBlockRuns(block);
      if (sameWordInPlaceRuns(runs, shape.runs)) continue;
      if (!caps.marks && rewriteSetsMarks(runs, shape.runs)) return "stories";
      if (
        !block.text ||
        !shape.runs.length ||
        WORD_REVISION_ELEMENTS.some(
          (name) => from[index].getElementsByTagNameNS(W, name).length > 0,
        )
      )
        return "stories";
      ops.push({
        kind: "text",
        ref: source.id,
        paragraph: index,
        runs,
        original: shape.runs,
        story: { kind, part: source.part, ...reference },
      });
    }
  }
  if (ops.length && !caps.storyText) return "story-text";
  return ops;
}

function classify(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  caps: WordInPlaceCapabilities,
  compiled: WordAuthoringSnapshot | undefined,
): { ops: WordInPlaceOp[]; failures: Set<WordInPlaceFallback> } {
  const failures = new Set<WordInPlaceFallback>();
  const stories = plan.stories?.length
    ? storyOps(plan, snapshot, caps, compiled)
    : [];
  if (typeof stories === "string") failures.add(stories);
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
  const removed = new Set(plan.deleted.flatMap((d) => d.source));
  const leaving = new Set<string>();
  for (const entry of plan.entries) {
    if (entry.kind !== "replace") continue;
    entry.source.slice(1).forEach((ref) => removed.add(ref));
    const source = sources.get(entry.source[0]);
    const block = entry.blocks[0];
    if (
      source?.type === "list-item" &&
      (block.type !== "list-item" || block.list !== source.list)
    )
      leaving.add(source.ref);
  }
  const ctx: Context = { snapshot, caps, sources, order, removed, leaving };
  const ops: WordInPlaceOp[] = [];
  const add = (result: OpResult) => {
    if (typeof result === "string") failures.add(result);
    else if (
      (result.kind === "text" || result.kind === "cell") &&
      !caps[result.kind]
    )
      failures.add("not-invertible");
    else ops.push(result);
  };
  const nextSurvivor = (index: number) =>
    plan.entries.slice(index + 1).flatMap(survivors)[0];
  let previous: string | undefined;
  for (const [index, entry] of plan.entries.entries()) {
    if (entry.kind === "keep") {
      previous = entry.source.at(-1);
      continue;
    }
    if (entry.kind === "insert") {
      const anchor = caps.insert
        ? anchorFor(previous, nextSurvivor(index), ctx)
        : "insert";
      if (typeof anchor === "string") failures.add(anchor);
      else for (const block of entry.blocks) add(insertOp(block, anchor, ctx));
      continue;
    }
    // N sources to M blocks: rewrite them pairwise, then insert the extra blocks after the last pair or
    // delete the extra sources.
    const pairs = Math.min(entry.source.length, entry.blocks.length);
    const reshaped = entry.source.length > 1 || entry.blocks.length > 1;
    previous = entry.source[pairs - 1];
    if (reshaped && !caps.split) {
      failures.add("split");
      continue;
    }
    for (let i = 0; i < pairs; i++) {
      const source = sources.get(entry.source[i]);
      if (!source) failures.add("program-mismatch");
      else if (source.type === "native")
        add(reshaped ? "native-target" : cellOp(source, entry.blocks[i]));
      else add(textOp(source, entry.blocks[i], ctx));
    }
    const extra = entry.blocks.slice(pairs);
    if (extra.length) {
      const anchor = caps.insert
        ? anchorFor(previous, undefined, ctx)
        : "insert";
      if (typeof anchor === "string") failures.add(anchor);
      else for (const block of extra) add(insertOp(block, anchor, ctx));
    }
    for (const ref of entry.source.slice(pairs)) add(deleteOp(ref, ctx));
  }
  for (const deletion of plan.deleted)
    for (const ref of deletion.source) add(deleteOp(ref, ctx));
  if (typeof stories !== "string") stories.forEach(add);
  if (removed.size && joinsNonParagraphs(plan, snapshot, order))
    failures.add("boundary");
  if (ops.length > MAX_WORD_IN_PLACE_OPS) failures.add("too-many-ops");
  return { ops, failures };
}

export type WordInPlaceSlot =
  | { kind: "keep"; ref: string }
  | { kind: "op"; op: Exclude<WordInPlaceOp, { kind: "delete" }> };

/** The block sequence the ops leave: deleted blocks gone, inserted ones next to their anchors. */
export function materializeWordInPlaceOps(
  refs: readonly string[],
  ops: readonly WordInPlaceOp[],
  refOf: (op: WordInPlaceOp) => string | undefined = (op) => op.ref,
): WordInPlaceSlot[] | null {
  const known = new Set(refs);
  const byRef = new Map<string, WordInPlaceOp>();
  const inserted = new Map<string, WordInPlaceOp[]>();
  for (const op of ops) {
    const ref = refOf(op);
    if (ref === undefined || !known.has(ref)) return null;
    if (op.kind === "insert") {
      const key = `${op.location}:${ref}`;
      inserted.set(key, [...(inserted.get(key) ?? []), op]);
    } else if (byRef.has(ref)) return null;
    else byRef.set(ref, op);
  }
  const slots: WordInPlaceSlot[] = [];
  const place = (key: string) =>
    (inserted.get(key) ?? []).forEach((op) => {
      if (op.kind === "insert") slots.push({ kind: "op", op });
    });
  for (const ref of refs) {
    const op = byRef.get(ref);
    if (op?.kind === "delete") {
      if (inserted.has(`Before:${ref}`) || inserted.has(`After:${ref}`))
        return null;
      continue;
    }
    place(`Before:${ref}`);
    slots.push(op ? { kind: "op", op } : { kind: "keep", ref });
    place(`After:${ref}`);
  }
  return slots;
}

function blockExpected(
  block: WordPlanBlock,
  snapshot: WordAuthoringSnapshot,
): WordInPlaceExpected {
  const format = paragraphFormat(block);
  const runs = wordPlanBlockRuns({ ...block, format });
  return {
    ...blockTyped(block, snapshot),
    ...(format && Object.keys(format).length ? { format } : {}),
    text: block.text,
    runs,
    nonMark: NO_RUN_PROPERTIES,
  };
}

const sameTyped = (a: WordInPlaceExpected, b: WordInPlaceExpected) =>
  a.text === b.text &&
  stableJson(a.runs) === stableJson(b.runs) &&
  a.type === b.type &&
  a.level === b.level &&
  a.list === b.list &&
  a.ordered === b.ordered &&
  effectiveWordStyle(a.styleRef) === effectiveWordStyle(b.styleRef) &&
  sameFormat(a.format, b.format);

/** The ops, applied to the captured blocks, must produce exactly the plan's output. */
export function sameWordInPlaceProgram(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
  ops: readonly WordInPlaceOp[],
): boolean {
  const slots = materializeWordInPlaceOps(
    snapshot.blocks.map((b) => b.ref),
    ops,
  );
  const output = wordPlanOutput(plan, snapshot);
  if (!slots || output.length !== slots.length) return false;
  const sources = new Map(snapshot.blocks.map((b) => [b.ref, b]));
  /** Where each block sits in its replace entry, which pairs the first min(N, M) sources and blocks. */
  const positions = new Map(
    plan.entries.flatMap((e) =>
      e.kind === "replace"
        ? e.blocks.map((block, index) => [
            block,
            {
              index,
              source: e.source,
              pairs: Math.min(e.source.length, e.blocks.length),
            },
          ])
        : [],
    ),
  );
  return slots.every((slot, i) => {
    const entry = output[i];
    if (slot.kind === "keep")
      return entry.kind === "keep" && entry.source[0] === slot.ref;
    if (entry.kind === "keep") return false;
    const { op } = slot;
    const block = entry.block as WordPlanBlock;
    if (op.kind === "cell") {
      if (
        entry.kind !== "replace" ||
        entry.source.length !== 1 ||
        entry.source[0] !== op.ref ||
        block.type !== "table"
      )
        return false;
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
    // A replace entry rewrites its sources pairwise; blocks beyond the pairs are inserted after the
    // last paired source.
    const at = positions.get(block);
    if (
      op.kind === "text"
        ? entry.kind !== "replace" ||
          !at ||
          at.index >= at.pairs ||
          at.source[at.index] !== op.ref
        : entry.kind === "replace" &&
          (!at ||
            at.index < at.pairs ||
            op.location !== "After" ||
            at.source[at.pairs - 1] !== op.ref)
    )
      return false;
    if (!TYPED.has(block.type)) return false;
    return sameTyped(
      blockExpected(block, snapshot),
      expectedOf(op, sources.get(op.ref)),
    );
  });
}

/** Cross-check against the dry-run compile: the import route would produce the same typed blocks. */
function matchesCompiledOutput(
  snapshot: WordAuthoringSnapshot,
  ops: readonly WordInPlaceOp[],
  compiled: WordAuthoringSnapshot,
): boolean {
  const slots = materializeWordInPlaceOps(
    snapshot.blocks.map((b) => b.ref),
    ops,
  );
  if (!slots || compiled.blocks.length !== slots.length) return false;
  const sources = new Map(snapshot.blocks.map((b) => [b.ref, b]));
  return slots.every((slot, i) => {
    if (slot.kind === "keep") return true;
    const { op } = slot;
    const actual = compiled.blocks[i];
    if (op.kind === "cell")
      return (
        actual.content?.rows
          .find((row) => row.sourceIndex === op.rowIndex)
          ?.cells.find((cell) => cell.sourceIndex === op.cellIndex)?.text ===
        op.text
      );
    return !wordInPlaceTypedIssue(
      expectedOf(op, sources.get(op.ref)),
      actual,
      compiled.styles,
    );
  });
}
