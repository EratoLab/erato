import type { WordSelectionHazards } from "./wordSelectionAnchor";
import type {
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

function packageParts(ooxml: string) {
  const doc = new DOMParser().parseFromString(ooxml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return null;
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

export interface WordSelectionSpanScan {
  hazards: WordSelectionHazards;
  format: WordSelectionSpanFormat;
}

/**
 * What a span's own OOXML holds: the content a rewrite cannot keep, and each font property's run
 * values. The paragraph mark's properties are not part of the span. Some wrappers (a hyperlink or
 * content control around the span, a field around its result) are missing from a span's own OOXML
 * (PF3), so the object model is checked as well. An unreadable package fails closed.
 */
export function scanWordSelectionSpan(ooxml: string): WordSelectionSpanScan {
  const parts = packageParts(ooxml);
  const hazards: WordSelectionHazards = {};
  if (!parts?.body)
    return { hazards: { unsupportedFormatting: true }, format: {} };
  for (const element of Array.from(parts.body.getElementsByTagNameNS(W, "*"))) {
    const hazard = STRUCTURE[element.localName];
    if (hazard) hazards[hazard] = true;
  }
  const runs = Array.from(parts.body.getElementsByTagNameNS(W, "r")).filter(
    (run) => run.parentElement?.localName !== "del",
  );
  const texts = runs.flatMap((run) =>
    children(run, "t").map((t) => t.textContent ?? ""),
  );
  if (texts.some((text) => COMPLEX_SCRIPT.test(text)))
    hazards.complexScript = true;
  const formats = runs
    .filter((run) => children(run, "t").length > 0)
    .map((run) => runFormat(children(run, "rPr")[0], hazards));
  for (const format of formats)
    if (
      twinDiffers(format.boldTwin, format.bold) ||
      twinDiffers(format.italicTwin, format.italic) ||
      twinDiffers(format.sizeTwin, format.values.size as number | undefined) ||
      twinDiffers(format.csFont, format.latinFont)
    )
      hazards.complexScript = true;
  const format: WordSelectionSpanFormat = {};
  for (const property of SPAN_PROPERTIES) {
    const value = spanProperty(formats, property);
    if (value) format[property] = value;
  }
  const mixedWithTwin = (
    latin: "bold" | "italic",
    twin: "boldTwin" | "italicTwin",
  ) =>
    format[latin]?.state === "mixed" &&
    formats.some((f) => f[twin] !== undefined && f[twin] === f[latin]);
  if (
    mixedWithTwin("bold", "boldTwin") ||
    mixedWithTwin("italic", "italicTwin")
  )
    hazards.complexScriptTwin = true;
  return { hazards, format };
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
