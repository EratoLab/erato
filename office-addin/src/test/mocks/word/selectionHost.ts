import { vi } from "vitest";

import type { Mock } from "vitest";

/**
 * A character-level Word host for selection-based editing (ERMAIN-928). Every paragraph is a
 * sequence of tokens (one per UTF-16 unit, plus pictures, footnote references, comment marks and
 * the paragraph mark), so a range is a pair of token boundaries and moves with edits as a desktop
 * Range does (a tracked web range keeps its offsets instead). Text, offsets and write behaviour
 * follow the native probes recorded in
 * erato-word-benchmarks-selection-v2/results/word-selection-v2-report.md ("SV2:<line>") and
 * ermain-928-preflight-report.md ("P<n>", "impact <n>").
 *
 * Office.js calls queue commands that run at context.sync(), in order, and a rejected sync keeps
 * the commands before the failure, as Word does. Properties must be loaded before they are read.
 */

export type WordSelectionHostFlavour = "mac" | "pc" | "web";
export type WordRequirementFlavour = "m365" | "web" | "ltsc2024" | "ltsc2021";
export type MockTrackingMode = "Off" | "TrackAll" | "TrackMineOnly";
export type MockSelectionStory =
  | "body"
  | "header"
  | "footer"
  | "footnote"
  | "textbox"
  | "comment";

export interface MockSelectionFont {
  bold?: boolean;
  italic?: boolean;
  underline?: string;
  strikeThrough?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  color?: string;
  highlightColor?: string | null;
  name?: string;
  size?: number;
  hidden?: boolean;
  boldBidirectional?: boolean;
  italicBidirectional?: boolean;
  sizeBidirectional?: number;
  nameBidirectional?: string;
  /** w:rtl; Word.Font has no property for it. */
  rtl?: boolean;
}

export interface MockSelectionRun {
  text?: string;
  font?: MockSelectionFont;
  hidden?: boolean;
  rStyle?: string;
  /** Consecutive runs with the same URL form one hyperlink. */
  link?: string;
  /** Field instruction; `text` is the field result. Consecutive runs with the same code form one field. */
  field?: string;
  /** Content-control tag; consecutive runs with the same tag form one control. */
  sdt?: string;
  /** Author of a tracked insertion. */
  inserted?: string;
  /** Author of a tracked deletion. */
  deleted?: string;
  picture?: boolean;
  footnote?: boolean;
  /** The reference mark at the end of a comment's range. */
  comment?: boolean;
  /**
   * Bookmark name, or several names for bookmarks around the same text; consecutive runs with the
   * same name form one bookmark around their text, its bookmarkStart and bookmarkEnd inside the
   * paragraph's own w:p as BM0 measured on Word PC and the web. Word for Mac was not measured;
   * `ooxmlOmitsBookmarks` models it leaving them out.
   */
  bookmark?: string | readonly string[];
}

export interface MockSelectionParagraphSpec {
  runs: string | readonly (string | MockSelectionRun)[];
  id?: string;
  style?: string;
  list?: boolean;
}
export type MockSelectionParagraph = string | MockSelectionParagraphSpec;
export interface MockSelectionTable {
  table: readonly (readonly MockSelectionCell[])[];
}
export type MockSelectionCell = string | readonly MockSelectionBlock[];
export type MockSelectionBlock = MockSelectionParagraph | MockSelectionTable;

export interface MockSelectionDocument {
  body: readonly MockSelectionBlock[];
  header?: readonly MockSelectionBlock[];
  footer?: readonly MockSelectionBlock[];
  footnotes?: readonly MockSelectionParagraph[];
  textBox?: readonly MockSelectionParagraph[];
  comments?: readonly MockSelectionParagraph[];
}

export interface MockSelectionStyle {
  type?: "paragraph" | "character";
  basedOn?: string;
  font?: MockSelectionFont;
}

/** Where a test points: the harness's `Spec` (selection-v2/probe.ts), resolved against the live model. */
export interface MockSelectionTarget {
  story?: MockSelectionStory;
  /** Paragraph tag: the paragraph whose text starts with "<p> ". */
  p?: string;
  paragraph?: number;
  /** Text inside the paragraph, matched against its non-deleted characters. */
  text?: string;
  occ?: number;
  part?: "Whole" | "Content" | "Start" | "End";
  to?: MockSelectionTarget;
  table?: number;
  cell?: readonly [number, number];
  tableWhole?: boolean;
  picture?: number;
  collapse?: "Start" | "End";
}

export interface WordSelectionHostOptions {
  host?: WordSelectionHostFlavour;
  /** Defaults to "web" on the web host and "m365" elsewhere. */
  requirements?: WordRequirementFlavour;
  /** Defaults to true on ltsc2024: documented for single-purchase Office (office-js #4258), not measured. */
  nullParagraphIds?: boolean;
  trackingMode?: MockTrackingMode;
  styles?: Readonly<Record<string, MockSelectionStyle>>;
  url?: string;
  /** Body paragraph tags, in document order, whose mark ends a section. */
  sectionBreaks?: readonly string[];
  /** Search matches straight and curly quotes alike, as Word's Find does. */
  searchMatchesQuoteVariants?: boolean;
  /**
   * getOoxml() of a paragraph that ends a cell returns its whole table row, as Word for Mac and
   * Word PC do (ERMAIN-928 block 3). Defaults to true off the web.
   */
  cellParagraphOoxmlIsRow?: boolean;
  /** getOoxml() shows no bookmark, as Word for Mac's might: BM0 did not run there. */
  ooxmlOmitsBookmarks?: boolean;
  /**
   * Rewrites what Paragraph.getOoxml() returns, given the paragraph's text, for markup the model
   * does not hold: the lone end of a bookmark from another paragraph, marks between paragraphs.
   * What Word returns there was not measured.
   */
  paragraphOoxml?: (ooxml: string, text: string) => string;
}

/** Rewrites the hits a search returns; the hits are opaque, so it can only reorder, drop or repeat. */
export type MockSearchHook = <T>(hits: readonly T[], needle: string) => T[];

export interface MockRunSummary {
  text: string;
  object?: "picture" | "footnote" | "comment";
  font?: MockSelectionFont;
  rStyle?: string;
  bookmarks?: string[];
  link?: string;
  field?: string;
  sdt?: string;
  inserted?: string;
  deleted?: string;
}

export interface MockParagraphState {
  /** The real ID, also when the host reports null. */
  id: string;
  /** Every character that is not a tracked deletion, hidden text included. */
  text: string;
  style: string;
  list: boolean;
  nesting: number;
  runs: MockRunSummary[];
}

export interface MockRevision {
  type: "Added" | "Deleted" | "Formatted";
  text: string;
  author: string;
}

export interface MockSyncEntry {
  index: number;
  context: number;
  commands: string[];
  writes: string[];
}

export interface MockSyncHang {
  /** Resolves with the sync's index once that sync is called. */
  reached: Promise<number>;
  release(): void;
}

export interface WordSelectionHost {
  readonly host: WordSelectionHostFlavour;
  readonly requirements: WordRequirementFlavour;
  run: Mock<(...args: unknown[]) => Promise<unknown>>;
  isSetSupported: Mock<(name: string, version?: string) => boolean>;
  addHandlerAsync: Mock<(...args: unknown[]) => void>;
  removeHandlerAsync: Mock<(...args: unknown[]) => void>;
  /** Moves the selection as the user does; a changed selection fires one event (SV2:66). */
  select(target: MockSelectionTarget, options?: { event?: boolean }): void;
  selectionText(): string;
  fireSelectionChanged(): void;
  handlerCount(): number;
  /** Delays addHandlerAsync callbacks until the returned function runs. */
  holdHandlerRegistration(): () => void;
  failHandlerRegistration(message: string | null): void;
  paragraphs(story?: MockSelectionStory): MockParagraphState[];
  /** The host's Range.text of the target. */
  text(target: MockSelectionTarget): string;
  ooxml(target: MockSelectionTarget): string;
  /** User edits: tracked when Track Changes is on, and they fire no selection event. */
  insertText(
    target: MockSelectionTarget,
    text: string,
    location?: "Replace" | "Start" | "End",
  ): void;
  deleteParagraphs(target: MockSelectionTarget): void;
  /** Merges a body table's cell into the one before it in its row; the body keeps its paragraphs. */
  mergeCellIntoPrevious(table: number, cell: readonly [number, number]): void;
  insertParagraphs(
    target: MockSelectionTarget,
    paragraphs: readonly MockSelectionParagraph[],
    location: "Before" | "After",
  ): void;
  setParagraphStyle(target: MockSelectionTarget, style: string): void;
  format(target: MockSelectionTarget, run: MockSelectionRun): void;
  /** Takes the target's text, at the edge of its bookmarks, out of them, as if they had moved. */
  clearBookmarks(target: MockSelectionTarget): void;
  setTrackingMode(mode: MockTrackingMode): void;
  /** Body paragraph tags, in document order, whose mark ends a section. */
  setSectionBreaks(tags: readonly string[]): void;
  trackingMode(): MockTrackingMode;
  revisions(): MockRevision[];
  rejectAllRevisions(): void;
  acceptAllRevisions(): void;
  syncCount(): number;
  syncLog(): MockSyncEntry[];
  writeSyncs(): MockSyncEntry[];
  /** Runs before the queued commands of every sync; edits made here race the batch. */
  beforeSync(hook: (index: number) => void): () => void;
  afterSync(hook: (index: number) => void): () => void;
  /** Applies to every search until removed. */
  onSearch(hook: MockSearchHook): () => void;
  /**
   * Holds a sync (the next one, or the one with index `at`) until released. By default its
   * commands run on release; "immediately" runs them first, as a host whose reply is late.
   */
  hangSync(options?: {
    at?: number;
    execute?: "on-release" | "immediately";
  }): MockSyncHang;
  /** Every Office.js method called, as "Type.method". */
  calls(): string[];
}

/** Requirement sets per flavour: plan §4; m365 as measured (SV2:11-12), web as the native probe reported it. */
export const WORD_REQUIREMENT_LEVELS: Readonly<
  Record<WordRequirementFlavour, Readonly<Record<string, string>>>
> = {
  m365: { WordApi: "1.9", WordApiDesktop: "1.5", WordApiHiddenDocument: "1.5" },
  web: { WordApi: "1.11", WordApiOnline: "1.1" },
  ltsc2024: { WordApi: "1.8", WordApiDesktop: "1.1" },
  ltsc2021: { WordApi: "1.3" },
};

/** The set each gated API needs (plan §4); using it below that level fails the sync with ApiNotFound. */
export const WORD_SELECTION_API_SETS: Readonly<
  Record<string, readonly [string, string]>
> = {
  "Paragraph.getText": ["WordApi", "1.7"],
  "Paragraph.uniqueLocalId": ["WordApi", "1.6"],
  "Document.getParagraphByUniqueLocalId": ["WordApi", "1.6"],
  "Document.changeTrackingMode": ["WordApi", "1.4"],
  "Document.getStyles": ["WordApi", "1.5"],
  "Range.getTrackedChanges": ["WordApi", "1.6"],
  "Range.inlinePictures": ["WordApi", "1.2"],
  "Range.compareLocationWith": ["WordApi", "1.3"],
  "Range.expandTo": ["WordApi", "1.3"],
  "Range.getRange": ["WordApi", "1.3"],
  "Range.parentBody": ["WordApi", "1.3"],
  "Range.parentTableCellOrNullObject": ["WordApi", "1.3"],
  "Range.isEmpty": ["WordApi", "1.3"],
  "Range.styleBuiltIn": ["WordApi", "1.3"],
  "Body.type": ["WordApi", "1.3"],
  "Paragraph.tableNestingLevel": ["WordApi", "1.3"],
  "Paragraph.isListItem": ["WordApi", "1.3"],
  "Font.hidden": ["WordApiDesktop", "1.2"],
  "Font.bidirectional": ["WordApiDesktop", "1.3"],
  // Plan §4 lists WordApiDesktop 1.3; the office-js typings place it in WordApi 1.3.
  "Range.getHyperlinkRanges": ["WordApi", "1.3"],
  // PF3: the object-model hazard checks a span's OOXML cannot replace.
  "Range.hyperlink": ["WordApi", "1.3"],
  "Range.contentControls": ["WordApi", "1.1"],
  "Range.parentContentControlOrNullObject": ["WordApi", "1.3"],
  "Range.fields": ["WordApi", "1.4"],
  "Range.getReviewedText": ["WordApi", "1.4"],
  "Range.getBookmarks": ["WordApi", "1.4"],
  "Table.getRange": ["WordApi", "1.3"],
};

const OTHER_AUTHOR = "Other Author";

/** The SV2 main.docx fixture, tag for tag (fixtures.mjs of the selection-v2 harness). */
export const SV2_MAIN_DOCUMENT: MockSelectionDocument = {
  body: [
    { runs: "H1 Selection probe heading", style: "Heading 1" },
    {
      runs: [
        "MX1 Alpha ",
        { text: "bravo", font: { bold: true } },
        " ",
        { text: "charlie", font: { italic: true } },
        " delta echo foxtrot ",
        { text: "link", link: "https://example.com/" },
        " golf ",
        { text: "2026-10-06", field: 'DATE \\@ "yyyy-MM-dd"' },
        " hotel india.",
      ],
    },
    "PL1 Plain paragraph kilo lima mike november oscar papa.",
    {
      runs: "LI1 List item quebec romeo.",
      style: "List Paragraph",
      list: true,
    },
    {
      runs: "LI2 List item sierra tango.",
      style: "List Paragraph",
      list: true,
    },
    "MP1 Multi paragraph uniform victor whiskey.",
    "MP2 Multi paragraph uniform xray yankee.",
    "MP3 Multi paragraph uniform zulu omega.",
    {
      runs: [
        "FD1 Field before ",
        { text: "2026-10-06", field: 'DATE \\@ "yyyy-MM-dd"' },
        " field after words.",
      ],
    },
    {
      runs: [
        "HT1 Hidden before ",
        { text: "SECRET ", hidden: true },
        "hidden after words.",
      ],
    },
    {
      runs: [
        "TC1 Tracked ",
        { text: "inserted words ", inserted: OTHER_AUTHOR },
        "kept ",
        { text: "deleted words ", deleted: OTHER_AUTHOR },
        "end words.",
      ],
    },
    {
      runs: [
        "CM1 Commented anchor phrase",
        { comment: true },
        " after comment.",
      ],
    },
    {
      runs: [
        "FN1 Footnote host sentence",
        { footnote: true },
        " continues here.",
      ],
    },
    "RT1 مرحبا بالعالم ABC 123 هذا اختبار نهائي.",
    { runs: ["PC1 Picture: ", { picture: true }, " after picture."] },
    {
      table: [
        ["CA1 Cell A1 text", "CB1 Cell B1 text"],
        ["CA2 Cell A2 text", "CB2 Cell B2 text"],
      ],
    },
    "RP1 Repeated word one. Repeated word one. Repeated word one.",
  ],
  header: [
    "HD1 Header text line",
    { table: [["HC1 Header cell one", "HC2 Header cell two"]] },
  ],
  footer: ["FT1 Footer text line"],
  footnotes: [{ runs: [{ footnote: true }, " FN1 Footnote body words here."] }],
  textBox: ["TB1 Inside text box words."],
  comments: [{ runs: [{ comment: true }, "Probe comment text."] }],
};

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const WP =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const AUTHOR = "Mock Author";
const REVISION_DATE = "2026-10-08T00:00:00Z";
const SELECTION_CHANGED = "documentSelectionChanged";
const PLATFORM: Record<WordSelectionHostFlavour, string> = {
  mac: "Mac",
  pc: "PC",
  web: "OfficeOnline",
};
/** A programmatic select() raises its event this long after the sync (SV2:64). */
const SELECT_EVENT_DELAY_MS: Record<WordSelectionHostFlavour, number> = {
  mac: 350,
  pc: 230,
  web: 90,
};

type FontKey = Exclude<keyof MockSelectionFont, "rtl">;
const FONT_KEYS: readonly FontKey[] = [
  "bold",
  "italic",
  "underline",
  "strikeThrough",
  "superscript",
  "subscript",
  "color",
  "highlightColor",
  "name",
  "size",
  "hidden",
  "boldBidirectional",
  "italicBidirectional",
  "sizeBidirectional",
  "nameBidirectional",
];
const DEFAULT_FONT: Required<Pick<MockSelectionFont, FontKey>> = {
  bold: false,
  italic: false,
  underline: "None",
  strikeThrough: false,
  superscript: false,
  subscript: false,
  color: "#000000",
  highlightColor: null,
  name: "Calibri",
  size: 11,
  hidden: false,
  boldBidirectional: false,
  italicBidirectional: false,
  sizeBidirectional: 11,
  nameBidirectional: "Times New Roman",
};
/** The complex-script twin each Office.js font set also writes on Word for the web. */
const WEB_FONT_TWINS: Partial<Record<FontKey, FontKey>> = {
  bold: "boldBidirectional",
  italic: "italicBidirectional",
  size: "sizeBidirectional",
  name: "nameBidirectional",
};
const fontApi = (key: FontKey): string | undefined =>
  key === "hidden"
    ? "Font.hidden"
    : key.endsWith("Bidirectional")
      ? "Font.bidirectional"
      : undefined;

const UNDERLINE_TO_OOXML: Record<string, string> = {
  None: "none",
  Single: "single",
  Double: "double",
  Word: "words",
  Dotted: "dotted",
  Thick: "thick",
  Wave: "wave",
  DashLine: "dash",
};

interface StyleDef {
  name: string;
  id: string;
  ooxmlName: string;
  type: "paragraph" | "character";
  basedOn?: string;
  builtIn: string;
  font: MockSelectionFont;
}

const BUILT_IN_STYLES: readonly StyleDef[] = [
  {
    name: "Normal",
    id: "Normal",
    ooxmlName: "Normal",
    type: "paragraph",
    builtIn: "Normal",
    font: {},
  },
  ...[1, 2, 3].map(
    (level): StyleDef => ({
      name: `Heading ${level}`,
      id: `Heading${level}`,
      ooxmlName: `heading ${level}`,
      type: "paragraph",
      basedOn: "Normal",
      builtIn: `Heading${level}`,
      font: {
        bold: true,
        size: [16, 13, 12][level - 1],
        color: "#2F5496",
        name: "Calibri Light",
      },
    }),
  ),
  {
    name: "List Paragraph",
    id: "ListParagraph",
    ooxmlName: "List Paragraph",
    type: "paragraph",
    basedOn: "Normal",
    builtIn: "ListParagraph",
    font: {},
  },
  {
    name: "Header",
    id: "Header",
    ooxmlName: "header",
    type: "paragraph",
    basedOn: "Normal",
    builtIn: "Header",
    font: {},
  },
  {
    name: "Footer",
    id: "Footer",
    ooxmlName: "footer",
    type: "paragraph",
    basedOn: "Normal",
    builtIn: "Footer",
    font: {},
  },
  {
    name: "Footnote Text",
    id: "FootnoteText",
    ooxmlName: "footnote text",
    type: "paragraph",
    basedOn: "Normal",
    builtIn: "FootnoteText",
    font: { size: 10 },
  },
  {
    name: "Comment Text",
    id: "CommentText",
    ooxmlName: "annotation text",
    type: "paragraph",
    basedOn: "Normal",
    builtIn: "Other",
    font: { size: 10 },
  },
  {
    name: "Footnote Reference",
    id: "FootnoteReference",
    ooxmlName: "footnote reference",
    type: "character",
    builtIn: "Other",
    font: { superscript: true },
  },
  {
    name: "Hyperlink",
    id: "Hyperlink",
    ooxmlName: "Hyperlink",
    type: "character",
    builtIn: "Other",
    font: { color: "#0563C1", underline: "Single" },
  },
  {
    name: "Strong",
    id: "Strong",
    ooxmlName: "Strong",
    type: "character",
    builtIn: "Other",
    font: { bold: true },
  },
];

const DEFAULT_STORY_STYLE: Record<MockSelectionStory, string> = {
  body: "Normal",
  header: "Header",
  footer: "Footer",
  footnote: "Footnote Text",
  textbox: "Normal",
  comment: "Comment Text",
};

interface Revision {
  id: number;
  kind: "ins" | "del" | "format";
  author: string;
  date: string;
  pair?: Revision;
}
interface LinkState {
  url: string;
}
interface FieldState {
  code: string;
}
interface SdtState {
  tag: string;
}
interface BookmarkState {
  name: string;
  id: number;
}
interface RunState {
  font: MockSelectionFont;
  rStyle?: string;
  /** Not wrappers: their starts and ends sit between runs, in the order they were opened. */
  bookmarks?: readonly BookmarkState[];
  link?: LinkState;
  field?: FieldState;
  sdt?: SdtState;
  ins?: Revision;
  del?: Revision;
  /** w:rPrChange: the direct formatting before a tracked format change. */
  formatChange?: { revision: Revision; font: MockSelectionFont };
}
interface TableState {
  nesting: number;
}
interface CellState {
  table: TableState;
  row: number;
  col: number;
}
interface ParaState {
  id: string;
  style: string;
  list: boolean;
  cells: readonly CellState[];
  cellEnd: boolean;
}
type TokenKind =
  | "char"
  | "picture"
  | "footnote"
  | "comment"
  | "mark"
  | "rowEnd"
  | "edge";
interface Token {
  kind: TokenKind;
  ch: string;
  run: RunState;
  para?: ParaState;
  /** rowEnd: its table, and the cells around that table. */
  table?: TableState;
  outer?: readonly CellState[];
  dead?: boolean;
  next?: Token;
  prev?: Token;
}
interface Story {
  kind: MockSelectionStory;
  tokens: Token[];
}
/** Starts before `start` and ends after `end`, so text typed at either boundary stays outside. */
interface Span {
  story: Story;
  start: Token;
  end: Token;
}
/** Boundary indices into story.tokens: the range covers tokens s..e-1. */
interface Bounds {
  story: Story;
  s: number;
  e: number;
}

type Obj = Record<string, unknown>;

const isInline = (t: Token | undefined): boolean =>
  !!t &&
  (t.kind === "char" ||
    t.kind === "picture" ||
    t.kind === "footnote" ||
    t.kind === "comment");

const edgeToken = (): Token => ({ kind: "edge", ch: "", run: { font: {} } });

const sameBookmarks = (
  a: readonly BookmarkState[] = [],
  b: readonly BookmarkState[] = [],
) => a.length === b.length && a.every((bookmark, i) => bookmark === b[i]);

function paraOf(token: Token): ParaState {
  if (!token.para) throw new Error("mock: not a paragraph mark");
  return token.para;
}

function officeError(code: string, message: string, location?: string) {
  return Object.assign(new Error(message), {
    name: "RichApi.Error",
    code,
    debugInfo: { code, message, errorLocation: location ?? null },
  });
}

const itemNotFound = (location?: string) =>
  officeError(
    "ItemNotFound",
    "We couldn't find the item you requested.",
    location,
  );

function mergeFont(
  ...layers: readonly (MockSelectionFont | undefined)[]
): MockSelectionFont {
  const out: Record<string, unknown> = {};
  for (const layer of layers)
    for (const [key, value] of Object.entries(layer ?? {}))
      if (value !== undefined) out[key] = value;
  return out;
}

function normalizedFont(font: MockSelectionFont): MockSelectionFont {
  const out: Record<string, unknown> = {};
  for (const key of [...FONT_KEYS, "rtl" as const])
    if (font[key] !== undefined) out[key] = font[key];
  return out;
}

function versionAtMost(version: string, max: string): boolean {
  const a = version.split(".").map(Number);
  const b = max.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return true;
}

function boundsOf(span: Span): Bounds {
  let start = span.start;
  while (start.dead && start.next) start = start.next;
  let end = span.end;
  while (end.dead && end.prev) end = end.prev;
  const s = span.story.tokens.indexOf(start);
  const e = span.story.tokens.indexOf(end) + 1;
  return { story: span.story, s, e: Math.max(s, e) };
}

function spanOf(b: Bounds): Span {
  return {
    story: b.story,
    start: b.story.tokens[b.s],
    end: b.story.tokens[b.e - 1],
  };
}

/** Index of the mark that ends the paragraph holding token i, or -1. */
function paragraphEnd(story: Story, i: number): number {
  for (let j = i; j < story.tokens.length; j += 1) {
    const t = story.tokens[j];
    if (t.kind === "mark") return j;
    if (!isInline(t)) return -1;
  }
  return -1;
}

function paragraphStart(story: Story, mark: number): number {
  let j = mark;
  while (j > 0 && isInline(story.tokens[j - 1])) j -= 1;
  return j;
}

function allMarks(story: Story): number[] {
  const out: number[] = [];
  story.tokens.forEach((t, i) => {
    if (t.kind === "mark") out.push(i);
  });
  return out;
}

function marksIn(story: Story, s: number, e: number): number[] {
  if (s === e) {
    const m = paragraphEnd(story, s);
    return m >= 0 ? [m] : [];
  }
  const out: number[] = [];
  for (let i = s; i < e; i += 1)
    if (story.tokens[i].kind === "mark") out.push(i);
  if (isInline(story.tokens[e - 1])) {
    const m = paragraphEnd(story, e - 1);
    if (m >= 0) out.push(m);
  }
  return out;
}

function commonPrefix(
  a: readonly CellState[],
  b: readonly CellState[],
): readonly CellState[] {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k += 1;
  return a.slice(0, k);
}

function commonCells(b: Bounds): readonly CellState[] {
  const { story, s, e } = b;
  let common: readonly CellState[] | undefined;
  const take = (cells: readonly CellState[]) => {
    common = common === undefined ? cells : commonPrefix(common, cells);
  };
  for (const m of marksIn(story, s, e)) take(paraOf(story.tokens[m]).cells);
  for (let i = s; i < e; i += 1) {
    const t = story.tokens[i];
    if (t.kind === "rowEnd") take(t.outer ?? []);
  }
  return common ?? [];
}

const startsWithCells = (
  cells: readonly CellState[],
  prefix: readonly CellState[],
) => prefix.every((cell, i) => cells[i] === cell);

function relation(a: Bounds, b: Bounds): string {
  if (a.story !== b.story) return "Unrelated";
  const [s1, e1, s2, e2] = [a.s, a.e, b.s, b.e];
  if (s1 === s2 && e1 === e2) return "Equal";
  if (s1 <= s2 && e1 >= e2)
    return s1 === s2 ? "ContainsStart" : e1 === e2 ? "ContainsEnd" : "Contains";
  if (s1 >= s2 && e1 <= e2)
    return s1 === s2 ? "InsideStart" : e1 === e2 ? "InsideEnd" : "Inside";
  if (e1 <= s2) return e1 === s2 ? "AdjacentBefore" : "Before";
  if (s1 >= e2) return s1 === e2 ? "AdjacentAfter" : "After";
  return s1 < s2 ? "OverlapsBefore" : "OverlapsAfter";
}

const esc = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const childW = (parent: Element | undefined | null, name: string) =>
  parent
    ? Array.from(parent.children).find(
        (e) => e.namespaceURI === W && e.localName === name,
      )
    : undefined;
const attrW = (element: Element | undefined | null, name: string) =>
  element?.getAttributeNS(W, name) ?? undefined;
const onOffValue = (element: Element) => {
  const value = element.getAttributeNS(W, "val");
  return value === null || !["0", "false", "off"].includes(value);
};

type GetTextOptions = Record<string, boolean | undefined>;

let teardown: (() => void) | undefined;

export function installWordSelectionHost(
  documentSpec: MockSelectionDocument,
  options: WordSelectionHostOptions = {},
): WordSelectionHost {
  teardown?.();
  const flavour = options.host ?? "mac";
  const web = flavour === "web";
  const requirements =
    options.requirements ?? (web ? ("web" as const) : ("m365" as const));
  const level = WORD_REQUIREMENT_LEVELS[requirements];
  const nullIds = options.nullParagraphIds ?? requirements === "ltsc2024";
  let trackingMode: MockTrackingMode = options.trackingMode ?? "Off";
  let idSeed = 0;
  let revisionSeed = 0;
  let bookmarkSeed = 0;
  const bookmarkState = (name: string): BookmarkState => {
    bookmarkSeed += 1;
    return { name, id: bookmarkSeed };
  };
  const namesOf = (names: string | readonly string[]) =>
    typeof names === "string" ? [names] : names;

  const styleTable = new Map<string, StyleDef>(
    BUILT_IN_STYLES.map((def) => [def.name, def]),
  );
  for (const [name, style] of Object.entries(options.styles ?? {})) {
    const type = style.type ?? "paragraph";
    styleTable.set(name, {
      name,
      id: name.replace(/\s+/g, ""),
      ooxmlName: name,
      type,
      basedOn: style.basedOn ?? (type === "paragraph" ? "Normal" : undefined),
      builtIn: "Other",
      font: style.font ?? {},
    });
  }
  const styleById = (id: string) =>
    [...styleTable.values()].find((def) => def.id === id);
  const styleIdOf = (name: string) =>
    styleTable.get(name)?.id ?? name.replace(/\s+/g, "");
  const styleFont = (name: string | undefined): MockSelectionFont => {
    const chain: MockSelectionFont[] = [];
    let def = name ? styleTable.get(name) : undefined;
    for (let depth = 0; def && depth < 10; depth += 1) {
      chain.unshift(def.font);
      def = def.basedOn ? styleTable.get(def.basedOn) : undefined;
    }
    return mergeFont(...chain);
  };
  const effectiveFont = (t: Token, para: ParaState | undefined) =>
    mergeFont(
      DEFAULT_FONT,
      styleFont(para?.style ?? "Normal"),
      styleFont(t.run.rStyle),
      t.run.font,
    );

  const newId = () => {
    idSeed += 1;
    const id = `5E1EC7ED-0928-4A00-8000-${idSeed.toString(16).padStart(12, "0")}`;
    return web ? id.toLowerCase() : id.toUpperCase();
  };
  const revision = (
    kind: Revision["kind"],
    author = AUTHOR,
    id?: number,
  ): Revision => {
    revisionSeed += 1;
    return { id: id ?? revisionSeed, kind, author, date: REVISION_DATE };
  };
  const markToken = (para: ParaState, run: RunState = { font: {} }): Token => ({
    kind: "mark",
    ch: "",
    run,
    para,
  });

  const buildParagraph = (
    spec: MockSelectionParagraph,
    cells: readonly CellState[],
    defaultStyle: string,
  ): Token[] => {
    const paragraph = typeof spec === "string" ? { runs: spec } : spec;
    const runs =
      typeof paragraph.runs === "string" ? [paragraph.runs] : paragraph.runs;
    const tokens: Token[] = [];
    let previous: { spec: MockSelectionRun; state: RunState } | undefined;
    for (const item of runs) {
      const run: MockSelectionRun =
        typeof item === "string" ? { text: item } : item;
      const same = <K extends keyof MockSelectionRun>(key: K) =>
        previous !== undefined &&
        run[key] !== undefined &&
        previous.spec[key] === run[key];
      const state: RunState = {
        font: mergeFont(run.font, run.hidden ? { hidden: true } : undefined),
        rStyle:
          run.rStyle ??
          (run.link
            ? "Hyperlink"
            : run.footnote
              ? "Footnote Reference"
              : undefined),
        link:
          run.link === undefined
            ? undefined
            : same("link")
              ? previous?.state.link
              : { url: run.link },
        field:
          run.field === undefined
            ? undefined
            : same("field")
              ? previous?.state.field
              : { code: run.field },
        sdt:
          run.sdt === undefined
            ? undefined
            : same("sdt")
              ? previous?.state.sdt
              : { tag: run.sdt },
        bookmarks:
          run.bookmark === undefined
            ? undefined
            : namesOf(run.bookmark).map(
                (name) =>
                  previous?.state.bookmarks?.find((b) => b.name === name) ??
                  bookmarkState(name),
              ),
        ins:
          run.inserted === undefined
            ? undefined
            : same("inserted")
              ? previous?.state.ins
              : revision("ins", run.inserted),
        del:
          run.deleted === undefined
            ? undefined
            : same("deleted")
              ? previous?.state.del
              : revision("del", run.deleted),
      };
      previous = { spec: run, state };
      if (run.picture) tokens.push({ kind: "picture", ch: "", run: state });
      else if (run.footnote)
        tokens.push({ kind: "footnote", ch: "", run: state });
      else if (run.comment)
        tokens.push({ kind: "comment", ch: "", run: state });
      for (const ch of (run.text ?? "").split(""))
        tokens.push({ kind: "char", ch, run: state });
    }
    tokens.push(
      markToken({
        id: paragraph.id ?? newId(),
        style: paragraph.style ?? defaultStyle,
        list: !!paragraph.list,
        cells,
        cellEnd: false,
      }),
    );
    return tokens;
  };

  const buildBlocks = (
    blocks: readonly MockSelectionBlock[],
    cells: readonly CellState[],
    defaultStyle: string,
  ): Token[] => {
    const out: Token[] = [];
    for (const block of blocks) {
      if (typeof block === "object" && "table" in block) {
        const table: TableState = { nesting: cells.length + 1 };
        block.table.forEach((row, r) => {
          row.forEach((cellSpec, c) => {
            const path = [...cells, { table, row: r, col: c }];
            const content =
              typeof cellSpec === "string" ? [cellSpec] : cellSpec;
            const tokens = buildBlocks(
              content.length ? content : [""],
              path,
              defaultStyle,
            );
            let last = [...tokens].reverse().find((t) => t.kind === "mark");
            // A cell ends with one of its own paragraphs, also after a nested table.
            if (!last || paraOf(last).cells.length !== path.length) {
              tokens.push(...buildParagraph("", path, defaultStyle));
              last = tokens[tokens.length - 1];
            }
            paraOf(last).cellEnd = true;
            out.push(...tokens);
          });
          out.push({
            kind: "rowEnd",
            ch: "",
            run: { font: {} },
            table,
            outer: cells,
          });
        });
      } else out.push(...buildParagraph(block, cells, defaultStyle));
    }
    return out;
  };

  const story = (
    kind: MockSelectionStory,
    blocks: readonly MockSelectionBlock[] | undefined,
  ): Story => ({
    kind,
    tokens: [
      edgeToken(),
      ...buildBlocks(blocks ?? [], [], DEFAULT_STORY_STYLE[kind]),
      edgeToken(),
    ],
  });
  const stories: Record<MockSelectionStory, Story> = {
    body: story("body", documentSpec.body),
    header: story("header", documentSpec.header),
    footer: story("footer", documentSpec.footer),
    footnote: story("footnote", documentSpec.footnotes),
    textbox: story("textbox", documentSpec.textBox),
    comment: story("comment", documentSpec.comments),
  };
  let sectionBreaks = options.sectionBreaks ?? [];
  const searchHooks = new Set<MockSearchHook>();
  const storyType = (s: Story) =>
    ({
      // Word for Mac reports body text as a Section body once a document has a second section.
      body: flavour === "mac" && sectionBreaks.length ? "Section" : "MainDoc",
      header: "Header",
      footer: "Footer",
      footnote: web ? "NoteItem" : "Footnote",
      textbox: "Shape",
      comment: "Unknown",
    })[s.kind];

  let selection: Span = spanOf({ story: stories.body, s: 1, e: 1 });

  const supportsSet = (name: string, version?: string) => {
    const max = level[name];
    return (
      max !== undefined &&
      (version === undefined || versionAtMost(version, max))
    );
  };
  const supported = (api: string) => {
    const set = WORD_SELECTION_API_SETS[api];
    return !set || supportsSet(set[0], set[1]);
  };
  const gate = (api: string) => {
    if (!supported(api)) throw officeError("ApiNotFound", "ApiNotFound", api);
  };

  const paraAt = (st: Story, i: number): ParaState | undefined => {
    const m = paragraphEnd(st, i);
    return m >= 0 ? paraOf(st.tokens[m]) : undefined;
  };
  type TextMode = "range" | "paragraph" | { hidden: boolean; deleted: boolean };
  /** SV2:133, SV2:140-143: what each host shows of one inline token. */
  const inlineText = (
    st: Story,
    t: Token,
    para: ParaState | undefined,
    mode: TextMode,
  ): string => {
    const getText = typeof mode === "object";
    switch (t.kind) {
      case "picture":
        return mode === "range" && web ? " " : "";
      case "footnote":
        return getText || (web && st.kind === "footnote") ? "" : "\u0002";
      case "comment":
        return getText ? "" : web || st.kind === "comment" ? "\u0005" : "";
      case "char": {
        const hidden = !!effectiveFont(t, para).hidden;
        if (getText) {
          if (t.run.del && !mode.deleted) return "";
          if (hidden && !web && !mode.hidden) return "";
          return t.ch;
        }
        if (t.run.del && flavour === "mac") return "";
        if (hidden && !web) return "";
        return t.ch;
      }
      default:
        return "";
    }
  };
  /** SV2:119-123: paragraph and cell separators of Range.text. */
  const renderRange = (b: Bounds): string => {
    const { story: st, s, e } = b;
    let out = "";
    let para: ParaState | undefined;
    let paraKnown = false;
    for (let i = s; i < e; i += 1) {
      const t = st.tokens[i];
      if (isInline(t)) {
        if (!paraKnown) {
          para = paraAt(st, i);
          paraKnown = true;
        }
        out += inlineText(st, t, para, "range");
        continue;
      }
      paraKnown = false;
      if (t.kind === "mark") {
        const next = i + 1 < e ? st.tokens[i + 1] : undefined;
        out += !paraOf(t).cellEnd
          ? "\r"
          : web
            ? "\r"
            : next?.kind === "rowEnd"
              ? ""
              : "\t";
      } else if (t.kind === "rowEnd") out += web ? "" : "\r\n";
    }
    return out;
  };
  const paragraphText = (st: Story, mark: Token, mode: TextMode) => {
    const m = st.tokens.indexOf(mark);
    if (mark.dead || m < 0) throw itemNotFound("Paragraph");
    const para = paraOf(mark);
    let out = "";
    for (let i = paragraphStart(st, m); i < m; i += 1)
      out += inlineText(st, st.tokens[i], para, mode);
    return out;
  };
  const getTextOf = (st: Story, mark: Token, options: GetTextOptions = {}) =>
    paragraphText(st, mark, {
      hidden: !!(options.IncludeHiddenText ?? options.includeHiddenText),
      deleted: !!(
        options.IncludeTextMarkedAsDeleted ?? options.includeTextMarkedAsDeleted
      ),
    }) + (web ? "" : paraOf(mark).cellEnd ? "\t" : "\r");
  /**
   * Range.getReviewedText("Current") without tracked deletions, or "Original" without tracked
   * insertions. Word for Mac (2026-10-09) also showed hidden text and spelled out each field as
   * \u0013code\u0014result\u0015; PC is assumed to match, and the web to show what getText does.
   * Content-control marks are not modelled. The separators follow Range.text.
   */
  const reviewedText = (b: Bounds, version: string) => {
    const { story: st, s, e } = b;
    const original = version === "Original";
    let out = "";
    let field: FieldState | undefined;
    const closeField = () => {
      if (field) out += "\u0015";
      field = undefined;
    };
    for (let i = s; i < e; i += 1) {
      const t = st.tokens[i];
      if (isInline(t)) {
        if (t.kind === "char" && (original ? t.run.ins : t.run.del)) continue;
        if (!web && t.run.field !== field) {
          closeField();
          if (t.run.field) out += `\u0013${t.run.field.code}\u0014`;
          field = t.run.field;
        }
        out += inlineText(st, t, paraAt(st, i), {
          hidden: true,
          deleted: original,
        });
        continue;
      }
      closeField();
      if (t.kind === "mark") {
        const next = i + 1 < e ? st.tokens[i + 1] : undefined;
        out += !paraOf(t).cellEnd
          ? "\r"
          : web
            ? "\r"
            : next?.kind === "rowEnd"
              ? ""
              : "\t";
      } else if (t.kind === "rowEnd") out += web ? "" : "\r\n";
    }
    closeField();
    return out;
  };
  const plainText = (st: Story, from: number, to: number) => {
    let out = "";
    for (let i = from; i < to; i += 1) {
      const t = st.tokens[i];
      if (t.kind === "char" && !t.run.del) out += t.ch;
    }
    return out;
  };

  const linksIn = (b: Bounds) => {
    const links = new Set<LinkState>();
    let outside = false;
    for (let i = b.s; i < b.e; i += 1) {
      const t = b.story.tokens[i];
      if (isInline(t) && t.run.link) links.add(t.run.link);
      else outside = true;
    }
    return { links, outside };
  };
  const coverLinks = (b: Bounds, links: ReadonlySet<LinkState>): Bounds => {
    let { s, e } = b;
    b.story.tokens.forEach((t, i) => {
      if (t.run.link && links.has(t.run.link)) {
        s = Math.min(s, i);
        e = Math.max(e, i + 1);
      }
    });
    return { story: b.story, s, e };
  };
  const searchIn = (
    b: Bounds,
    needle: string,
    matchCase: boolean,
  ): Bounds[] => {
    // Native probe: desktop searched 256 characters and failed at 300; the web showed no limit.
    if (!web && needle.length > 256)
      throw officeError(
        "SearchStringInvalidOrTooLong",
        "The search string is invalid or too long.",
        "Range.search",
      );
    // Word reads "^" as the start of a special-character code, never as itself.
    if (!needle || needle.includes("^")) return [];
    const searched = (value: string) =>
      options.searchMatchesQuoteVariants
        ? value.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
        : value;
    const { story: st, s, e } = b;
    let text = "";
    const owner: number[] = [];
    let para: ParaState | undefined;
    let paraKnown = false;
    for (let i = s; i < e; i += 1) {
      const t = st.tokens[i];
      let piece = "";
      if (isInline(t)) {
        if (!paraKnown) {
          para = paraAt(st, i);
          paraKnown = true;
        }
        piece = inlineText(st, t, para, "range");
      } else {
        paraKnown = false;
        if (t.kind === "mark") piece = "\r";
      }
      text += piece;
      for (let k = 0; k < piece.length; k += 1) owner.push(i);
    }
    const hay = searched(matchCase ? text : text.toLowerCase());
    const pin = searched(matchCase ? needle : needle.toLowerCase());
    const hits: Bounds[] = [];
    for (
      let at = hay.indexOf(pin);
      at >= 0;
      at = hay.indexOf(pin, at + pin.length)
    ) {
      let hit: Bounds = {
        story: st,
        s: owner[at],
        e: owner[at + pin.length - 1] + 1,
      };
      const { links, outside } = linksIn(hit);
      // SV2:88: a desktop hit that reaches into a hyperlink grows to the whole link.
      if (!web && links.size && (outside || links.size > 1))
        hit = coverLinks(hit, links);
      // SV2:55: a web hit inside a comment range carries the comment mark.
      if (web && st.tokens[hit.e]?.kind === "comment")
        hit = { ...hit, e: hit.e + 1 };
      hits.push(hit);
    }
    return [...searchHooks].reduce<Bounds[]>(
      (current, hook) => hook(current, needle),
      hits,
    );
  };

  const tracked = () => trackingMode !== "Off";
  const killAt = (st: Story, i: number) => {
    const t = st.tokens[i];
    t.dead = true;
    t.prev = st.tokens[i - 1];
    t.next = st.tokens[i + 1];
    st.tokens.splice(i, 1);
  };
  const removable = (t: Token) =>
    isInline(t) || (t.kind === "mark" && !paraOf(t).cellEnd);
  /**
   * Replaces s..e with `fresh`. Cell end marks and row ends always stay. With Track Changes on the
   * old tokens become a deletion (our own insertions vanish) and `fresh` an insertion after them.
   */
  const writeTokens = (
    b: Bounds,
    fresh: Token[],
    keepFirstMark = false,
  ): Bounds => {
    const { story: st, s, e } = b;
    const doomed: number[] = [];
    if (!tracked()) {
      let kept = !keepFirstMark;
      for (let i = s; i < e; i += 1) {
        const t = st.tokens[i];
        if (!removable(t)) continue;
        if (t.kind === "mark" && !kept) {
          kept = true;
          continue;
        }
        doomed.push(i);
      }
      for (let k = doomed.length - 1; k >= 0; k -= 1) killAt(st, doomed[k]);
      st.tokens.splice(s, 0, ...fresh);
      return { story: st, s, e: s + fresh.length };
    }
    const del = revision("del");
    const ins = revision("ins");
    let deleted = false;
    for (let i = s; i < e; i += 1) {
      const t = st.tokens[i];
      if (!removable(t)) continue;
      if (t.run.ins?.author === AUTHOR) doomed.push(i);
      else if (!t.run.del) {
        t.run = { ...t.run, del };
        deleted = true;
      }
    }
    for (let k = doomed.length - 1; k >= 0; k -= 1) killAt(st, doomed[k]);
    const at = e - doomed.length;
    for (const t of fresh) t.run = { ...t.run, ins };
    st.tokens.splice(at, 0, ...fresh);
    if (deleted && fresh.length) {
      del.pair = ins;
      ins.pair = del;
    }
    return { story: st, s: at, e: at + fresh.length };
  };
  const paragraphAround = (st: Story, i: number): ParaState => {
    const m =
      paragraphEnd(st, i) >= 0 ? paragraphEnd(st, i) : paragraphEnd(st, i - 1);
    return m >= 0
      ? paraOf(st.tokens[m])
      : {
          id: "",
          style: DEFAULT_STORY_STYLE[st.kind],
          list: false,
          cells: [],
          cellEnd: false,
        };
  };
  /** SV2:92: "\n" and "\r\n" each become one new paragraph in the same style. */
  const textTokens = (
    text: string,
    template: RunState,
    para: ParaState,
  ): Token[] => {
    const out: Token[] = [];
    text.split(/\r\n|\n|\r/).forEach((line, i) => {
      if (i > 0) out.push(markToken({ ...para, id: newId(), cellEnd: false }));
      for (const ch of line.split(""))
        out.push({ kind: "char", ch, run: template });
    });
    return out;
  };
  const charNear = (st: Story, s: number, e: number): Token | undefined => {
    for (let i = s; i < e; i += 1)
      if (st.tokens[i].kind === "char") return st.tokens[i];
    for (let i = s - 1; isInline(st.tokens[i]); i -= 1)
      if (st.tokens[i].kind === "char") return st.tokens[i];
    for (let i = s; isInline(st.tokens[i]); i += 1)
      if (st.tokens[i].kind === "char") return st.tokens[i];
    return undefined;
  };
  const copiedRun = (t: Token | undefined): RunState =>
    t
      ? { font: { ...t.run.font }, rStyle: t.run.rStyle, sdt: t.run.sdt }
      : { font: {} };
  const dropFields = (b: Bounds) => {
    const fields = new Set<FieldState>();
    for (let i = b.s; i < b.e; i += 1) {
      const field = b.story.tokens[i].run.field;
      if (field) fields.add(field);
    }
    if (!fields.size) return;
    b.story.tokens.forEach((t) => {
      if (t.run.field && fields.has(t.run.field))
        t.run = { ...t.run, field: undefined };
    });
  };
  /** Office.js insertText; SV2:84-97 for formatting, links, fields and multi-paragraph spans. */
  const officeWrite = (b: Bounds, text: string, replace: boolean): Bounds => {
    if (!replace) {
      const template = web
        ? { font: {} }
        : copiedRun(charNear(b.story, b.s, b.s));
      return writeTokens(
        b,
        textTokens(text, template, paragraphAround(b.story, b.s)),
      );
    }
    let target = b;
    let link: LinkState | undefined;
    const { links, outside } = linksIn(b);
    if (links.size) {
      if (links.size === 1 && !outside) link = [...links][0];
      else if (web)
        throw officeError(
          "GeneralException",
          "Cannot read properties of null (reading 'appId')",
          "Range.insertText",
        );
      else target = coverLinks(b, links);
    }
    if (!tracked()) dropFields(target);
    const template: RunState = web
      ? { font: {}, link }
      : { ...copiedRun(charNear(target.story, target.s, target.e)), link };
    return writeTokens(
      target,
      textTokens(text, template, paragraphAround(target.story, target.s)),
      web,
    );
  };
  const userWrite = (b: Bounds, text: string) =>
    writeTokens(
      b,
      textTokens(
        text,
        copiedRun(charNear(b.story, b.s, b.e)),
        paragraphAround(b.story, b.s),
      ),
    );
  /**
   * PF8 and PF2: desktop writes no value equal to the one the run inherits (automatic colour is not
   * #000000, so a colour is always written); the web drops only a toggle switched off where it
   * already is off, and writes every other value.
   */
  const elided = (
    t: Token,
    para: ParaState | undefined,
    key: FontKey,
    value: unknown,
  ) => {
    const inherited = mergeFont(
      { ...DEFAULT_FONT, color: undefined },
      styleFont(para?.style ?? "Normal"),
      styleFont(t.run.rStyle),
    )[key];
    return web
      ? value === false && inherited === false
      : inherited !== undefined && value === inherited;
  };
  const setFont = (b: Bounds, key: FontKey, value: unknown) => {
    let change: Revision | undefined;
    for (let i = b.s; i < b.e; i += 1) {
      const t = b.story.tokens[i];
      if (t.kind !== "char" && t.kind !== "footnote") continue;
      const font: MockSelectionFont = { ...t.run.font, [key]: value };
      if (elided(t, paraAt(b.story, i), key, value)) delete font[key];
      // PF2: inserted text gets a tracked format change too, once a set writes something new.
      let formatChange = t.run.formatChange;
      if (
        tracked() &&
        !formatChange &&
        (!t.run.ins || font[key] !== t.run.font[key])
      ) {
        change ??= revision("format");
        formatChange = { revision: change, font: t.run.font };
      }
      t.run = { ...t.run, font, formatChange };
    }
  };
  const fontValue = (b: Bounds, key: FontKey): unknown => {
    const { story: st, s, e } = b;
    const values: unknown[] = [];
    let para: ParaState | undefined;
    let paraKnown = false;
    for (let i = s; i < e; i += 1) {
      const t = st.tokens[i];
      if (!isInline(t)) {
        paraKnown = false;
        continue;
      }
      if (!paraKnown) {
        para = paraAt(st, i);
        paraKnown = true;
      }
      if (t.kind === "char" || t.kind === "footnote")
        values.push(effectiveFont(t, para)[key]);
    }
    if (!values.length) {
      const near = charNear(st, s, s);
      return near
        ? effectiveFont(near, paraAt(st, s))[key]
        : mergeFont(DEFAULT_FONT, styleFont(paraAt(st, s)?.style))[key];
    }
    // Word for the web reads a mixed span as its first character.
    return web || values.every((v) => v === values[0]) ? values[0] : null;
  };

  interface RevisionEntry {
    revision: Revision;
    story: Story;
    tokens: Token[];
  }
  const revisionEntries = (b: Bounds): RevisionEntry[] => {
    const map = new Map<Revision, Token[]>();
    for (let i = b.s; i < b.e; i += 1) {
      const t = b.story.tokens[i];
      for (const r of [t.run.ins, t.run.del, t.run.formatChange?.revision]) {
        if (!r) continue;
        const list = map.get(r) ?? [];
        list.push(t);
        map.set(r, list);
      }
    }
    return [...map].map(([r, tokens]) => ({
      revision: r,
      story: b.story,
      tokens,
    }));
  };
  const wholeStory = (st: Story): Bounds => ({
    story: st,
    s: 1,
    e: st.tokens.length - 1,
  });
  /**
   * SV2:102-105: a body lists our Replace as one Added change on desktop until that insertion is
   * rejected; a range or paragraph never lists the deletion half. PF2: desktop also folds a format
   * change on inserted text into its Added change, where the web lists it as Formatted.
   */
  const listedRevision =
    (st: Story, wholeBody: boolean) => (entry: RevisionEntry) => {
      const r = entry.revision;
      if (r.kind === "format")
        return web || !entry.tokens.every((t) => t.run.ins);
      if (r.kind !== "del" || !r.pair) return true;
      const pair = r.pair;
      return wholeBody && (web || !st.tokens.some((t) => t.run.ins === pair));
    };
  const revisionText = (entry: RevisionEntry) =>
    entry.revision.kind === "del" && flavour === "mac"
      ? ""
      : entry.tokens.map((t) => (t.kind === "char" ? t.ch : "")).join("");
  const revisionType = (r: Revision) =>
    r.kind === "ins" ? "Added" : r.kind === "del" ? "Deleted" : "Formatted";
  const settleRevision = (entry: RevisionEntry, accept: boolean) => {
    const { revision: r, story: st } = entry;
    const removes = (r.kind === "ins") !== accept && r.kind !== "format";
    for (let i = st.tokens.length - 1; i >= 0; i -= 1) {
      const t = st.tokens[i];
      if (r.kind === "format") {
        if (t.run.formatChange?.revision === r)
          t.run = {
            ...t.run,
            font: accept ? t.run.font : t.run.formatChange.font,
            formatChange: undefined,
          };
        continue;
      }
      if (t.run[r.kind] !== r) continue;
      if (removes) killAt(st, i);
      else t.run = { ...t.run, [r.kind]: undefined };
    }
  };

  const revisionAttrs = (r: Revision) =>
    ` w:id="${r.id}" w:author="${esc(r.author)}" w:date="${r.date}"`;
  const onOff = (name: string, value: boolean | undefined) =>
    value === undefined
      ? ""
      : value
        ? `<w:${name}/>`
        : `<w:${name} w:val="0"/>`;
  const rPrContent = (font: MockSelectionFont, rStyle?: string) => {
    const parts: string[] = [];
    if (rStyle) parts.push(`<w:rStyle w:val="${esc(styleIdOf(rStyle))}"/>`);
    if (font.name !== undefined || font.nameBidirectional !== undefined)
      parts.push(
        `<w:rFonts${font.name !== undefined ? ` w:ascii="${esc(font.name)}" w:hAnsi="${esc(font.name)}"` : ""}${font.nameBidirectional !== undefined ? ` w:cs="${esc(font.nameBidirectional)}"` : ""}/>`,
      );
    parts.push(
      onOff("b", font.bold),
      onOff("bCs", font.boldBidirectional),
      onOff("i", font.italic),
      onOff("iCs", font.italicBidirectional),
      onOff("strike", font.strikeThrough),
      onOff("vanish", font.hidden),
    );
    if (font.color !== undefined)
      parts.push(`<w:color w:val="${esc(font.color.replace(/^#/, ""))}"/>`);
    if (font.size !== undefined)
      parts.push(`<w:sz w:val="${Math.round(font.size * 2)}"/>`);
    if (font.sizeBidirectional !== undefined)
      parts.push(`<w:szCs w:val="${Math.round(font.sizeBidirectional * 2)}"/>`);
    if (font.highlightColor !== undefined)
      parts.push(
        `<w:highlight w:val="${esc(font.highlightColor ?? "none")}"/>`,
      );
    if (font.underline !== undefined)
      parts.push(
        `<w:u w:val="${UNDERLINE_TO_OOXML[font.underline] ?? font.underline.toLowerCase()}"/>`,
      );
    if (font.superscript || font.subscript)
      parts.push(
        `<w:vertAlign w:val="${font.superscript ? "superscript" : "subscript"}"/>`,
      );
    else if (font.superscript === false || font.subscript === false)
      parts.push(`<w:vertAlign w:val="baseline"/>`);
    parts.push(onOff("rtl", font.rtl));
    return parts.join("");
  };
  const runProperties = (run: RunState) => {
    const change = run.formatChange
      ? `<w:rPrChange${revisionAttrs(run.formatChange.revision)}><w:rPr>${rPrContent(run.formatChange.font)}</w:rPr></w:rPrChange>`
      : "";
    // Word marks field results noProof (PF3).
    const content =
      rPrContent(run.font, run.rStyle) +
      (run.field ? "<w:noProof/>" : "") +
      change;
    return content ? `<w:rPr>${content}</w:rPr>` : "";
  };
  /** Word's Range.text shows a page break as \f and a column break as \u000E, like a line break as \v. */
  const BREAK_XML: Record<string, string> = {
    "\t": "<w:tab/>",
    "\v": "<w:br/>",
    "\f": '<w:br w:type="page"/>',
    "\u000E": '<w:br w:type="column"/>',
  };
  const charsXml = (text: string, deleted: boolean) =>
    text
      .split(/([\t\v\f\u000E])/)
      .filter(Boolean)
      .map(
        (part) =>
          BREAK_XML[part] ??
          `<w:${deleted ? "delText" : "t"} xml:space="preserve">${esc(part)}</w:${deleted ? "delText" : "t"}>`,
      )
      .join("");
  const runKey = (t: Token) =>
    JSON.stringify([
      normalizedFont(t.run.font),
      t.run.rStyle ?? null,
      t.run.formatChange?.revision.id ?? null,
    ]);
  let objectSeed = 0;
  const runsXml = (
    st: Story,
    from: number,
    to: number,
    links: Map<LinkState, string>,
    clipped: ReadonlySet<unknown>,
  ) => {
    const kept = <T>(wrapper: T | undefined) =>
      wrapper === undefined || clipped.has(wrapper) ? undefined : wrapper;
    const out: string[] = [];
    let sdt: SdtState | undefined;
    let link: LinkState | undefined;
    let rev: Revision | undefined;
    let field: FieldState | undefined;
    let bookmarks: readonly BookmarkState[] = [];
    const moveBookmarks = (next: readonly BookmarkState[] = []) => {
      for (const ending of bookmarks)
        if (!next.includes(ending) && !options.ooxmlOmitsBookmarks)
          out.push(`<w:bookmarkEnd w:id="${ending.id}"/>`);
      for (const starting of next)
        if (!bookmarks.includes(starting) && !options.ooxmlOmitsBookmarks)
          out.push(
            `<w:bookmarkStart w:id="${starting.id}" w:name="${esc(starting.name)}"/>`,
          );
      bookmarks = next;
    };
    const closeFrom = (depth: number) => {
      if (field && depth <= 3) {
        out.push(`<w:r><w:fldChar w:fldCharType="end"/></w:r>`);
        field = undefined;
      }
      if (rev && depth <= 2) {
        out.push(rev.kind === "ins" ? "</w:ins>" : "</w:del>");
        rev = undefined;
      }
      if (link && depth <= 1) {
        out.push("</w:hyperlink>");
        link = undefined;
      }
      if (sdt && depth <= 0) {
        out.push("</w:sdtContent></w:sdt>");
        sdt = undefined;
      }
    };
    for (let i = from; i < to; ) {
      const t = st.tokens[i];
      const tRev = t.run.ins ?? t.run.del;
      const tSdt = kept(t.run.sdt);
      const tLink = kept(t.run.link);
      const tField = kept(t.run.field);
      if (tSdt !== sdt) closeFrom(0);
      else if (tLink !== link) closeFrom(1);
      else if (tRev !== rev) closeFrom(2);
      else if (tField !== field) closeFrom(3);
      // Between the wrappers that close and those that open, so a bookmark next to a field or
      // around one stays outside it.
      moveBookmarks(t.run.bookmarks);
      if (!sdt && tSdt) {
        sdt = tSdt;
        out.push(
          `<w:sdt><w:sdtPr><w:tag w:val="${esc(sdt.tag)}"/></w:sdtPr><w:sdtContent>`,
        );
      }
      if (!link && tLink) {
        link = tLink;
        let id = links.get(link);
        if (!id) {
          id = `rIdLink${links.size + 1}`;
          links.set(link, id);
        }
        out.push(`<w:hyperlink r:id="${id}" w:history="1">`);
      }
      if (!rev && tRev) {
        rev = tRev;
        out.push(`<w:${rev.kind}${revisionAttrs(rev)}>`);
      }
      if (!field && tField) {
        field = tField;
        out.push(
          `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${esc(field.code)} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`,
        );
      }
      const props = runProperties(t.run);
      if (t.kind !== "char") {
        objectSeed += 1;
        out.push(
          `<w:r>${props}${
            t.kind === "picture"
              ? `<w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="${objectSeed}" name="Picture ${objectSeed}"/></wp:inline></w:drawing>`
              : t.kind === "footnote"
                ? `<w:footnoteReference w:id="${objectSeed}"/>`
                : `<w:commentReference w:id="${objectSeed}"/>`
          }</w:r>`,
        );
        i += 1;
        continue;
      }
      let text = "";
      let j = i;
      while (j < to) {
        const u = st.tokens[j];
        if (
          u.kind !== "char" ||
          u.run.sdt !== t.run.sdt ||
          u.run.link !== t.run.link ||
          (u.run.ins ?? u.run.del) !== tRev ||
          u.run.field !== t.run.field ||
          !sameBookmarks(u.run.bookmarks, t.run.bookmarks) ||
          runKey(u) !== runKey(t)
        )
          break;
        text += u.ch;
        j += 1;
      }
      out.push(`<w:r>${props}${charsXml(text, !!t.run.del)}</w:r>`);
      i = j;
    }
    closeFrom(0);
    moveBookmarks();
    return out.join("");
  };
  const paragraphXml = (
    st: Story,
    mark: number,
    from: number,
    to: number,
    links: Map<LinkState, string>,
    clipped: ReadonlySet<unknown>,
    withProperties: boolean,
  ) => {
    const markTokenAt = st.tokens[mark];
    const para = paraOf(markTokenAt);
    const pPr: string[] = [];
    if (para.style !== "Normal")
      pPr.push(`<w:pStyle w:val="${esc(styleIdOf(para.style))}"/>`);
    if (para.list)
      pPr.push(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`);
    const markRev = markTokenAt.run.ins ?? markTokenAt.run.del;
    if (markRev)
      pPr.push(`<w:rPr><w:${markRev.kind}${revisionAttrs(markRev)}/></w:rPr>`);
    return `<w:p>${pPr.length && withProperties ? `<w:pPr>${pPr.join("")}</w:pPr>` : ""}${runsXml(st, from, to, links, clipped)}</w:p>`;
  };
  const stylesXml = () =>
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${rPrContent({
      name: DEFAULT_FONT.name,
      nameBidirectional: DEFAULT_FONT.nameBidirectional,
      size: DEFAULT_FONT.size,
      sizeBidirectional: DEFAULT_FONT.sizeBidirectional,
    })}</w:rPr></w:rPrDefault></w:docDefaults>${[...styleTable.values()]
      .map((def) => {
        const rPr = rPrContent(def.font);
        return `<w:style w:type="${def.type}"${def.name === "Normal" ? ' w:default="1"' : ""} w:styleId="${esc(def.id)}"><w:name w:val="${esc(def.ooxmlName)}"/>${def.basedOn ? `<w:basedOn w:val="${esc(styleIdOf(def.basedOn))}"/>` : ""}${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}</w:style>`;
      })
      .join("")}</w:styles>`;
  const pkgPart = (name: string, type: string, xml: string) =>
    `<pkg:part pkg:name="${name}" pkg:contentType="${type}"><pkg:xmlData>${xml}</pkg:xmlData></pkg:part>`;
  /**
   * PF3: the wrappers a range's own OOXML drops. A range inside a hyperlink (desktop also for exactly
   * the link text) keeps only rStyle, one inside or partly over a content control has no w:sdt, and
   * one inside a field result has no fldChar on desktop.
   */
  const clippedWrappers = (b: Bounds): Set<unknown> => {
    const { story: st, s, e } = b;
    const clipped = new Set<unknown>();
    const covered = st.tokens.slice(s, e);
    const extent = (owns: (t: Token) => boolean) =>
      st.tokens.reduce((n, t) => n + (owns(t) ? 1 : 0), 0);
    const sole = <T>(of: (run: RunState) => T | undefined) => {
      const first = covered.length ? of(covered[0].run) : undefined;
      return first !== undefined &&
        covered.every((t) => isInline(t) && of(t.run) === first)
        ? first
        : undefined;
    };
    const link = sole((run) => run.link);
    if (link && (!web || extent((t) => t.run.link === link) > covered.length))
      clipped.add(link);
    const field = sole((run) => run.field);
    if (field && !web) clipped.add(field);
    for (const sdt of new Set(covered.map((t) => t.run.sdt))) {
      if (!sdt) continue;
      const contained =
        extent((t) => t.run.sdt === sdt) ===
        covered.filter((t) => t.run.sdt === sdt).length;
      if (!contained || covered.every((t) => t.run.sdt === sdt))
        clipped.add(sdt);
    }
    return clipped;
  };
  /**
   * Like Word's: the clipped paragraphs (tables only when the range spans cells) plus styles. PF2:
   * the web leaves out the paragraph properties when the range lies within one paragraph.
   */
  const ooxmlOf = (b: Bounds): string => {
    const { story: st, s, e } = b;
    const links = new Map<LinkState, string>();
    const common = commonCells(b);
    const out: string[] = [];
    const clipped = clippedWrappers(b);
    const marks = marksIn(st, s, e);
    const withProperties = !web || marks.length > 1;
    let open: readonly CellState[] = common;
    for (const m of marks) {
      const path = paraOf(st.tokens[m]).cells;
      let k = common.length;
      while (k < open.length && k < path.length && open[k] === path[k]) k += 1;
      for (let depth = open.length - 1; depth >= k; depth -= 1) {
        const cell = open[depth];
        const next = path[depth];
        out.push("</w:tc>");
        if (!next || next.table !== cell.table) out.push("</w:tr></w:tbl>");
        else if (next.row !== cell.row) out.push("</w:tr>");
      }
      for (let depth = k; depth < path.length; depth += 1) {
        const previous = depth === k ? open[depth] : undefined;
        if (previous && previous.table === path[depth].table)
          out.push(
            previous.row !== path[depth].row ? "<w:tr><w:tc>" : "<w:tc>",
          );
        else out.push("<w:tbl><w:tr><w:tc>");
      }
      open = path;
      out.push(
        paragraphXml(
          st,
          m,
          Math.max(paragraphStart(st, m), s),
          Math.min(m, e),
          links,
          clipped,
          withProperties,
        ),
      );
    }
    for (let depth = open.length - 1; depth >= common.length; depth -= 1)
      out.push("</w:tc></w:tr></w:tbl>");
    const rels = [...links]
      .map(
        ([link, id]) =>
          `<Relationship Id="${id}" Type="${R}/hyperlink" Target="${esc(link.url)}" TargetMode="External"/>`,
      )
      .join("");
    return [
      `<?xml version="1.0" standalone="yes"?><?mso-application progid="Word.Document"?>`,
      `<pkg:package xmlns:pkg="${PKG}">`,
      pkgPart(
        "/_rels/.rels",
        "application/vnd.openxmlformats-package.relationships+xml",
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
      pkgPart(
        "/word/_rels/document.xml.rels",
        "application/vnd.openxmlformats-package.relationships+xml",
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/>${rels}</Relationships>`,
      ),
      pkgPart(
        "/word/document.xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}"><w:body>${out.join("")}</w:body></w:document>`,
      ),
      pkgPart(
        "/word/styles.xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
        stylesXml(),
      ),
      `</pkg:package>`,
    ].join("");
  };

  /**
   * The whole row around a paragraph that ends its cell, with the empty paragraph Word puts after a
   * table, as desktop Word returns it; null elsewhere.
   */
  const rowOoxmlOf = (b: Bounds): string | null => {
    const { story: st } = b;
    const para = paraOf(st.tokens[b.e - 1]);
    const path = para.cells;
    const cell = path[path.length - 1];
    if (!cell || !para.cellEnd) return null;
    const depth = path.length - 1;
    const inRow = allMarks(st).filter((k) => {
      const other = paraOf(st.tokens[k]).cells;
      return (
        other.length === path.length &&
        other[depth].table === cell.table &&
        other[depth].row === cell.row
      );
    });
    const bodyOf = (xml: string) =>
      /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? "";
    const columns = new Map<number, string>();
    for (const k of inRow) {
      const col = paraOf(st.tokens[k]).cells[depth].col;
      const xml = bodyOf(
        ooxmlOf({ story: st, s: paragraphStart(st, k), e: k + 1 }),
      );
      columns.set(col, (columns.get(col) ?? "") + xml);
    }
    const row = [...columns.entries()]
      .sort(([a], [z]) => a - z)
      .map(([, xml]) => `<w:tc><w:tcPr/>${xml}</w:tc>`)
      .join("");
    return ooxmlOf(b).replace(
      /<w:body>[\s\S]*<\/w:body>/,
      () =>
        `<w:body><w:tbl><w:tblPr/><w:tblGrid/><w:tr>${row}</w:tr></w:tbl><w:p/></w:body>`,
    );
  };

  interface ParsedParagraph {
    tokens: Token[];
    style: string;
    list: boolean;
    /** The paragraph had a w:pPr. */
    properties: boolean;
    markRun: RunState;
  }
  const parseOoxml = (ooxml: string): ParsedParagraph[] => {
    const doc = new DOMParser().parseFromString(ooxml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length)
      throw officeError(
        "GeneralException",
        "The OOXML is not valid.",
        "insertOoxml",
      );
    const parts = Array.from(doc.getElementsByTagNameNS(PKG, "part"));
    const partRoot = (name: string) =>
      parts
        .find((p) => p.getAttributeNS(PKG, "name") === name)
        ?.getElementsByTagNameNS(PKG, "xmlData")[0]?.firstElementChild ??
      undefined;
    const documentRoot = partRoot("/word/document.xml") ?? doc.documentElement;
    const styleNames = new Map<string, string>();
    for (const style of Array.from(
      partRoot("/word/styles.xml")?.getElementsByTagNameNS(W, "style") ?? [],
    )) {
      const id = attrW(style, "styleId") ?? "";
      styleNames.set(
        id,
        styleById(id)?.name ?? attrW(childW(style, "name"), "val") ?? id,
      );
    }
    const nameOf = (id: string) =>
      styleNames.get(id) ?? styleById(id)?.name ?? id;
    const targets = new Map<string, string>();
    for (const rel of Array.from(
      partRoot("/word/_rels/document.xml.rels")?.children ?? [],
    ))
      targets.set(
        rel.getAttribute("Id") ?? "",
        rel.getAttribute("Target") ?? "",
      );
    const revisions = new Map<string, Revision>();
    const revisionOf = (element: Element, kind: Revision["kind"]) => {
      const raw = attrW(element, "id") ?? "";
      const key = `${kind}:${raw}`;
      let found = revisions.get(key);
      if (!found) {
        const numeric = Number(raw);
        found = revision(
          kind,
          attrW(element, "author") ?? AUTHOR,
          Number.isFinite(numeric) && raw !== "" ? numeric : undefined,
        );
        found.date = attrW(element, "date") ?? REVISION_DATE;
        revisions.set(key, found);
      }
      return found;
    };
    const parseRPr = (rPr: Element | undefined) => {
      const font: MockSelectionFont = {};
      let rStyle: string | undefined;
      for (const e of Array.from(rPr?.children ?? [])) {
        if (e.namespaceURI !== W) continue;
        const val = attrW(e, "val");
        switch (e.localName) {
          case "rStyle":
            rStyle = nameOf(val ?? "");
            break;
          case "rFonts":
            if (attrW(e, "ascii")) font.name = attrW(e, "ascii");
            if (attrW(e, "cs")) font.nameBidirectional = attrW(e, "cs");
            break;
          case "b":
            font.bold = onOffValue(e);
            break;
          case "bCs":
            font.boldBidirectional = onOffValue(e);
            break;
          case "i":
            font.italic = onOffValue(e);
            break;
          case "iCs":
            font.italicBidirectional = onOffValue(e);
            break;
          case "strike":
            font.strikeThrough = onOffValue(e);
            break;
          case "vanish":
            font.hidden = onOffValue(e);
            break;
          case "rtl":
            font.rtl = onOffValue(e);
            break;
          case "color":
            if (val && val !== "auto") font.color = `#${val}`;
            break;
          case "sz":
            font.size = Number(val) / 2;
            break;
          case "szCs":
            font.sizeBidirectional = Number(val) / 2;
            break;
          case "highlight":
            font.highlightColor = val === "none" ? null : (val ?? null);
            break;
          case "u":
            font.underline =
              Object.entries(UNDERLINE_TO_OOXML).find(
                ([, v]) => v === val,
              )?.[0] ??
              val ??
              "Single";
            break;
          case "vertAlign":
            if (val === "superscript") font.superscript = true;
            else if (val === "subscript") font.subscript = true;
            else {
              font.superscript = false;
              font.subscript = false;
            }
            break;
          default:
            break;
        }
      }
      return { font, rStyle };
    };
    const body = documentRoot.getElementsByTagNameNS(W, "body")[0];
    if (!body)
      throw officeError(
        "GeneralException",
        "The OOXML has no body.",
        "insertOoxml",
      );
    const out: ParsedParagraph[] = [];
    for (const element of Array.from(body.children)) {
      if (element.namespaceURI !== W) continue;
      if (element.localName === "tbl")
        throw new Error("mock: insertOoxml of tables is not modelled");
      if (element.localName !== "p") continue;
      const pPr = childW(element, "pPr");
      const markRPr = childW(pPr, "rPr");
      const markIns = childW(markRPr, "ins");
      const markDel = childW(markRPr, "del");
      const tokens: Token[] = [];
      let fieldCode: string | undefined;
      let complexField: FieldState | undefined;
      const bookmarks = new Map<string, BookmarkState>();
      let open: BookmarkState[] = [];
      type Context = Pick<RunState, "link" | "sdt" | "ins" | "del" | "field">;
      const parseRun = (r: Element, context: Context) => {
        const rPr = childW(r, "rPr");
        const { font, rStyle } = parseRPr(rPr);
        const change = childW(rPr, "rPrChange");
        const base: RunState = {
          font,
          rStyle,
          bookmarks: open.length ? [...open] : undefined,
          link: context.link,
          sdt: context.sdt,
          ins: context.ins,
          del: context.del,
          formatChange: change
            ? {
                revision: revisionOf(change, "format"),
                font: parseRPr(childW(change, "rPr")).font,
              }
            : undefined,
        };
        let cached: RunState | undefined;
        const current = () => {
          const field = context.field ?? complexField;
          if (!cached || cached.field !== field) cached = { ...base, field };
          return cached;
        };
        for (const node of Array.from(r.children)) {
          if (node.namespaceURI !== W) continue;
          switch (node.localName) {
            case "fldChar": {
              const type = attrW(node, "fldCharType");
              if (type === "begin") fieldCode = "";
              else if (type === "separate") {
                complexField = { code: (fieldCode ?? "").trim() };
                fieldCode = undefined;
              } else if (type === "end") {
                complexField = undefined;
                fieldCode = undefined;
              }
              break;
            }
            case "instrText":
              if (fieldCode !== undefined) fieldCode += node.textContent ?? "";
              break;
            case "t":
            case "delText":
              if (fieldCode === undefined)
                for (const ch of (node.textContent ?? "").split(""))
                  tokens.push({ kind: "char", ch, run: current() });
              break;
            case "tab":
              tokens.push({ kind: "char", ch: "\t", run: current() });
              break;
            case "br":
            case "cr": {
              const type = attrW(node, "type");
              tokens.push({
                kind: "char",
                ch:
                  type === "page" ? "\f" : type === "column" ? "\u000E" : "\v",
                run: current(),
              });
              break;
            }
            case "drawing":
              tokens.push({ kind: "picture", ch: "", run: current() });
              break;
            case "footnoteReference":
              tokens.push({ kind: "footnote", ch: "", run: current() });
              break;
            case "commentReference":
              tokens.push({ kind: "comment", ch: "", run: current() });
              break;
            default:
              break;
          }
        }
      };
      const walk = (parent: Element, context: Context) => {
        for (const node of Array.from(parent.children)) {
          if (node.namespaceURI !== W) continue;
          switch (node.localName) {
            case "r":
              parseRun(node, context);
              break;
            case "hyperlink":
              walk(node, {
                ...context,
                link: {
                  url:
                    targets.get(node.getAttributeNS(R, "id") ?? "") ??
                    attrW(node, "anchor") ??
                    "",
                },
              });
              break;
            case "sdt": {
              const content = childW(node, "sdtContent");
              if (content)
                walk(content, {
                  ...context,
                  sdt: {
                    tag:
                      attrW(childW(childW(node, "sdtPr"), "tag"), "val") ?? "",
                  },
                });
              break;
            }
            case "ins":
              walk(node, { ...context, ins: revisionOf(node, "ins") });
              break;
            case "del":
              walk(node, { ...context, del: revisionOf(node, "del") });
              break;
            case "fldSimple":
              walk(node, {
                ...context,
                field: { code: attrW(node, "instr")?.trim() ?? "" },
              });
              break;
            case "smartTag":
              walk(node, context);
              break;
            case "bookmarkStart": {
              const bookmark = bookmarkState(attrW(node, "name") ?? "");
              bookmarks.set(attrW(node, "id") ?? "", bookmark);
              open = [...open, bookmark];
              break;
            }
            case "bookmarkEnd": {
              const ending = bookmarks.get(attrW(node, "id") ?? "");
              open = open.filter((bookmark) => bookmark !== ending);
              break;
            }
            default:
              break;
          }
        }
      };
      walk(element, {});
      const styleId = attrW(childW(pPr, "pStyle"), "val");
      out.push({
        tokens,
        style: styleId ? nameOf(styleId) : "Normal",
        list: !!childW(pPr, "numPr"),
        properties: !!pPr,
        markRun: {
          font: {},
          ins: markIns ? revisionOf(markIns, "ins") : undefined,
          del: markDel ? revisionOf(markDel, "del") : undefined,
        },
      });
    }
    return out;
  };
  const ooxmlWrite = (b: Bounds, ooxml: string): Bounds => {
    const parsed = parseOoxml(ooxml);
    const { story: st } = b;
    const last = b.e > b.s ? st.tokens[b.e - 1] : undefined;
    const endsWithMark = last?.kind === "mark";
    const around = paragraphAround(st, b.s);
    const fresh: Token[] = [];
    parsed.forEach((p, i) => {
      fresh.push(...p.tokens);
      // BM0: the web keeps a heading's style when its own OOXML, which has no pPr, is written back.
      const kept = web && !p.properties;
      if (i < parsed.length - 1 || endsWithMark)
        fresh.push(
          markToken(
            {
              id: newId(),
              style: kept ? around.style : p.style,
              list: kept ? around.list : p.list,
              cells: around.cells,
              cellEnd: false,
            },
            p.markRun,
          ),
        );
    });
    if (last && endsWithMark && paraOf(last).cellEnd) {
      // A cell keeps its end mark, which takes over the restored last paragraph's properties.
      const restored = fresh.pop();
      if (restored?.para) {
        paraOf(last).style = restored.para.style;
        paraOf(last).list = restored.para.list;
      }
    }
    return writeTokens(b, fresh);
  };

  const handlers: ((event: unknown) => void)[] = [];
  let holding: (() => void)[] | undefined;
  let registrationFailure: string | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const officeDocument: Obj = {
    url:
      options.url ??
      "https://contoso.sharepoint.com/Shared%20Documents/selection.docx",
    mode: "readWrite",
    settings: { get: vi.fn(() => undefined), set: vi.fn(), saveAsync: vi.fn() },
  };
  const asyncResult = (error?: string) => {
    const statuses = (
      Office as unknown as { AsyncResultStatus: Record<string, string> }
    ).AsyncResultStatus;
    return error
      ? {
          status: statuses.Failed,
          error: { name: "Error", message: error, code: 5001 },
        }
      : { status: statuses.Succeeded, value: undefined };
  };
  const callbackOf = (...args: unknown[]) =>
    args.find((a): a is (result: unknown) => void => typeof a === "function");
  const addHandlerAsync = vi.fn((...args: unknown[]) => {
    const [eventType, handler, ...rest] = args;
    const callback = callbackOf(...rest);
    const complete = () => {
      if (eventType !== SELECTION_CHANGED || typeof handler !== "function") {
        callback?.(asyncResult("The event type is not supported."));
        return;
      }
      if (registrationFailure !== null) {
        callback?.(asyncResult(registrationFailure));
        return;
      }
      handlers.push(handler as (event: unknown) => void);
      callback?.(asyncResult());
    };
    if (holding) holding.push(complete);
    else void Promise.resolve().then(complete);
  });
  const removeHandlerAsync = vi.fn((...args: unknown[]) => {
    const [eventType, maybeOptions, ...rest] = args;
    const callback = callbackOf(maybeOptions, ...rest);
    const only =
      typeof maybeOptions === "object" && maybeOptions !== null
        ? (maybeOptions as { handler?: unknown }).handler
        : undefined;
    void Promise.resolve().then(() => {
      if (eventType === SELECTION_CHANGED)
        for (let i = handlers.length - 1; i >= 0; i -= 1)
          if (!only || handlers[i] === only) handlers.splice(i, 1);
      callback?.(asyncResult());
    });
  });
  officeDocument.addHandlerAsync = addHandlerAsync;
  officeDocument.removeHandlerAsync = removeHandlerAsync;
  const fireSelectionChanged = () => {
    for (const handler of [...handlers]) {
      try {
        handler({ type: SELECTION_CHANGED, document: officeDocument });
      } catch {
        // The host swallows exceptions from add-in event handlers.
      }
    }
  };
  const sameBounds = (a: Bounds, b: Bounds) =>
    a.story === b.story && a.s === b.s && a.e === b.e;
  /** SV2:122: a selection that crosses cells covers those cells whole. */
  const snapToCells = (b: Bounds): Bounds => {
    if (b.s === b.e) return b;
    const depth = commonCells(b).length;
    const marks = allMarks(b.story);
    const cellsOf = (m: number) => paraOf(b.story.tokens[m]).cells;
    const startCell = paraAt(b.story, b.s)?.cells[depth];
    const endCell = paraAt(b.story, b.e - 1)?.cells[depth];
    let { s, e } = b;
    if (startCell) {
      const first = marks.find((m) => cellsOf(m)[depth] === startCell);
      if (first !== undefined) s = Math.min(s, paragraphStart(b.story, first));
    }
    if (endCell) {
      const last = marks.filter((m) => cellsOf(m)[depth] === endCell).pop();
      if (last !== undefined) e = Math.max(e, last + 1);
    }
    return { story: b.story, s, e };
  };
  /** SV2:64: a changed selection raises one late event; re-selecting the same range raises none. */
  const selectProgrammatically = (selected: Bounds) => {
    const b = snapToCells(selected);
    let target = b;
    const before = b.story.tokens[b.s - 1];
    // SV2:127: Word for the web selects the mark too when whole paragraph content is selected.
    if (
      web &&
      b.e > b.s &&
      (!before || !isInline(before)) &&
      b.story.tokens[b.e]?.kind === "mark"
    )
      target = { ...b, e: b.e + 1 };
    const changed = !sameBounds(boundsOf(selection), target);
    selection = spanOf(target);
    if (!changed) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      fireSelectionChanged();
    }, SELECT_EVENT_DELAY_MS[flavour]);
    timers.add(timer);
  };

  interface Command {
    name: string;
    write: boolean;
    run: () => void;
  }
  interface Ctx {
    id: number;
    queue: Command[];
    session: number;
    api: Obj;
    /** Writes the document shows only once the current Word.run has ended. */
    afterRun: (() => void)[];
  }
  interface Meta {
    ctx: Ctx;
    session: number;
    tracked: boolean;
    type: string;
    parent?: Obj;
    root?: boolean;
  }
  interface Target {
    type: "Range" | "Paragraph" | "Body";
    whole: () => Bounds;
    content: () => Bounds;
  }
  interface PropDef {
    get: () => unknown;
    set?: (value: unknown) => void;
    api?: string;
  }
  const calls: string[] = [];
  const metas = new WeakMap<object, Meta>();
  const targets = new WeakMap<object, Target>();
  const loaders = new WeakMap<
    object,
    (names: readonly string[] | null) => void
  >();
  let contextSeed = 0;

  const metaOf = (value: unknown): Meta => {
    const meta =
      typeof value === "object" && value !== null
        ? metas.get(value)
        : undefined;
    if (!meta) throw new Error("mock: not a Word proxy object");
    return meta;
  };
  const register = (
    obj: Obj,
    ctx: Ctx,
    type: string,
    parent?: Obj,
    root = false,
  ) => {
    metas.set(obj, {
      ctx,
      session: ctx.session,
      tracked: false,
      type,
      parent,
      root,
    });
    Object.defineProperty(obj, "context", { get: () => ctx.api });
    return obj;
  };
  const assertUsable = (obj: Obj) => {
    let meta = metaOf(obj);
    while (meta.parent) meta = metaOf(meta.parent);
    if (meta.root || meta.tracked || meta.session === meta.ctx.session) return;
    throw officeError(
      "InvalidObjectPath",
      `The object path '${meta.type}' isn't working for what you're trying to do. If you're using the object across multiple "context.sync" calls and outside the sequential execution of a ".run" batch, please use the "context.trackedObjects.add()" and "context.trackedObjects.remove()" methods to manage the object's lifetime.`,
    );
  };
  /** SV2:42: mixing an object of another request context into a call throws at once. */
  const sameContext = (a: Obj, b: unknown) => {
    if (metaOf(a).ctx !== metaOf(b).ctx)
      throw officeError(
        "InvalidRequestContext",
        "Cannot use the object across different request contexts.",
      );
  };
  const enqueue = (
    ctx: Ctx,
    owner: Obj,
    name: string,
    write: boolean,
    run: () => void,
  ) => {
    ctx.queue.push({
      name,
      write,
      run: () => {
        assertUsable(owner);
        run();
      },
    });
  };
  const nav = (obj: Obj, name: string, create: () => Obj) => {
    if (Object.prototype.hasOwnProperty.call(obj, name)) return;
    let cached: Obj | undefined;
    Object.defineProperty(obj, name, {
      enumerable: true,
      get: () => (cached ??= create()),
    });
  };
  const parseLoad = (spec: unknown): string[] | null => {
    if (spec === undefined || spec === null) return null;
    const list = Array.isArray(spec)
      ? spec.map(String)
      : String(spec).split(",");
    const names = list.map((name) => name.trim()).filter(Boolean);
    return names.length ? names : null;
  };
  const defineProps = (
    obj: Obj,
    ctx: Ctx,
    type: string,
    props: Record<string, PropDef>,
    isNull: () => boolean = () => false,
  ) => {
    const loaded = new Map<string, unknown>();
    for (const [name, def] of Object.entries(props)) {
      const setter = def.set;
      Object.defineProperty(obj, name, {
        enumerable: true,
        get: () => {
          if (!loaded.has(name))
            throw officeError(
              "PropertyNotLoaded",
              `The property '${name}' is not available. Before reading the property's value, call the load method on the containing object and call "context.sync()" on the associated request context.`,
            );
          return loaded.get(name);
        },
        set: setter
          ? (value: unknown) => {
              calls.push(`${type}.set:${name}`);
              enqueue(ctx, obj, `${type}.${name}=`, true, () => {
                if (def.api) gate(def.api);
                setter(value);
              });
            }
          : undefined,
      });
    }
    const loadNow = (names: readonly string[] | null) => {
      if (isNull()) return;
      for (const name of names ?? Object.keys(props)) {
        const def = Object.prototype.hasOwnProperty.call(props, name)
          ? props[name]
          : undefined;
        if (!def)
          throw officeError(
            "InvalidArgument",
            `${type} has no property '${name}'.`,
            `${type}.load`,
          );
        if (def.api && !supported(def.api)) {
          if (names) gate(def.api);
          continue;
        }
        loaded.set(name, def.get());
      }
    };
    loaders.set(obj, loadNow);
    obj.load = (spec?: unknown) => {
      calls.push(`${type}.load`);
      enqueue(ctx, obj, `${type}.load`, false, () => loadNow(parseLoad(spec)));
      return obj;
    };
  };
  const itemProps = (spec: unknown): string[] | null => {
    const names = parseLoad(spec);
    if (!names) return null;
    const props = names
      .filter((name) => name !== "items")
      .map((name) => name.replace(/^items\//, ""));
    return props.length ? props : null;
  };
  const clientResult = <T>(
    ctx: Ctx,
    owner: Obj,
    name: string,
    compute: () => T,
  ) => {
    let done = false;
    let value: T | undefined;
    enqueue(ctx, owner, name, false, () => {
      value = compute();
      done = true;
    });
    return {
      get value(): T {
        if (!done)
          throw officeError(
            "ValueNotLoaded",
            'The value of the result object has not been loaded yet. Before reading the value property, call "context.sync()" on the associated request context.',
          );
        return value as T;
      },
    };
  };
  const collection = <T>(
    ctx: Ctx,
    origin: Obj,
    type: string,
    compute: () => T[],
    toItem: (value: T) => Obj,
  ) => {
    const list: Obj = {};
    register(list, ctx, type, origin);
    let values: T[] | undefined;
    let items: Obj[] | undefined;
    enqueue(ctx, origin, type, false, () => {
      values = compute();
    });
    const resolved = () => {
      if (!values) throw new Error(`mock: ${type} used before its sync`);
      return values;
    };
    list.load = (spec?: unknown) => {
      calls.push(`${type}.load`);
      enqueue(ctx, list, `${type}.load`, false, () => {
        values = compute();
        items = values.map(toItem);
        const props = itemProps(spec);
        for (const item of items) loaders.get(item)?.(props);
      });
      return list;
    };
    Object.defineProperty(list, "items", {
      enumerable: true,
      get: () => {
        if (!items)
          throw officeError(
            "PropertyNotLoaded",
            `The property 'items' is not available.`,
          );
        return items;
      },
    });
    return { list, resolved };
  };

  const locate = (target: Target, location: string): Bounds => {
    const whole = target.whole();
    const content = target.content();
    switch (location) {
      case "Whole":
        return whole;
      case "Content":
        return content;
      case "Start":
      case "Before":
        return { ...whole, e: whole.s };
      case "End":
        return { ...content, s: content.e };
      case "After":
        return { ...whole, s: whole.e };
      default:
        throw officeError(
          "InvalidArgument",
          `Unknown range location '${location}'.`,
        );
    }
  };

  /**
   * Preflight impact 1: on Word for the web, reading or selecting an expandTo range within one
   * paragraph rewrites the runs it covers. A prefix or point range unhides hidden text, drops
   * cs-only bCs and szCs, gives a lone sz its szCs and drops rtl; the paragraph's own
   * Whole.expandTo(Whole) does the last three only. Selecting a range over several paragraphs, or
   * reading its OOXML, rewrites its first and last paragraph instead (PF impact 1, rows 89 and
   * 95-98): bCs and szCs twins are added, a bCs-only run loses it and rtl is dropped; hidden text
   * stays hidden. The re-spaced field instruction is not modelled.
   */
  const changeOnWebRead = (
    ctx: Ctx,
    range: Obj,
    bounds: () => Bounds | undefined,
  ) => {
    const changeEnds = (b: Bounds, marks: readonly number[]) => {
      const first = marks[0];
      const last = marks[marks.length - 1];
      const ends = [
        [paragraphStart(b.story, first), first],
        [paragraphStart(b.story, last), last],
      ];
      for (const [from, to] of ends)
        for (let i = from; i < to; i += 1) {
          const t = b.story.tokens[i];
          if (t.kind !== "char") continue;
          const font: MockSelectionFont = { ...t.run.font };
          if (font.bold === undefined) delete font.boldBidirectional;
          else font.boldBidirectional ??= font.bold;
          if (font.size !== undefined) font.sizeBidirectional ??= font.size;
          delete font.rtl;
          t.run = { ...t.run, font };
        }
    };
    const change = (name: string) => () => {
      const b = bounds();
      if (!b) return;
      const marks = marksIn(b.story, b.s, b.e);
      if (marks.length > 1) {
        if (name !== "load") changeEnds(b, marks);
        return;
      }
      const cover = b.story.tokens
        .slice(b.s, b.e)
        .some((t) => t.kind === "mark");
      for (let i = b.s; i < b.e; i += 1) {
        const t = b.story.tokens[i];
        if (t.kind !== "char") continue;
        const font: MockSelectionFont = { ...t.run.font };
        if (!cover) {
          delete font.hidden;
          if (font.size === undefined) delete font.sizeBidirectional;
        }
        if (font.bold === undefined) delete font.boldBidirectional;
        if (font.size !== undefined) font.sizeBidirectional ??= font.size;
        delete font.rtl;
        t.run = { ...t.run, font };
      }
    };
    for (const name of ["load", "getOoxml", "select"] as const) {
      const read = range[name] as (...args: unknown[]) => unknown;
      range[name] = (...args: unknown[]) => {
        const result = read(...args);
        enqueue(ctx, range, `Range.${name}`, false, change(name));
        return result;
      };
    }
  };

  const makeFont = (
    ctx: Ctx,
    origin: Obj,
    compute: () => Bounds | StyleDef,
  ) => {
    const font: Obj = {};
    register(font, ctx, "Font", origin);
    const props: Record<string, PropDef> = {};
    for (const key of FONT_KEYS)
      props[key] = {
        get: () => {
          const target = compute();
          if ("story" in target) return fontValue(target, key);
          // Word for the web has getStyles, but Style.font reads null there.
          return web
            ? null
            : mergeFont(DEFAULT_FONT, styleFont(target.name))[key];
        },
        set: (value) => {
          const target = compute();
          if (!("story" in target))
            throw new Error("mock: style fonts are read-only");
          setFont(target, key, value);
          const twin = web
            ? WEB_FONT_TWINS[key]
            : key === "name"
              ? "nameBidirectional"
              : undefined;
          if (twin) setFont(target, twin, value);
        },
        api: fontApi(key),
      };
    defineProps(font, ctx, "Font", props);
    return font;
  };

  /** A tracked range on the web: its paragraph, the offset into it and its length (SV2:44-52). */
  interface WebAnchor {
    story: Story;
    mark: Token;
    offset: number;
    length: number;
  }
  const webAnchorOf = (b: Bounds): WebAnchor | undefined => {
    const m = paragraphEnd(b.story, b.s);
    if (m < 0) return undefined;
    return {
      story: b.story,
      mark: b.story.tokens[m],
      offset: b.s - paragraphStart(b.story, m),
      length: b.e - b.s,
    };
  };
  const webAnchorBounds = (anchor: WebAnchor): Bounds => {
    const { story: st } = anchor;
    const m = st.tokens.indexOf(anchor.mark);
    if (m < 0) throw itemNotFound("Range");
    const last = st.tokens.length - 1;
    const s = Math.min(paragraphStart(st, m) + anchor.offset, last);
    return { story: st, s, e: Math.min(s + anchor.length, last) };
  };
  const rangeFrom = (ctx: Ctx, getSpan: () => Span): Obj => {
    const range: Obj = {};
    register(range, ctx, "Range");
    let webAnchor: WebAnchor | undefined;
    let anchored = false;
    // SV2:44-52: a tracked web range keeps paragraph-relative offsets and its length, so an earlier
    // edit in its paragraph moves it onto other text, where desktop's moves with the text.
    const whole = () => {
      if (webAnchor) return webAnchorBounds(webAnchor);
      const b = boundsOf(getSpan());
      if (web && !anchored && metaOf(range).tracked) {
        anchored = true;
        webAnchor = webAnchorOf(b);
      }
      return b;
    };
    const target: Target = { type: "Range", whole, content: whole };
    decorate(range, ctx, target);
    defineProps(range, ctx, "Range", {
      text: { get: () => renderRange(target.whole()) },
      hyperlink: {
        get: () => {
          const b = target.whole();
          return (
            b.story.tokens.slice(b.s, b.e).find((t) => t.run.link)?.run.link
              ?.url ?? ""
          );
        },
        api: "Range.hyperlink",
      },
      isEmpty: {
        get: () => {
          const b = target.whole();
          return b.s === b.e;
        },
        api: "Range.isEmpty",
      },
      style: { get: () => uniformStyle(target.whole())?.name ?? "" },
      styleBuiltIn: {
        get: () => uniformStyle(target.whole())?.builtIn ?? "Other",
        api: "Range.styleBuiltIn",
      },
    });
    return range;
  };
  const makeRange = (
    ctx: Ctx,
    origin: Obj | undefined,
    name: string,
    compute: () => Bounds,
    write = false,
  ): Obj => {
    let span: Span | undefined;
    ctx.queue.push({
      name,
      write,
      run: () => {
        if (origin) assertUsable(origin);
        span = spanOf(compute());
      },
    });
    return rangeFrom(ctx, () => {
      if (!span) throw new Error(`mock: ${name} used before its sync`);
      return span;
    });
  };
  const uniformStyle = (b: Bounds) => {
    const names = new Set(
      marksIn(b.story, b.s, b.e).map((m) => paraOf(b.story.tokens[m]).style),
    );
    return names.size === 1 ? styleTable.get([...names][0]) : undefined;
  };

  const makeParagraph = (
    ctx: Ctx,
    origin: Obj | undefined,
    name: string,
    compute: () => { story: Story; mark: Token },
    eager = false,
  ): Obj => {
    const paragraph: Obj = {};
    register(paragraph, ctx, "Paragraph");
    let ref = eager ? compute() : undefined;
    if (!eager)
      ctx.queue.push({
        name,
        write: false,
        run: () => {
          if (origin) assertUsable(origin);
          ref = compute();
        },
      });
    const need = () => {
      if (!ref) throw new Error(`mock: ${name} used before its sync`);
      if (ref.mark.dead) throw itemNotFound("Paragraph");
      return ref;
    };
    const bounds = () => {
      const { story: st, mark } = need();
      const m = st.tokens.indexOf(mark);
      const start = paragraphStart(st, m);
      return {
        whole: { story: st, s: start, e: m + 1 },
        content: { story: st, s: start, e: m },
      };
    };
    const target: Target = {
      type: "Paragraph",
      whole: () => bounds().whole,
      content: () => bounds().content,
    };
    decorate(paragraph, ctx, target);
    const para = () => paraOf(need().mark);
    defineProps(paragraph, ctx, "Paragraph", {
      text: {
        get: () => paragraphText(need().story, need().mark, "paragraph"),
      },
      uniqueLocalId: {
        get: () => (nullIds ? null : para().id),
        api: "Paragraph.uniqueLocalId",
      },
      // PF2: the web reports the OOXML w:name ("heading 1"), which getByNameOrNullObject cannot find.
      style: {
        get: () => {
          const style = para().style;
          return web ? (styleTable.get(style)?.ooxmlName ?? style) : style;
        },
        set: (value) => {
          const name = String(value);
          para().style =
            [...styleTable.values()].find((def) => def.ooxmlName === name)
              ?.name ?? name;
        },
      },
      styleBuiltIn: {
        get: () => styleTable.get(para().style)?.builtIn ?? "Other",
        api: "Range.styleBuiltIn",
      },
      tableNestingLevel: {
        get: () => para().cells.length,
        api: "Paragraph.tableNestingLevel",
      },
      isListItem: { get: () => para().list, api: "Paragraph.isListItem" },
      outlineLevel: {
        get: () => Number(/^Heading (\d)$/.exec(para().style)?.[1] ?? 10),
      },
    });
    paragraph.getText = (getTextOptions?: GetTextOptions) => {
      calls.push("Paragraph.getText");
      return clientResult(ctx, paragraph, "Paragraph.getText", () => {
        gate("Paragraph.getText");
        return getTextOf(need().story, need().mark, getTextOptions);
      });
    };
    return paragraph;
  };
  const paragraphItem = (ctx: Ctx, st: Story) => (mark: Token) =>
    makeParagraph(
      ctx,
      undefined,
      "Paragraph",
      () => ({ story: st, mark }),
      true,
    );
  const makeParagraphs = (
    ctx: Ctx,
    origin: Obj,
    compute: () => { story: Story; marks: Token[] },
  ) => {
    let source: Story | undefined;
    const { list, resolved } = collection(
      ctx,
      origin,
      "ParagraphCollection",
      () => {
        const { story: st, marks } = compute();
        source = st;
        return marks;
      },
      (mark) => {
        if (!source) throw new Error("mock: paragraphs used before their sync");
        return paragraphItem(ctx, source)(mark);
      },
    );
    const pick = (last: boolean) => () => {
      const name = `ParagraphCollection.${last ? "getLast" : "getFirst"}`;
      calls.push(name);
      return makeParagraph(ctx, list, name, () => {
        const marks = resolved();
        const mark = last ? marks[marks.length - 1] : marks[0];
        if (!mark || !source) throw itemNotFound(name);
        return { story: source, mark };
      });
    };
    list.getFirst = pick(false);
    list.getLast = pick(true);
    return list;
  };

  interface BodyRef {
    story: Story;
    cells: readonly CellState[];
  }
  const bodyBounds = (ref: BodyRef): Bounds => {
    const marks = allMarks(ref.story).filter((m) =>
      startsWithCells(paraOf(ref.story.tokens[m]).cells, ref.cells),
    );
    if (!marks.length) return { story: ref.story, s: 1, e: 1 };
    return {
      story: ref.story,
      s: paragraphStart(ref.story, marks[0]),
      e: marks[marks.length - 1] + 1,
    };
  };
  const parentBodyOf = (ref: BodyRef): BodyRef | null =>
    ref.cells.length
      ? { story: ref.story, cells: ref.cells.slice(0, -1) }
      : web && (ref.story.kind === "header" || ref.story.kind === "footer")
        ? { story: stories.body, cells: [] }
        : null;
  const makeBody = (
    ctx: Ctx,
    origin: Obj,
    compute: () => BodyRef | null,
    nullable: boolean,
  ): Obj => {
    const body: Obj = {};
    register(body, ctx, "Body", origin);
    let ref: BodyRef | null | undefined;
    enqueue(ctx, origin, "Body", false, () => {
      ref = compute();
    });
    const need = () => {
      if (!ref) throw itemNotFound("Body");
      return ref;
    };
    if (nullable)
      Object.defineProperty(body, "isNullObject", {
        enumerable: true,
        get: () => {
          if (ref === undefined)
            throw officeError(
              "PropertyNotLoaded",
              "The property 'isNullObject' is not available.",
            );
          return ref === null;
        },
      });
    const target: Target = {
      type: "Body",
      whole: () => bodyBounds(need()),
      content: () => bodyBounds(need()),
    };
    const parent = (orNull: boolean) => () =>
      makeBody(
        ctx,
        body,
        () => {
          const found = parentBodyOf(need());
          if (!found && !orNull) throw itemNotFound("Body.parentBody");
          return found;
        },
        orNull,
      );
    nav(body, "parentBody", parent(false));
    nav(body, "parentBodyOrNullObject", parent(true));
    decorate(body, ctx, target);
    defineProps(
      body,
      ctx,
      "Body",
      {
        type: {
          get: () => {
            const r = need();
            return r.cells.length ? "TableCell" : storyType(r.story);
          },
          api: "Body.type",
        },
        text: { get: () => renderRange(target.whole()) },
      },
      () => ref === null,
    );
    return body;
  };

  interface CellRef {
    story: Story;
    cells: readonly CellState[];
  }
  const makeCell = (
    ctx: Ctx,
    origin: Obj,
    compute: () => CellRef | null,
  ): Obj => {
    const cell: Obj = {};
    register(cell, ctx, "TableCell", origin);
    let ref: CellRef | null | undefined;
    enqueue(ctx, origin, "TableCell", false, () => {
      ref = compute();
    });
    const need = () => {
      if (!ref) throw itemNotFound("TableCell");
      return ref.cells[ref.cells.length - 1];
    };
    Object.defineProperty(cell, "isNullObject", {
      enumerable: true,
      get: () => {
        if (ref === undefined)
          throw officeError(
            "PropertyNotLoaded",
            "The property 'isNullObject' is not available.",
          );
        return ref === null;
      },
    });
    nav(cell, "body", () =>
      makeBody(
        ctx,
        cell,
        () => (ref ? { story: ref.story, cells: ref.cells } : null),
        false,
      ),
    );
    nav(cell, "parentTable", () => {
      const table: Obj = {};
      register(table, ctx, "Table", cell);
      table.getRange = () => {
        calls.push("Table.getRange");
        return makeRange(ctx, table, "Table.getRange", () => {
          gate("Table.getRange");
          const story = ref!.story;
          const t = need().table;
          const marks = allMarks(story).filter((m) =>
            paraOf(story.tokens[m]).cells.some((c) => c.table === t),
          );
          const ends = story.tokens.flatMap((x, i) =>
            x.kind === "rowEnd" && x.table === t ? [i] : [],
          );
          return {
            story,
            s: paragraphStart(story, marks[0]),
            e: ends[ends.length - 1] + 1,
          };
        });
      };
      nav(table, "rows", () => {
        const { list } = collection(
          ctx,
          table,
          "TableRowCollection",
          () => {
            const t = need().table;
            const story = ref!.story;
            const rows = new Map<number, Set<number>>();
            for (const m of allMarks(story))
              for (const c of paraOf(story.tokens[m]).cells)
                if (c.table === t) {
                  const cols = rows.get(c.row) ?? new Set<number>();
                  cols.add(c.col);
                  rows.set(c.row, cols);
                }
            return [...rows.values()].map((cols) => cols.size);
          },
          (cellCount) => {
            const row: Obj = {};
            register(row, ctx, "TableRow", table);
            defineProps(row, ctx, "TableRow", {
              cellCount: { get: () => cellCount },
            });
            return row;
          },
        );
        return list;
      });
      defineProps(table, ctx, "Table", {
        nestingLevel: { get: () => need().table.nesting },
        rowCount: {
          get: () => {
            const t = need().table;
            return new Set(
              (ref?.story.tokens ?? []).filter(
                (x) => x.kind === "rowEnd" && x.table === t,
              ),
            ).size;
          },
        },
      });
      return table;
    });
    defineProps(
      cell,
      ctx,
      "TableCell",
      {
        rowIndex: { get: () => need().row },
        cellIndex: { get: () => need().col },
      },
      () => ref === null,
    );
    return cell;
  };

  const makeTrackedChanges = (
    ctx: Ctx,
    origin: Obj,
    compute: () => RevisionEntry[],
  ) => {
    const { list, resolved } = collection(
      ctx,
      origin,
      "TrackedChangeCollection",
      compute,
      (entry) => {
        const change: Obj = {};
        register(change, ctx, "TrackedChange");
        defineProps(change, ctx, "TrackedChange", {
          type: { get: () => revisionType(entry.revision) },
          text: { get: () => revisionText(entry) },
          author: { get: () => entry.revision.author },
          date: { get: () => entry.revision.date },
        });
        const settle = (accept: boolean) => () => {
          calls.push(`TrackedChange.${accept ? "accept" : "reject"}`);
          enqueue(
            ctx,
            change,
            `TrackedChange.${accept ? "accept" : "reject"}`,
            true,
            () => settleRevision(entry, accept),
          );
        };
        change.accept = settle(true);
        change.reject = settle(false);
        change.getRange = () => {
          calls.push("TrackedChange.getRange");
          return makeRange(ctx, change, "TrackedChange.getRange", () => {
            const indices = entry.tokens
              .map((t) => entry.story.tokens.indexOf(t))
              .filter((i) => i >= 0);
            if (!indices.length) throw itemNotFound("TrackedChange.getRange");
            return {
              story: entry.story,
              s: Math.min(...indices),
              e: Math.max(...indices) + 1,
            };
          });
        };
        return change;
      },
    );
    const settleAll = (accept: boolean) => () => {
      calls.push(
        `TrackedChangeCollection.${accept ? "acceptAll" : "rejectAll"}`,
      );
      enqueue(
        ctx,
        list,
        `TrackedChangeCollection.${accept ? "acceptAll" : "rejectAll"}`,
        true,
        () => {
          for (const entry of resolved()) settleRevision(entry, accept);
        },
      );
    };
    list.acceptAll = settleAll(true);
    list.rejectAll = settleAll(false);
    return list;
  };

  function decorate(obj: Obj, ctx: Ctx, target: Target): void {
    targets.set(obj, target);
    const type = target.type;
    const method = (name: string) => calls.push(`${type}.${name}`);
    nav(obj, "font", () => makeFont(ctx, obj, () => target.content()));
    nav(obj, "paragraphs", () =>
      makeParagraphs(ctx, obj, () => {
        const b = target.whole();
        return {
          story: b.story,
          marks: marksIn(b.story, b.s, b.e).map((m) => b.story.tokens[m]),
        };
      }),
    );
    nav(obj, "parentBody", () =>
      makeBody(
        ctx,
        obj,
        () => {
          gate("Range.parentBody");
          const b = target.whole();
          return { story: b.story, cells: commonCells(b) };
        },
        false,
      ),
    );
    nav(obj, "parentTableCellOrNullObject", () =>
      makeCell(ctx, obj, () => {
        gate("Range.parentTableCellOrNullObject");
        const b = target.whole();
        const cells = commonCells(b);
        return cells.length ? { story: b.story, cells } : null;
      }),
    );
    nav(
      obj,
      "parentTableOrNullObject",
      () => (obj.parentTableCellOrNullObject as Obj).parentTable as Obj,
    );
    nav(obj, "inlinePictures", () => {
      const { list } = collection(
        ctx,
        obj,
        "InlinePictureCollection",
        () => {
          gate("Range.inlinePictures");
          const b = target.whole();
          return b.story.tokens
            .slice(b.s, b.e)
            .filter((t) => t.kind === "picture");
        },
        (token) => {
          const picture: Obj = {};
          register(picture, ctx, "InlinePicture");
          defineProps(picture, ctx, "InlinePicture", {
            altTextTitle: { get: () => "" },
          });
          picture.getRange = () =>
            makeRange(ctx, picture, "InlinePicture.getRange", () => {
              const st = target.whole().story;
              const i = st.tokens.indexOf(token);
              if (i < 0) throw itemNotFound("InlinePicture");
              return { story: st, s: i, e: i + 1 };
            });
          return picture;
        },
      );
      return list;
    });
    /** PF3: the controls a range touches without lying inside them, and the one it lies inside. */
    const parentControl = (b: Bounds): SdtState | undefined => {
      const covered = b.story.tokens.slice(b.s, Math.max(b.e, b.s + 1));
      const first = covered[0]?.run.sdt;
      return first && covered.every((t) => isInline(t) && t.run.sdt === first)
        ? first
        : undefined;
    };
    const control = (sdt: SdtState): Obj => {
      const item: Obj = {};
      register(item, ctx, "ContentControl");
      defineProps(item, ctx, "ContentControl", { tag: { get: () => sdt.tag } });
      return item;
    };
    nav(obj, "contentControls", () => {
      const { list } = collection(
        ctx,
        obj,
        "ContentControlCollection",
        () => {
          gate("Range.contentControls");
          const b = target.whole();
          const parent = parentControl(b);
          const found = new Set<SdtState>();
          for (let i = b.s; i < b.e; i += 1) {
            const sdt = b.story.tokens[i].run.sdt;
            if (sdt && sdt !== parent) found.add(sdt);
          }
          return [...found];
        },
        control,
      );
      return list;
    });
    nav(obj, "parentContentControlOrNullObject", () => {
      const item: Obj = {};
      register(item, ctx, "ContentControl", obj);
      let sdt: SdtState | null | undefined;
      enqueue(ctx, obj, "Range.parentContentControlOrNullObject", false, () => {
        gate("Range.parentContentControlOrNullObject");
        sdt = parentControl(target.whole()) ?? null;
      });
      Object.defineProperty(item, "isNullObject", {
        enumerable: true,
        get: () => {
          if (sdt === undefined)
            throw officeError(
              "PropertyNotLoaded",
              "The property 'isNullObject' is not available.",
            );
          return sdt === null;
        },
      });
      defineProps(
        item,
        ctx,
        "ContentControl",
        {
          tag: {
            get: () => {
              if (!sdt) throw itemNotFound("ContentControl");
              return sdt.tag;
            },
          },
        },
        () => sdt === null,
      );
      return item;
    });
    nav(obj, "fields", () => {
      const { list } = collection(
        ctx,
        obj,
        "FieldCollection",
        () => {
          gate("Range.fields");
          const b = target.whole();
          const found = new Set<FieldState>();
          for (let i = b.s; i < b.e; i += 1) {
            const field = b.story.tokens[i].run.field;
            if (field) found.add(field);
          }
          return [...found].map((field) => ({ story: b.story, field }));
        },
        ({ story: st, field }) => {
          const item: Obj = {};
          register(item, ctx, "Field");
          defineProps(item, ctx, "Field", { code: { get: () => field.code } });
          nav(item, "result", () =>
            rangeFrom(ctx, () => {
              const indices = st.tokens.flatMap((t, i) =>
                t.run.field === field ? [i] : [],
              );
              if (!indices.length) throw itemNotFound("Field.result");
              return spanOf({
                story: st,
                s: indices[0],
                e: indices[indices.length - 1] + 1,
              });
            }),
          );
          return item;
        },
      );
      return list;
    });
    obj.getRange = (location: string = "Whole") => {
      method("getRange");
      return makeRange(ctx, obj, `${type}.getRange`, () => {
        if (type !== "Body") gate("Range.getRange");
        return locate(target, location);
      });
    };
    const targetOf = (other: unknown) => {
      sameContext(obj, other);
      const found =
        typeof other === "object" && other !== null
          ? targets.get(other)
          : undefined;
      if (!found) throw officeError("InvalidArgument", "Expected a range.");
      return found;
    };
    obj.expandTo = (other: unknown) => {
      method("expandTo");
      const otherTarget = targetOf(other);
      let expanded: Bounds | undefined;
      const range = makeRange(ctx, obj, `${type}.expandTo`, () => {
        gate("Range.expandTo");
        const a = target.whole();
        const b = otherTarget.whole();
        if (a.story !== b.story)
          throw officeError(
            "InvalidArgument",
            "The ranges are in different stories.",
          );
        expanded = {
          story: a.story,
          s: Math.min(a.s, b.s),
          e: Math.max(a.e, b.e),
        };
        return expanded;
      });
      if (web) changeOnWebRead(ctx, range, () => expanded);
      return range;
    };
    obj.compareLocationWith = (other: unknown) => {
      method("compareLocationWith");
      const otherTarget = targetOf(other);
      return clientResult(ctx, obj, `${type}.compareLocationWith`, () => {
        gate("Range.compareLocationWith");
        return relation(target.whole(), otherTarget.whole());
      });
    };
    obj.search = (text: string, searchOptions?: { matchCase?: boolean }) => {
      method("search");
      const { list } = collection(
        ctx,
        obj,
        "RangeCollection",
        () =>
          searchIn(target.content(), text, !!searchOptions?.matchCase).map(
            spanOf,
          ),
        (span) => rangeFrom(ctx, () => span),
      );
      return list;
    };
    obj.insertText = (text: string, location: string) => {
      method("insertText");
      return makeRange(
        ctx,
        obj,
        `${type}.insertText`,
        () => {
          if (location === "Replace")
            return officeWrite(target.content(), text, true);
          if (
            type === "Paragraph" &&
            (location === "Before" || location === "After")
          )
            throw officeError(
              "InvalidArgument",
              `Paragraph.insertText does not take '${location}'.`,
            );
          return officeWrite(locate(target, location), text, false);
        },
        true,
      );
    };
    obj.insertOoxml = (ooxml: string, location: string) => {
      method("insertOoxml");
      const where = () =>
        location === "Replace" ? target.whole() : locate(target, location);
      return makeRange(
        ctx,
        obj,
        `${type}.insertOoxml`,
        () => {
          if (!web) return ooxmlWrite(where(), ooxml);
          // SV2:74, PF4: the web shows a restore only in a later Word.run; reads in this one are stale.
          parseOoxml(ooxml);
          const placed = where();
          ctx.afterRun.push(() => ooxmlWrite(where(), ooxml));
          return placed;
        },
        true,
      );
    };
    obj.getOoxml = () => {
      method("getOoxml");
      return clientResult(ctx, obj, `${type}.getOoxml`, () => {
        const whole = target.whole();
        const row =
          type === "Paragraph" && (options.cellParagraphOoxmlIsRow ?? !web)
            ? rowOoxmlOf(whole)
            : null;
        const ooxml = row ?? ooxmlOf(whole);
        return type === "Paragraph" && options.paragraphOoxml
          ? options.paragraphOoxml(
              ooxml,
              plainText(whole.story, whole.s, whole.e),
            )
          : ooxml;
      });
    };
    obj.select = () => {
      method("select");
      enqueue(ctx, obj, `${type}.select`, false, () =>
        selectProgrammatically(target.whole()),
      );
    };
    obj.track = () => {
      method("track");
      metaOf(obj).tracked = true;
      return obj;
    };
    obj.untrack = () => {
      method("untrack");
      metaOf(obj).tracked = false;
      return obj;
    };
    obj.delete = () => {
      method("delete");
      enqueue(ctx, obj, `${type}.delete`, true, () => {
        writeTokens(target.whole(), []);
      });
    };
    obj.getReviewedText = (version: string = "Current") => {
      method("getReviewedText");
      return clientResult(ctx, obj, `${type}.getReviewedText`, () => {
        gate("Range.getReviewedText");
        return reviewedText(target.whole(), version);
      });
    };
    // A bookmark is hidden when its name starts with "_"; adjacent ones touch the range's edge.
    obj.getBookmarks = (includeHidden = false, includeAdjacent = false) => {
      method("getBookmarks");
      return clientResult(ctx, obj, `${type}.getBookmarks`, () => {
        gate("Range.getBookmarks");
        const b = target.whole();
        const edge = includeAdjacent ? 1 : 0;
        const names = new Set<string>();
        for (
          let i = Math.max(0, b.s - edge);
          i < Math.min(b.story.tokens.length, b.e + edge);
          i += 1
        ) {
          for (const { name } of b.story.tokens[i].run.bookmarks ?? [])
            if (includeHidden || !name.startsWith("_")) names.add(name);
        }
        return [...names];
      });
    };
    obj.getTrackedChanges = () => {
      method("getTrackedChanges");
      return makeTrackedChanges(ctx, obj, () => {
        gate("Range.getTrackedChanges");
        const b = target.whole();
        return revisionEntries(b).filter(
          listedRevision(b.story, type === "Body"),
        );
      });
    };
    obj.getHyperlinkRanges = () => {
      method("getHyperlinkRanges");
      const { list } = collection(
        ctx,
        obj,
        "RangeCollection",
        () => {
          gate("Range.getHyperlinkRanges");
          const b = target.whole();
          const seen = new Set<LinkState>();
          const out: Span[] = [];
          for (let i = b.s; i < b.e; i += 1) {
            const link = b.story.tokens[i].run.link;
            if (!link || seen.has(link)) continue;
            seen.add(link);
            out.push(
              spanOf(
                coverLinks({ story: b.story, s: i, e: i + 1 }, new Set([link])),
              ),
            );
          }
          return out;
        },
        (span) => rangeFrom(ctx, () => span),
      );
      return list;
    };
  }

  const findById = (id: string): { story: Story; mark: Token } | undefined => {
    if (nullIds) return undefined;
    // SV2:55: Word for the web cannot find footnote or text-box paragraphs by ID.
    const searched = Object.values(stories).filter(
      (st) => !web || (st.kind !== "footnote" && st.kind !== "textbox"),
    );
    for (const st of searched) {
      const mark = st.tokens.find(
        (t) => t.kind === "mark" && paraOf(t).id === id,
      );
      if (mark) return { story: st, mark };
    }
    return undefined;
  };

  const makeDocument = (ctx: Ctx): Obj => {
    const doc: Obj = {};
    register(doc, ctx, "Document", undefined, true);
    nav(doc, "body", () =>
      makeBody(ctx, doc, () => ({ story: stories.body, cells: [] }), false),
    );
    // A section that ends before the body does offers only its last paragraph; the last section's
    // body is the main body.
    nav(doc, "sections", () => {
      const { list } = collection(
        ctx,
        doc,
        "SectionCollection",
        (): (Token | null)[] => [
          ...sectionBreaks.map(
            (tag) =>
              stories.body.tokens[findParagraph(stories.body, { p: tag })],
          ),
          null,
        ],
        (end) => {
          const section: Obj = {};
          register(section, ctx, "Section", list);
          nav(section, "body", () => {
            if (!end)
              return makeBody(
                ctx,
                section,
                () => ({ story: stories.body, cells: [] }),
                false,
              );
            const body: Obj = {};
            register(body, ctx, "Body", section);
            const paragraphs: Obj = {};
            register(paragraphs, ctx, "ParagraphCollection", body);
            paragraphs.getLast = () =>
              makeParagraph(
                ctx,
                paragraphs,
                "ParagraphCollection.getLast",
                () => ({
                  story: stories.body,
                  mark: end,
                }),
              );
            nav(body, "paragraphs", () => paragraphs);
            return body;
          });
          return section;
        },
      );
      return list;
    });
    defineProps(doc, ctx, "Document", {
      changeTrackingMode: {
        get: () => trackingMode,
        set: (value) => {
          trackingMode = value as MockTrackingMode;
        },
        api: "Document.changeTrackingMode",
      },
    });
    doc.getSelection = () => {
      calls.push("Document.getSelection");
      return makeRange(ctx, doc, "Document.getSelection", () =>
        boundsOf(selection),
      );
    };
    doc.getParagraphByUniqueLocalId = (id: string) => {
      calls.push("Document.getParagraphByUniqueLocalId");
      return makeParagraph(
        ctx,
        doc,
        "Document.getParagraphByUniqueLocalId",
        () => {
          gate("Document.getParagraphByUniqueLocalId");
          const found = findById(id);
          if (!found)
            throw itemNotFound("Document.getParagraphByUniqueLocalId");
          return found;
        },
      );
    };
    doc.getStyles = () => {
      calls.push("Document.getStyles");
      const styles: Obj = {};
      register(styles, ctx, "StyleCollection", doc);
      enqueue(ctx, doc, "Document.getStyles", false, () =>
        gate("Document.getStyles"),
      );
      styles.getByNameOrNullObject = (name: string) => {
        calls.push("StyleCollection.getByNameOrNullObject");
        const style: Obj = {};
        register(style, ctx, "Style", styles);
        let def: StyleDef | null | undefined;
        enqueue(
          ctx,
          styles,
          "StyleCollection.getByNameOrNullObject",
          false,
          () => {
            gate("Document.getStyles");
            def = styleTable.get(name) ?? null;
          },
        );
        Object.defineProperty(style, "isNullObject", {
          enumerable: true,
          get: () => {
            if (def === undefined)
              throw officeError(
                "PropertyNotLoaded",
                "The property 'isNullObject' is not available.",
              );
            return def === null;
          },
        });
        const need = () => {
          if (!def) throw itemNotFound("Style");
          return def;
        };
        nav(style, "font", () => makeFont(ctx, style, need));
        defineProps(
          style,
          ctx,
          "Style",
          {
            nameLocal: { get: () => need().name },
            type: {
              get: () =>
                need().type === "paragraph" ? "Paragraph" : "Character",
            },
            builtIn: { get: () => need().builtIn !== "Other" },
          },
          () => def === null,
        );
        return style;
      };
      return styles;
    };
    return doc;
  };

  let syncCounter = 0;
  const syncLog: MockSyncEntry[] = [];
  const beforeHooks = new Set<(index: number) => void>();
  const afterHooks = new Set<(index: number) => void>();
  const hangs: {
    at?: number;
    execute: "on-release" | "immediately";
    reached: (index: number) => void;
    released: Promise<void>;
  }[] = [];
  const sync = (ctx: Ctx): Promise<void> => {
    syncCounter += 1;
    const index = syncCounter;
    const commands = ctx.queue;
    ctx.queue = [];
    const execute = () => {
      for (const hook of [...beforeHooks]) hook(index);
      const entry: MockSyncEntry = {
        index,
        context: ctx.id,
        commands: [],
        writes: [],
      };
      syncLog.push(entry);
      for (const command of commands) {
        entry.commands.push(command.name);
        command.run();
        if (command.write) entry.writes.push(command.name);
      }
      for (const hook of [...afterHooks]) hook(index);
    };
    const settle = (): Promise<void> => {
      try {
        execute();
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    };
    const at = hangs.findIndex(
      (hang) => hang.at === undefined || hang.at === index,
    );
    if (at < 0) return settle();
    const [hang] = hangs.splice(at, 1);
    hang.reached(index);
    if (hang.execute === "immediately") {
      let failure: Error | undefined;
      try {
        execute();
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
      return hang.released.then(() => {
        if (failure) throw failure;
      });
    }
    return hang.released.then(settle);
  };
  const makeContext = (): Ctx => {
    contextSeed += 1;
    const ctx: Ctx = {
      id: contextSeed,
      queue: [],
      session: 0,
      api: {},
      afterRun: [],
    };
    const doc = makeDocument(ctx);
    const trackedObjects = (tracked: boolean) => (value: unknown) => {
      for (const item of Array.isArray(value) ? value : [value]) {
        const meta = metaOf(item);
        if (meta.ctx !== ctx)
          throw officeError(
            "InvalidRequestContext",
            "Cannot use the object across different request contexts.",
          );
        meta.tracked = tracked;
      }
    };
    ctx.api = {
      document: doc,
      sync: () => {
        calls.push("RequestContext.sync");
        return sync(ctx);
      },
      trackedObjects: {
        add: trackedObjects(true),
        remove: trackedObjects(false),
      },
    };
    return ctx;
  };
  const run = vi.fn(async (...args: unknown[]): Promise<unknown> => {
    const batch = args[args.length - 1];
    if (typeof batch !== "function")
      throw new Error("mock: Word.run needs a batch function");
    const subject = args.length > 1 ? args[0] : undefined;
    const ctx =
      subject === undefined
        ? makeContext()
        : metaOf(Array.isArray(subject) ? subject[0] : subject).ctx;
    ctx.session += 1;
    try {
      const value: unknown = await (
        batch as (context: Obj) => Promise<unknown>
      )(ctx.api);
      if (ctx.queue.length) await sync(ctx);
      return value;
    } finally {
      ctx.queue = [];
      for (const apply of ctx.afterRun.splice(0)) apply();
      ctx.session += 1;
    }
  });

  const storyOf = (name: MockSelectionStory = "body") => stories[name];
  const findParagraph = (st: Story, target: MockSelectionTarget): number => {
    const marks = allMarks(st);
    if (target.paragraph !== undefined) {
      const m = marks[target.paragraph];
      if (m === undefined)
        throw new Error(`mock: no paragraph ${target.paragraph}`);
      return m;
    }
    const tag = target.p ?? "";
    const textOf = (m: number) => plainText(st, paragraphStart(st, m), m);
    const found =
      marks.find(
        (m) => textOf(m).trimStart().startsWith(`${tag} `) || textOf(m) === tag,
      ) ?? marks.find((m) => textOf(m).includes(`${tag} `));
    if (found === undefined)
      throw new Error(`mock: no paragraph tagged ${tag}`);
    return found;
  };
  const tablesOf = (st: Story) => {
    const seen: TableState[] = [];
    for (const m of allMarks(st))
      for (const cell of paraOf(st.tokens[m]).cells)
        if (!seen.includes(cell.table)) seen.push(cell.table);
    return seen;
  };
  const resolveTarget = (target: MockSelectionTarget): Bounds => {
    const st = storyOf(target.story);
    let b: Bounds;
    if (target.table !== undefined) {
      const table = tablesOf(st)[target.table];
      if (!table) throw new Error(`mock: no table ${target.table}`);
      const marks = allMarks(st).filter((m) =>
        paraOf(st.tokens[m]).cells.some((cell) => cell.table === table),
      );
      if (target.tableWhole) {
        let end = -1;
        st.tokens.forEach((t, i) => {
          if (t.kind === "rowEnd" && t.table === table) end = i + 1;
        });
        b = { story: st, s: paragraphStart(st, marks[0]), e: end };
        // SV2:121: Word for Mac's whole-table range also takes the next paragraph's first character.
        if (flavour === "mac" && st.tokens[end]?.kind === "char") b.e += 1;
      } else {
        const [row, col] = target.cell ?? [0, 0];
        const inCell = marks.filter((m) => {
          const cell = paraOf(st.tokens[m]).cells[table.nesting - 1];
          return cell.row === row && cell.col === col;
        });
        if (!inCell.length) throw new Error(`mock: no cell ${row},${col}`);
        const last = inCell[inCell.length - 1];
        b = {
          story: st,
          s: paragraphStart(st, inCell[0]),
          e: target.part === "Whole" ? last + 1 : last,
        };
      }
    } else if (target.picture !== undefined) {
      const pictures = st.tokens.flatMap((t, i) =>
        t.kind === "picture" ? [i] : [],
      );
      const i = pictures[target.picture];
      if (i === undefined)
        throw new Error(`mock: no picture ${target.picture}`);
      b = { story: st, s: i, e: i + 1 };
    } else {
      const m = findParagraph(st, target);
      const start = paragraphStart(st, m);
      if (target.text !== undefined) {
        let text = "";
        const owner: number[] = [];
        for (let i = start; i < m; i += 1) {
          const t = st.tokens[i];
          if (t.kind === "char" && !t.run.del) {
            text += t.ch;
            owner.push(i);
          }
        }
        let at = -1;
        for (let n = 0; n <= (target.occ ?? 0); n += 1) {
          at = text.indexOf(target.text, at + 1);
          if (at < 0) throw new Error(`mock: "${target.text}" not found`);
        }
        b = {
          story: st,
          s: owner[at],
          e: owner[at + target.text.length - 1] + 1,
        };
      } else
        b =
          target.part === "Whole"
            ? { story: st, s: start, e: m + 1 }
            : target.part === "Start"
              ? { story: st, s: start, e: start }
              : target.part === "End"
                ? { story: st, s: m, e: m }
                : { story: st, s: start, e: m };
    }
    if (target.to) {
      const end = resolveTarget({ story: target.story, ...target.to });
      b = { story: st, s: Math.min(b.s, end.s), e: Math.max(b.e, end.e) };
    }
    if (target.collapse === "Start") b = { ...b, e: b.s };
    if (target.collapse === "End") b = { ...b, s: b.e };
    return b;
  };
  const wholeParagraphs = (b: Bounds): Bounds => {
    const marks = marksIn(b.story, b.s, b.e);
    return {
      story: b.story,
      s: paragraphStart(b.story, marks[0]),
      e: marks[marks.length - 1] + 1,
    };
  };
  const summarize = (st: Story, from: number, to: number): MockRunSummary[] => {
    const out: MockRunSummary[] = [];
    let lastKey = "";
    for (let i = from; i < to; i += 1) {
      const t = st.tokens[i];
      const font = normalizedFont(t.run.font);
      const entry: MockRunSummary = {
        text: t.kind === "char" ? t.ch : "",
        ...(t.kind === "char"
          ? {}
          : { object: t.kind as MockRunSummary["object"] }),
        ...(Object.keys(font).length ? { font } : {}),
        ...(t.run.rStyle ? { rStyle: t.run.rStyle } : {}),
        ...(t.run.bookmarks
          ? { bookmarks: t.run.bookmarks.map((b) => b.name) }
          : {}),
        ...(t.run.link ? { link: t.run.link.url } : {}),
        ...(t.run.field ? { field: t.run.field.code } : {}),
        ...(t.run.sdt ? { sdt: t.run.sdt.tag } : {}),
        ...(t.run.ins ? { inserted: t.run.ins.author } : {}),
        ...(t.run.del ? { deleted: t.run.del.author } : {}),
      };
      const key = JSON.stringify({ ...entry, text: "" });
      const last = out[out.length - 1];
      if (last && !last.object && !entry.object && key === lastKey)
        last.text += entry.text;
      else out.push(entry);
      lastKey = key;
    }
    return out;
  };

  const handle: WordSelectionHost = {
    host: flavour,
    requirements,
    run,
    isSetSupported: vi.fn((name: string, version?: string) =>
      supportsSet(name, version),
    ),
    addHandlerAsync,
    removeHandlerAsync,
    select: (target, selectOptions) => {
      const next = snapToCells(resolveTarget(target));
      const changed = !sameBounds(boundsOf(selection), next);
      selection = spanOf(next);
      if (changed && selectOptions?.event !== false) fireSelectionChanged();
    },
    selectionText: () => renderRange(boundsOf(selection)),
    fireSelectionChanged,
    handlerCount: () => handlers.length,
    holdHandlerRegistration: () => {
      holding ??= [];
      return () => {
        const pending = holding ?? [];
        holding = undefined;
        for (const complete of pending) complete();
      };
    },
    failHandlerRegistration: (message) => {
      registrationFailure = message;
    },
    paragraphs: (name) => {
      const st = storyOf(name);
      return allMarks(st).map((m) => {
        const para = paraOf(st.tokens[m]);
        const start = paragraphStart(st, m);
        return {
          id: para.id,
          text: plainText(st, start, m),
          style: para.style,
          list: para.list,
          nesting: para.cells.length,
          runs: summarize(st, start, m),
        };
      });
    },
    text: (target) => renderRange(resolveTarget(target)),
    ooxml: (target) => ooxmlOf(resolveTarget(target)),
    insertText: (target, text, location = "Replace") => {
      const b = resolveTarget(target);
      userWrite(
        location === "Replace"
          ? b
          : {
              ...b,
              s: location === "Start" ? b.s : b.e,
              e: location === "Start" ? b.s : b.e,
            },
        text,
      );
    },
    deleteParagraphs: (target) => {
      writeTokens(wholeParagraphs(resolveTarget(target)), []);
    },
    mergeCellIntoPrevious: (tableIndex, [row, col]) => {
      const st = stories.body;
      const table = tablesOf(st)[tableIndex];
      if (!table) throw new Error(`mock: no table ${tableIndex}`);
      const depth = table.nesting - 1;
      const paras = allMarks(st).map((m) => paraOf(st.tokens[m]));
      const inCell = (c: number) =>
        paras.filter((p) => {
          const cell = p.cells[depth];
          return cell?.table === table && cell.row === row && cell.col === c;
        });
      const into = inCell(col - 1);
      const moved = inCell(col);
      if (!into.length || !moved.length)
        throw new Error(`mock: no cell before ${row},${col}`);
      const target = into[0].cells[depth];
      const source = moved[0].cells[depth];
      const intoEnd = [...into]
        .reverse()
        .find((p) => p.cells.length === depth + 1);
      if (intoEnd) intoEnd.cellEnd = false;
      for (const p of moved)
        p.cells = p.cells.map((cell) => (cell === source ? target : cell));
      const shifted = new Set<CellState>();
      for (const p of paras) {
        const cell = p.cells[depth];
        if (
          cell?.table === table &&
          cell.row === row &&
          cell.col > col &&
          !shifted.has(cell)
        ) {
          shifted.add(cell);
          cell.col -= 1;
        }
      }
    },
    insertParagraphs: (target, paragraphs, location) => {
      const b = wholeParagraphs(resolveTarget(target));
      const cells = paragraphAround(b.story, b.s).cells;
      const fresh = paragraphs.flatMap((p) =>
        buildParagraph(p, cells, DEFAULT_STORY_STYLE[b.story.kind]),
      );
      const at = location === "Before" ? b.s : b.e;
      writeTokens({ story: b.story, s: at, e: at }, fresh);
    },
    setParagraphStyle: (target, style) => {
      const b = resolveTarget(target);
      for (const m of marksIn(b.story, b.s, b.e))
        paraOf(b.story.tokens[m]).style = style;
    },
    format: (target, runSpec) => {
      const b = resolveTarget(target);
      const link =
        runSpec.link === undefined ? undefined : { url: runSpec.link };
      const field =
        runSpec.field === undefined ? undefined : { code: runSpec.field };
      const sdt = runSpec.sdt === undefined ? undefined : { tag: runSpec.sdt };
      const added = namesOf(runSpec.bookmark ?? []).map(bookmarkState);
      for (let i = b.s; i < b.e; i += 1) {
        const t = b.story.tokens[i];
        if (!isInline(t)) continue;
        t.run = {
          ...t.run,
          font: mergeFont(
            t.run.font,
            runSpec.font,
            runSpec.hidden ? { hidden: true } : undefined,
          ),
          rStyle: runSpec.rStyle ?? (link ? "Hyperlink" : t.run.rStyle),
          link: link ?? t.run.link,
          field: field ?? t.run.field,
          sdt: sdt ?? t.run.sdt,
          bookmarks: added.length
            ? [...(t.run.bookmarks ?? []), ...added]
            : t.run.bookmarks,
        };
      }
    },
    clearBookmarks: (target) => {
      const b = resolveTarget(target);
      for (let i = b.s; i < b.e; i += 1) {
        const t = b.story.tokens[i];
        if (isInline(t)) t.run = { ...t.run, bookmarks: undefined };
      }
    },
    setTrackingMode: (mode) => {
      trackingMode = mode;
    },
    setSectionBreaks: (tags) => {
      sectionBreaks = tags;
    },
    trackingMode: () => trackingMode,
    revisions: () =>
      Object.values(stories).flatMap((st) =>
        revisionEntries(wholeStory(st)).map((entry) => ({
          type: revisionType(entry.revision),
          text: entry.tokens
            .map((t) => (t.kind === "char" ? t.ch : ""))
            .join(""),
          author: entry.revision.author,
        })),
      ),
    rejectAllRevisions: () => {
      for (const st of Object.values(stories))
        for (const entry of revisionEntries(wholeStory(st)))
          settleRevision(entry, false);
    },
    acceptAllRevisions: () => {
      for (const st of Object.values(stories))
        for (const entry of revisionEntries(wholeStory(st)))
          settleRevision(entry, true);
    },
    syncCount: () => syncCounter,
    syncLog: () =>
      syncLog.map((entry) => ({
        ...entry,
        commands: [...entry.commands],
        writes: [...entry.writes],
      })),
    writeSyncs: () =>
      handle.syncLog().filter((entry) => entry.writes.length > 0),
    beforeSync: (hook) => {
      beforeHooks.add(hook);
      return () => beforeHooks.delete(hook);
    },
    afterSync: (hook) => {
      afterHooks.add(hook);
      return () => afterHooks.delete(hook);
    },
    onSearch: (hook) => {
      searchHooks.add(hook);
      return () => searchHooks.delete(hook);
    },
    hangSync: (hangOptions = {}) => {
      let reached: (index: number) => void = () => {};
      let release: () => void = () => {};
      const reachedPromise = new Promise<number>((resolve) => {
        reached = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      hangs.push({
        at: hangOptions.at,
        execute: hangOptions.execute ?? "on-release",
        reached,
        released,
      });
      return { reached: reachedPromise, release };
    },
    calls: () => [...calls],
  };

  const office = Office as unknown as Record<string, unknown>;
  const officeContext = Office.context as unknown as Record<string, unknown>;
  const readyInfo = { host: "Word", platform: PLATFORM[flavour] };
  officeContext.document = officeDocument;
  officeContext.requirements = { isSetSupported: handle.isSetSupported };
  officeContext.diagnostics = {
    host: "Word",
    platform: PLATFORM[flavour],
    version: "16.0.0.0",
  };
  officeContext.platform = PLATFORM[flavour];
  office.onReady = vi.fn((callback?: (info: typeof readyInfo) => void) => {
    callback?.(readyInfo);
    return Promise.resolve(readyInfo);
  });
  (globalThis as Record<string, unknown>).Word = { run };
  teardown = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    handlers.length = 0;
  };
  return handle;
}

export function uninstallWordSelectionHost(): void {
  teardown?.();
  teardown = undefined;
  const office = Office as unknown as Record<string, unknown>;
  const officeContext = Office.context as unknown as Record<string, unknown>;
  delete officeContext.document;
  delete officeContext.requirements;
  delete officeContext.diagnostics;
  delete officeContext.platform;
  delete office.onReady;
  delete (globalThis as Record<string, unknown>).Word;
}
