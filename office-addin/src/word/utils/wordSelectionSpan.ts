import type { WordSelectionHazards } from "./wordSelectionAnchor";
import type {
  WordSelectionEdgeFormat,
  WordSelectionFont,
  WordSelectionFontValue,
  WordSelectionRunProperty,
  WordSelectionSpanFormat,
  WordSelectionSpanProperty,
} from "./wordSelectionFormatting";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";

/** Body elements a rewrite can neither keep nor echo (PF3); each makes the span context only. */
const STRUCTURE: Readonly<Record<string, keyof WordSelectionHazards>> = {
  vanish: "hiddenText",
  specVanish: "hiddenText",
  webHidden: "hiddenText",
  ins: "trackedChange",
  del: "trackedChange",
  moveFrom: "trackedChange",
  moveTo: "trackedChange",
  rPrChange: "trackedChange",
  pPrChange: "trackedChange",
  fldChar: "field",
  instrText: "field",
  fldSimple: "field",
  sdt: "contentControl",
  hyperlink: "hyperlink",
  footnoteReference: "noteReference",
  endnoteReference: "noteReference",
  commentRangeStart: "commentMark",
  commentRangeEnd: "commentMark",
  commentReference: "commentMark",
  drawing: "inlinePicture",
  pict: "inlinePicture",
  object: "inlinePicture",
  br: "breakOrSymbol",
  cr: "breakOrSymbol",
  sym: "breakOrSymbol",
  ptab: "breakOrSymbol",
  noBreakHyphen: "breakOrSymbol",
  softHyphen: "breakOrSymbol",
  smartTag: "unsupportedFormatting",
  customXml: "unsupportedFormatting",
};

/**
 * The only paragraph content a rewrite keeps: plain runs of text and tabs, and the marks Word writes
 * on its own. Anything else (an equation, ruby text, a permission range, content from another
 * namespace) would be lost or broken by Replace, so the span is context only.
 */
const PLAIN_CONTENT = new Set([
  "r",
  "t",
  "tab",
  "proofErr",
  "lastRenderedPageBreak",
]);

/** Word's own "last edit" bookmark, which it moves freely. */
const WORD_BOOKMARK = "_GoBack";

/** Run properties Word writes on its own that change nothing a rewrite must keep. */
const BENIGN_RUN_PROPERTIES = new Set(["lang", "noProof"]);

const OOXML_UNDERLINE: Readonly<Record<string, string>> = {
  none: "None",
  single: "Single",
  double: "Double",
  words: "Word",
  dotted: "Dotted",
  thick: "Thick",
  wave: "Wave",
  dash: "DashLine",
};

/** Word's highlight names, as the #RRGGBB Font.highlightColor accepts. */
const HIGHLIGHT_HEX: Readonly<Record<string, string>> = {
  yellow: "#FFFF00",
  green: "#00FF00",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  blue: "#0000FF",
  red: "#FF0000",
  darkblue: "#000080",
  darkcyan: "#008080",
  darkgreen: "#008000",
  darkmagenta: "#800080",
  darkred: "#800000",
  darkyellow: "#808000",
  darkgray: "#808080",
  lightgray: "#C0C0C0",
  black: "#000000",
  white: "#FFFFFF",
};

/** Right-to-left and complex-script letters, which the rewrite cannot format like Latin text. */
const COMPLEX_SCRIPT =
  /[\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0FFF\u1000-\u109F\u1780-\u17FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

function children(element: Element | undefined, name?: string): Element[] {
  return element
    ? Array.from(element.children).filter(
        (child) =>
          child.namespaceURI === W && (!name || child.localName === name),
      )
    : [];
}

const attr = (element: Element | undefined, name: string) =>
  element?.getAttributeNS(W, name) ?? null;

function onOff(element: Element | undefined): boolean | undefined {
  if (!element) return undefined;
  const value = attr(element, "val");
  return value === null || !["0", "false", "off"].includes(value);
}

function parsePackage(ooxml: string): Document | null {
  const doc = new DOMParser().parseFromString(ooxml, "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

function packageParts(ooxml: string) {
  const doc = parsePackage(ooxml);
  return doc ? partsOf(doc) : null;
}

function partsOf(doc: Document) {
  const parts = Array.from(doc.getElementsByTagNameNS(PKG, "part"));
  const named = (name: string) =>
    parts.find(
      (part) =>
        (part.getAttributeNS(PKG, "name") ?? part.getAttribute("pkg:name")) ===
        name,
    );
  const main = named("/word/document.xml") ?? doc.documentElement;
  return {
    body: main.getElementsByTagNameNS(W, "body")[0] ?? null,
    styles: named("/word/styles.xml")?.getElementsByTagNameNS(W, "styles")[0],
  };
}

interface RunFormat {
  values: Partial<Record<WordSelectionSpanProperty, WordSelectionFontValue>>;
  bold?: boolean;
  boldTwin?: boolean;
  italic?: boolean;
  italicTwin?: boolean;
  sizeTwin?: number;
  latinFont?: string;
  csFont?: string;
}

function runFormat(rPr: Element | undefined, hazards: WordSelectionHazards) {
  const format: RunFormat = { values: {} };
  for (const property of children(rPr)) {
    const name = property.localName;
    switch (name) {
      case "b":
        format.bold = onOff(property);
        format.values.bold = format.bold ?? null;
        break;
      case "i":
        format.italic = onOff(property);
        format.values.italic = format.italic ?? null;
        break;
      case "strike":
        format.values.strikeThrough = onOff(property) ?? null;
        break;
      case "u": {
        const underline = OOXML_UNDERLINE[attr(property, "val") ?? "single"];
        if (underline) format.values.underline = underline;
        else hazards.unsupportedFormatting = true;
        break;
      }
      case "vertAlign": {
        const align = attr(property, "val");
        format.values.superscript = align === "superscript";
        format.values.subscript = align === "subscript";
        break;
      }
      case "color": {
        const color = attr(property, "val");
        if (color && /^[0-9A-Fa-f]{6}$/.test(color))
          format.values.color = `#${color.toUpperCase()}`;
        else if (color !== "auto") hazards.unsupportedFormatting = true;
        break;
      }
      case "highlight": {
        const highlight = attr(property, "val") ?? "none";
        const hex = HIGHLIGHT_HEX[highlight.toLowerCase()];
        if (hex) format.values.highlightColor = hex;
        else if (highlight !== "none") hazards.unsupportedFormatting = true;
        break;
      }
      case "sz": {
        const halfPoints = Number(attr(property, "val"));
        if (Number.isFinite(halfPoints)) format.values.size = halfPoints / 2;
        else hazards.unsupportedFormatting = true;
        break;
      }
      case "rFonts": {
        const ascii = attr(property, "ascii");
        const hAnsi = attr(property, "hAnsi");
        const themed = [
          "asciiTheme",
          "hAnsiTheme",
          "eastAsia",
          "eastAsiaTheme",
        ].some((key) => attr(property, key) !== null);
        if (themed || (ascii !== null && hAnsi !== null && ascii !== hAnsi))
          hazards.unsupportedFormatting = true;
        const latin = ascii ?? hAnsi;
        if (latin !== null) {
          format.latinFont = latin;
          format.values.name = latin;
        }
        const cs = attr(property, "cs");
        if (cs !== null) format.csFont = cs;
        if (attr(property, "cstheme") !== null) hazards.complexScript = true;
        break;
      }
      case "bCs":
        format.boldTwin = onOff(property);
        break;
      case "iCs":
        format.italicTwin = onOff(property);
        break;
      case "szCs": {
        const halfPoints = Number(attr(property, "val"));
        format.sizeTwin = Number.isFinite(halfPoints) ? halfPoints / 2 : -1;
        break;
      }
      case "rtl":
      case "cs":
        if (onOff(property)) hazards.complexScript = true;
        break;
      case "rStyle":
        hazards.unsupportedFormatting = true;
        break;
      case "vanish":
      case "specVanish":
      case "webHidden":
        hazards.hiddenText = true;
        break;
      case "rPrChange":
        hazards.trackedChange = true;
        break;
      default:
        if (!BENIGN_RUN_PROPERTIES.has(name))
          hazards.unsupportedFormatting = true;
    }
  }
  return format;
}

/** A twin that differs from its Latin value is formatting the rewrite could not keep. */
function twinDiffers(
  twin: boolean | number | string | undefined,
  latin: boolean | number | string | undefined,
): boolean {
  return twin !== undefined && twin !== latin;
}

function spanProperty(
  formats: readonly RunFormat[],
  property: WordSelectionSpanProperty,
): WordSelectionRunProperty | undefined {
  const values = formats.map((format) => format.values[property]);
  if (values.every((value) => value === undefined)) return undefined;
  const first = values[0];
  return first !== undefined && values.every((value) => value === first)
    ? { state: "direct", value: first }
    : { state: "mixed" };
}

const SPAN_PROPERTIES: readonly WordSelectionSpanProperty[] = [
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
];

/**
 * The paragraph mark: a tracked insertion, deletion or format change of it (a paragraph split or
 * joined under Track Changes) is a revision a rewrite cannot settle, and a section break on it
 * would go wherever an Undo restores the paragraph. The web's single-paragraph OOXML has no pPr,
 * so the object model is checked as well.
 */
function scanParagraphMark(pPr: Element, hazards: WordSelectionHazards): void {
  const has = (name: string) => pPr.getElementsByTagNameNS(W, name).length > 0;
  if (["ins", "del", "rPrChange", "pPrChange"].some(has))
    hazards.trackedChange = true;
  if (has("sectPr")) hazards.breakOrSymbol = true;
}

/**
 * Flags every element of the span's paragraphs that is not plain content. Paragraph and run
 * properties are read separately; a known structure gets its own hazard, and anything unknown,
 * including other namespaces, counts as content the rewrite would lose.
 */
function scanStructure(body: Element, hazards: WordSelectionHazards): void {
  const bookmarks = new Map<string, string>();
  const visit = (element: Element) => {
    for (const child of Array.from(element.children)) {
      const name = child.localName;
      if (child.namespaceURI === W && name === "pPr") {
        scanParagraphMark(child, hazards);
        continue;
      }
      if (child.namespaceURI === W && name === "rPr") continue;
      if (child.namespaceURI === W && name === "bookmarkStart") {
        const id = attr(child, "id") ?? "";
        const bookmark = attr(child, "name") ?? "";
        bookmarks.set(id, bookmark);
        if (bookmark !== WORD_BOOKMARK) hazards.bookmark = true;
        continue;
      }
      if (child.namespaceURI === W && name === "bookmarkEnd") {
        if (bookmarks.get(attr(child, "id") ?? "") !== WORD_BOOKMARK)
          hazards.bookmark = true;
        continue;
      }
      const known = child.namespaceURI === W ? STRUCTURE[name] : undefined;
      if (known) hazards[known] = true;
      else if (child.namespaceURI !== W || !PLAIN_CONTENT.has(name))
        hazards.breakOrSymbol = true;
      visit(child);
    }
  };
  for (const child of Array.from(body.children)) {
    if (child.namespaceURI === W && child.localName === "sectPr") continue;
    if (child.namespaceURI === W && child.localName === "p") visit(child);
    else hazards.breakOrSymbol = true;
  }
}

const isW = (element: Element, name: string) =>
  element.namespaceURI === W && element.localName === name;

/**
 * Word for Mac and Word PC answer getOoxml() of a paragraph that ends a table cell with the whole
 * table row, every cell included, and an empty paragraph after the table. This cuts the
 * paragraph's own w:p out of the row and drops that empty paragraph, which a restore would add to
 * the cell, so the span checks judge, and an Undo restores, that paragraph alone, as on the web.
 * The OOXML is returned as it is when it holds no such row, or when the last paragraph of the cell
 * at `cellIndex` does not spell `text`; the scan then finds the table and keeps the span context
 * only.
 */
export function wordCellParagraphOoxml(
  ooxml: string,
  cellIndex: number,
  text: string,
): string {
  const doc = parsePackage(ooxml);
  const body = doc ? partsOf(doc).body : null;
  if (!doc || !body) return ooxml;
  const [table, ...rest] = Array.from(body.children).filter(
    (c) => !isW(c, "sectPr"),
  );
  if (!table || !isW(table, "tbl")) return ooxml;
  if (!rest.every((c) => isW(c, "p") && c.children.length === 0)) return ooxml;
  const rows = Array.from(table.children).filter(
    (c) => !isW(c, "tblPr") && !isW(c, "tblGrid"),
  );
  if (rows.length !== 1 || !isW(rows[0], "tr")) return ooxml;
  const cells = Array.from(rows[0].children).filter(
    (c) => !isW(c, "trPr") && !isW(c, "tblPrEx"),
  );
  if (!cells.every((c) => isW(c, "tc"))) return ooxml;
  const paragraph = cells[cellIndex]?.lastElementChild;
  if (!paragraph || !isW(paragraph, "p")) return ooxml;
  const runs = Array.from(paragraph.getElementsByTagNameNS(W, "r")).filter(
    (run) => run.parentElement?.localName !== "del",
  );
  if (runCharacters(runs).text !== text) return ooxml;
  body.replaceChild(paragraph, table);
  for (const empty of rest) body.removeChild(empty);
  const serialized = new XMLSerializer().serializeToString(doc);
  const declaration = /^\s*<\?xml[^?]*\?>/.exec(ooxml)?.[0];
  return declaration && !serialized.startsWith("<?xml")
    ? declaration + serialized
    : serialized;
}

export interface WordSelectionSpanScan {
  hazards: WordSelectionHazards;
  format: WordSelectionSpanFormat;
  /** The direct values of the runs on either side of a slice; empty for a whole paragraph. */
  edges: WordSelectionEdgeFormat[];
}

/** The part of a paragraph a scan formats, in paragraph.text offsets. */
export interface WordSelectionSpanSlice {
  start: number;
  /** Exclusive. */
  end: number;
  /** paragraph.text, which the runs' text must spell exactly for the offsets to hold. */
  rangeText: string;
}

/** Each character of the runs' text, w:tab as "\t", with the run that holds it. */
function runCharacters(runs: readonly Element[]) {
  const owners: number[] = [];
  let text = "";
  runs.forEach((run, index) => {
    for (const child of children(run)) {
      const piece =
        child.localName === "t"
          ? (child.textContent ?? "")
          : child.localName === "tab"
            ? "\t"
            : "";
      text += piece;
      for (let k = 0; k < piece.length; k += 1) owners.push(index);
    }
  });
  return { text, owners };
}

/**
 * What a span's own OOXML holds: the content a rewrite cannot keep, and each font property's run
 * values. The paragraph mark's properties are not part of the span. Some wrappers (a hyperlink or
 * content control around the span, a field around its result) are missing from a span's own OOXML
 * (PF3), so the object model is checked as well. An unreadable package fails closed.
 *
 * With a slice, the hazards still cover the whole paragraph, but the format, and the hazards of its
 * mixed toggles (complexScriptTwin, mixedScript), come from the slice's characters only, and the
 * runs touching it are returned as its edges.
 */
export function scanWordSelectionSpan(
  ooxml: string,
  slice?: WordSelectionSpanSlice,
): WordSelectionSpanScan {
  const parts = packageParts(ooxml);
  const hazards: WordSelectionHazards = {};
  if (!parts?.body)
    return { hazards: { unsupportedFormatting: true }, format: {}, edges: [] };
  scanStructure(parts.body, hazards);
  const runs = Array.from(parts.body.getElementsByTagNameNS(W, "r")).filter(
    (run) => run.parentElement?.localName !== "del",
  );
  const texts = runs.flatMap((run) =>
    children(run, "t").map((t) => t.textContent ?? ""),
  );
  if (texts.some((text) => COMPLEX_SCRIPT.test(text)))
    hazards.complexScript = true;
  const runFormats = runs.map((run) =>
    children(run, "t").length > 0
      ? runFormat(children(run, "rPr")[0], hazards)
      : null,
  );
  const formats = runFormats.filter((f): f is RunFormat => f !== null);
  for (const format of formats)
    if (
      twinDiffers(format.boldTwin, format.bold) ||
      twinDiffers(format.italicTwin, format.italic) ||
      twinDiffers(format.sizeTwin, format.values.size as number | undefined) ||
      twinDiffers(format.csFont, format.latinFont)
    )
      hazards.complexScript = true;
  let spanFormats = formats;
  const edges: WordSelectionEdgeFormat[] = [];
  if (slice) {
    const { text, owners } = runCharacters(runs);
    if (text !== slice.rangeText) hazards.textMismatch = true;
    const inSlice = new Set(owners.slice(slice.start, slice.end));
    spanFormats = runFormats.filter(
      (f, index): f is RunFormat => f !== null && inSlice.has(index),
    );
    for (const at of [slice.start - 1, slice.end]) {
      const edge = at >= 0 ? runFormats[owners[at]] : undefined;
      if (edge) edges.push(edge.values);
    }
  }
  const format: WordSelectionSpanFormat = {};
  for (const property of SPAN_PROPERTIES) {
    const value = spanProperty(spanFormats, property);
    if (value) format[property] = value;
  }
  const mixedWithTwin = (
    latin: "bold" | "italic",
    twin: "boldTwin" | "italicTwin",
  ) =>
    format[latin]?.state === "mixed" &&
    spanFormats.some((f) => f[twin] !== undefined && f[twin] === f[latin]);
  if (
    mixedWithTwin("bold", "boldTwin") ||
    mixedWithTwin("italic", "italicTwin")
  )
    hazards.complexScriptTwin = true;
  // An explicit baseline next to unset text is still one baseline.
  const raisedInPart = (property: "superscript" | "subscript") =>
    format[property]?.state === "mixed" &&
    spanFormats.some((f) => f.values[property] === true);
  if (raisedInPart("superscript") || raisedInPart("subscript"))
    hazards.mixedScript = true;
  return { hazards, format, edges };
}

/**
 * The toggles a paragraph style gives its text, from the package's styles part: docDefaults, then
 * the basedOn chain. The style is found by the paragraph's pStyle where the package has one
 * (desktop), else by name as Paragraph.style reports it (the web gives the OOXML w:name, desktop the
 * display name). Null when the style is not in the package.
 */
export function wordSelectionStyleToggles(
  ooxml: string,
  styleName: string,
): WordSelectionFont | null {
  const parts = packageParts(ooxml);
  if (!parts?.styles) return null;
  const styles = children(parts.styles, "style");
  const styleId = (style: Element) => attr(style, "styleId") ?? "";
  const pStyle = parts.body
    ? attr(parts.body.getElementsByTagNameNS(W, "pStyle")[0], "val")
    : null;
  const wanted = styleName.trim().toLowerCase();
  const start =
    (pStyle && styles.find((style) => styleId(style) === pStyle)) ||
    styles.find(
      (style) =>
        attr(children(style, "name")[0], "val")?.toLowerCase() === wanted ||
        styleId(style).toLowerCase() === wanted.replace(/\s+/g, ""),
    );
  if (!start) return null;
  const chain: Element[] = [];
  for (
    let style: Element | undefined = start;
    style && !chain.includes(style);
    style = styles.find(
      (candidate) =>
        styleId(candidate) === attr(children(style, "basedOn")[0], "val"),
    )
  )
    chain.push(style);
  const layers = [
    parts.styles
      .getElementsByTagNameNS(W, "rPrDefault")[0]
      ?.getElementsByTagNameNS(W, "rPr")[0],
    ...chain.reverse().map((style) => children(style, "rPr")[0]),
  ];
  const ignored: WordSelectionHazards = {};
  const merged: RunFormat["values"] = {};
  for (const rPr of layers)
    Object.assign(merged, runFormat(rPr, ignored).values);
  return {
    bold: merged.bold ?? false,
    italic: merged.italic ?? false,
    underline: merged.underline ?? "None",
    strikeThrough: merged.strikeThrough ?? false,
    superscript: merged.superscript ?? false,
    subscript: merged.subscript ?? false,
  };
}
