/** Typed direct formatting. Public measurements are points, never OOXML units. */
export interface WordRunFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  underlineStyle?: "single" | "double" | "dotted" | "dash" | "wave";
  strike?: boolean;
  caps?: boolean;
  smallCaps?: boolean;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  highlight?:
    | "none"
    | "black"
    | "blue"
    | "cyan"
    | "green"
    | "magenta"
    | "red"
    | "yellow"
    | "white"
    | "darkBlue"
    | "darkCyan"
    | "darkGreen"
    | "darkMagenta"
    | "darkRed"
    | "darkYellow"
    | "darkGray"
    | "lightGray";
  shading?: string;
  verticalAlign?: "baseline" | "superscript" | "subscript";
  characterSpacing?: number;
  language?: string;
}

export interface WordBorder {
  style: "none" | "single" | "double" | "dotted" | "dashed" | "thick";
  color?: string;
  width?: number;
  space?: number;
}

export interface WordBorders {
  top?: WordBorder;
  left?: WordBorder;
  bottom?: WordBorder;
  right?: WordBorder;
  between?: WordBorder;
  insideH?: WordBorder;
  insideV?: WordBorder;
}

export interface WordParagraphFormatting {
  alignment?: "left" | "center" | "right" | "justify";
  spacingBefore?: number;
  spacingAfter?: number;
  lineSpacing?: { value: number; rule: "multiple" | "exact" | "atLeast" };
  indentLeft?: number;
  indentRight?: number;
  firstLineIndent?: number;
  keepNext?: boolean;
  keepTogether?: boolean;
  pageBreakBefore?: boolean;
  widowControl?: boolean;
  shading?: string;
  borders?: WordBorders;
  /** Defaults for every text run, as well as the paragraph mark. */
  font?: WordRunFormatting;
}

export const WORDPROCESSING_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const only = (v: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(v).every((key) => allowed.includes(key));
const between = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const color = (v: unknown): v is string =>
  typeof v === "string" && /^(?:auto|#?[0-9a-fA-F]{6})$/.test(v);
const normalizedColor = (v: string) =>
  v === "auto" ? v : v.replace(/^#/, "").toUpperCase();
const enumValue = (v: unknown, values: readonly string[]) =>
  typeof v === "string" && values.includes(v);
const runBooleans = [
  "bold",
  "italic",
  "underline",
  "strike",
  "caps",
  "smallCaps",
] as const;
export const WORD_RUN_FORMATTING_KEYS = [
  ...runBooleans,
  "underlineStyle",
  "fontFamily",
  "fontSize",
  "color",
  "highlight",
  "shading",
  "verticalAlign",
  "characterSpacing",
  "language",
] as const;
const highlights = [
  "none",
  "black",
  "blue",
  "cyan",
  "green",
  "magenta",
  "red",
  "yellow",
  "white",
  "darkBlue",
  "darkCyan",
  "darkGreen",
  "darkMagenta",
  "darkRed",
  "darkYellow",
  "darkGray",
  "lightGray",
];
const underlineStyles = ["single", "double", "dotted", "dash", "wave"];

/** Extra keys allow the run parser to validate { text, ...format } in one pass. */
export function parseWordRunFormatting(
  value: unknown,
  extraKeys: readonly string[] = [],
): WordRunFormatting | null {
  if (
    !object(value) ||
    !only(value, [...WORD_RUN_FORMATTING_KEYS, ...extraKeys])
  )
    return null;
  if (
    runBooleans.some(
      (key) => value[key] !== undefined && typeof value[key] !== "boolean",
    ) ||
    (value.underlineStyle !== undefined &&
      (!enumValue(value.underlineStyle, underlineStyles) ||
        value.underline === false)) ||
    (value.fontFamily !== undefined &&
      (typeof value.fontFamily !== "string" ||
        !value.fontFamily.trim() ||
        value.fontFamily.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(value.fontFamily))) ||
    (value.fontSize !== undefined &&
      (!between(value.fontSize, 0.5, 1638) ||
        !Number.isInteger(value.fontSize * 2))) ||
    [value.color, value.shading].some((v) => v !== undefined && !color(v)) ||
    (value.highlight !== undefined &&
      !enumValue(value.highlight, highlights)) ||
    (value.verticalAlign !== undefined &&
      !enumValue(value.verticalAlign, [
        "baseline",
        "superscript",
        "subscript",
      ])) ||
    (value.characterSpacing !== undefined &&
      !between(value.characterSpacing, -1584, 1584)) ||
    (value.language !== undefined &&
      (typeof value.language !== "string" ||
        !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8}){0,5}$/.test(value.language)))
  )
    return null;
  const result = Object.fromEntries(
    WORD_RUN_FORMATTING_KEYS.filter((key) => value[key] !== undefined).map(
      (key) => [
        key,
        key === "color" || key === "shading"
          ? normalizedColor(value[key] as string)
          : value[key],
      ],
    ),
  );
  return result;
}

export function parseWordBorders(value: unknown): WordBorders | null {
  if (
    !object(value) ||
    !only(value, [
      "top",
      "left",
      "bottom",
      "right",
      "between",
      "insideH",
      "insideV",
    ])
  )
    return null;
  const result: Record<string, WordBorder> = {};
  for (const [side, border] of Object.entries(value)) {
    if (
      !object(border) ||
      !only(border, ["style", "color", "width", "space"]) ||
      !enumValue(border.style, [
        "none",
        "single",
        "double",
        "dotted",
        "dashed",
        "thick",
      ]) ||
      (border.color !== undefined && !color(border.color)) ||
      (border.width !== undefined &&
        (!between(border.width, 0.25, 12) ||
          !Number.isInteger(border.width * 8))) ||
      (border.space !== undefined &&
        (!between(border.space, 0, 31) || !Number.isInteger(border.space)))
    )
      return null;
    result[side] = {
      ...(border as unknown as WordBorder),
      ...(border.color ? { color: normalizedColor(border.color) } : {}),
    };
  }
  return result;
}

export function parseWordParagraphFormatting(
  value: unknown,
): WordParagraphFormatting | null {
  const bools = ["keepNext", "keepTogether", "pageBreakBefore", "widowControl"];
  const points = ["spacingBefore", "spacingAfter", "indentLeft", "indentRight"];
  if (
    !object(value) ||
    !only(value, [
      ...bools,
      ...points,
      "alignment",
      "lineSpacing",
      "firstLineIndent",
      "shading",
      "borders",
      "font",
    ]) ||
    bools.some(
      (key) => value[key] !== undefined && typeof value[key] !== "boolean",
    ) ||
    points.some(
      (key) => value[key] !== undefined && !between(value[key], 0, 1584),
    ) ||
    (value.firstLineIndent !== undefined &&
      !between(value.firstLineIndent, -1584, 1584)) ||
    (value.alignment !== undefined &&
      !enumValue(value.alignment, ["left", "center", "right", "justify"])) ||
    (value.shading !== undefined && !color(value.shading))
  )
    return null;
  if (value.lineSpacing !== undefined) {
    const line = value.lineSpacing;
    if (
      !object(line) ||
      !only(line, ["value", "rule"]) ||
      !enumValue(line.rule, ["multiple", "exact", "atLeast"]) ||
      !between(line.value, 0.05, line.rule === "multiple" ? 10 : 1584)
    )
      return null;
  }
  const borders =
    value.borders === undefined ? undefined : parseWordBorders(value.borders);
  const font =
    value.font === undefined ? undefined : parseWordRunFormatting(value.font);
  if (borders === null || font === null) return null;
  if (borders && (borders.insideH || borders.insideV)) return null;
  return {
    ...(value as WordParagraphFormatting),
    ...(value.shading ? { shading: normalizedColor(value.shading) } : {}),
    ...(borders ? { borders } : {}),
    ...(font ? { font } : {}),
  };
}

export function wordChild(
  parent: Element | undefined,
  local: string,
): Element | undefined {
  return (
    parent &&
    Array.from(parent.children).find(
      (child) =>
        child.namespaceURI === WORDPROCESSING_NS && child.localName === local,
    )
  );
}
export function wordAttribute(
  element: Element | undefined,
  local = "val",
): string {
  return element?.getAttributeNS(WORDPROCESSING_NS, local) ?? "";
}
export function wordElement(
  doc: Document,
  local: string,
  value?: string,
): Element {
  const result = doc.createElementNS(WORDPROCESSING_NS, `w:${local}`);
  if (value !== undefined)
    result.setAttributeNS(WORDPROCESSING_NS, "w:val", value);
  return result;
}
export function setWordAttribute(
  element: Element,
  name: string,
  value: string | number,
): void {
  element.setAttributeNS(WORDPROCESSING_NS, `w:${name}`, String(value));
}

// CT_* property order is significant to consumers that validate OOXML strictly.
const propertyOrder: Record<string, string[]> = {
  pBdr: ["top", "left", "bottom", "right", "between", "bar"],
  tblBorders: [
    "top",
    "start",
    "left",
    "bottom",
    "end",
    "right",
    "insideH",
    "insideV",
  ],
  tcBorders: [
    "top",
    "start",
    "left",
    "bottom",
    "end",
    "right",
    "insideH",
    "insideV",
    "tl2br",
    "tr2bl",
  ],
  tcMar: ["top", "start", "left", "bottom", "end", "right"],
  tblCellMar: ["top", "start", "left", "bottom", "end", "right"],
  rPr: [
    "rStyle",
    "rFonts",
    "b",
    "bCs",
    "i",
    "iCs",
    "caps",
    "smallCaps",
    "strike",
    "dstrike",
    "outline",
    "shadow",
    "emboss",
    "imprint",
    "noProof",
    "snapToGrid",
    "vanish",
    "webHidden",
    "color",
    "spacing",
    "w",
    "kern",
    "position",
    "sz",
    "szCs",
    "highlight",
    "u",
    "effect",
    "bdr",
    "shd",
    "fitText",
    "vertAlign",
    "rtl",
    "cs",
    "em",
    "lang",
    "eastAsianLayout",
    "specVanish",
    "oMath",
    "rPrChange",
  ],
  pPr: [
    "pStyle",
    "keepNext",
    "keepLines",
    "pageBreakBefore",
    "framePr",
    "widowControl",
    "numPr",
    "suppressLineNumbers",
    "pBdr",
    "shd",
    "tabs",
    "suppressAutoHyphens",
    "kinsoku",
    "wordWrap",
    "overflowPunct",
    "topLinePunct",
    "autoSpaceDE",
    "autoSpaceDN",
    "bidi",
    "adjustRightInd",
    "snapToGrid",
    "spacing",
    "ind",
    "contextualSpacing",
    "mirrorIndents",
    "suppressOverlap",
    "jc",
    "textDirection",
    "textAlignment",
    "textboxTightWrap",
    "outlineLvl",
    "divId",
    "cnfStyle",
    "rPr",
    "sectPr",
    "pPrChange",
  ],
  tblPr: [
    "tblStyle",
    "tblpPr",
    "tblOverlap",
    "bidiVisual",
    "tblStyleRowBandSize",
    "tblStyleColBandSize",
    "tblW",
    "jc",
    "tblCellSpacing",
    "tblInd",
    "tblBorders",
    "shd",
    "tblLayout",
    "tblCellMar",
    "tblLook",
    "tblCaption",
    "tblDescription",
    "tblPrChange",
  ],
  trPr: [
    "cnfStyle",
    "divId",
    "gridBefore",
    "gridAfter",
    "wBefore",
    "wAfter",
    "cantSplit",
    "trHeight",
    "tblHeader",
    "tblCellSpacing",
    "jc",
    "hidden",
    "ins",
    "del",
    "trPrChange",
  ],
  tcPr: [
    "cnfStyle",
    "tcW",
    "gridSpan",
    "hMerge",
    "vMerge",
    "tcBorders",
    "shd",
    "noWrap",
    "tcMar",
    "textDirection",
    "tcFitText",
    "vAlign",
    "hideMark",
    "headers",
    "cellIns",
    "cellDel",
    "cellMerge",
    "tcPrChange",
  ],
};

/** Replace one owned property; keep all other properties and extension metadata. */
export function putWordProperty(parent: Element, value: Element): void {
  const existing = wordChild(parent, value.localName);
  if (existing) {
    parent.replaceChild(value, existing);
    return;
  }
  const order = propertyOrder[parent.localName] ?? [];
  const position = order.indexOf(value.localName);
  const next = Array.from(parent.children).find(
    (child) =>
      child.namespaceURI === WORDPROCESSING_NS &&
      order.indexOf(child.localName) > position,
  );
  parent.insertBefore(value, next ?? null);
}
const editableProperty = (parent: Element, name: string) =>
  (wordChild(parent, name)?.cloneNode(true) as Element | undefined) ??
  wordElement(parent.ownerDocument, name);
const removeAttributes = (element: Element, names: string[]) =>
  names.forEach((name) => element.removeAttributeNS(WORDPROCESSING_NS, name));

export function applyWordBorders(
  parent: Element,
  property: string,
  value: WordBorders,
): void {
  const borders = editableProperty(parent, property);
  for (const [name, border] of Object.entries(value)) {
    const b = wordElement(
      parent.ownerDocument,
      name,
      border.style === "none" ? "nil" : border.style,
    );
    if (border.style !== "none") {
      setWordAttribute(b, "color", normalizedColor(border.color ?? "auto"));
      setWordAttribute(b, "sz", Math.round((border.width ?? 0.5) * 8));
      setWordAttribute(b, "space", border.space ?? 0);
    }
    putWordProperty(borders, b);
  }
  putWordProperty(parent, borders);
}
export function applyWordShading(parent: Element, fill: string): void {
  const shading = wordElement(parent.ownerDocument, "shd", "clear");
  setWordAttribute(shading, "color", "auto");
  setWordAttribute(shading, "fill", normalizedColor(fill));
  putWordProperty(parent, shading);
}

export function applyWordRunFormatting(
  parent: Element,
  value: WordRunFormatting,
): void {
  const doc = parent.ownerDocument;
  const booleans = {
    bold: "b",
    italic: "i",
    strike: "strike",
    caps: "caps",
    smallCaps: "smallCaps",
  } as const;
  for (const [key, tag] of Object.entries(booleans)) {
    const enabled = value[key as keyof typeof booleans];
    if (enabled !== undefined)
      putWordProperty(parent, wordElement(doc, tag, enabled ? "1" : "0"));
  }
  if (value.underline !== undefined || value.underlineStyle !== undefined)
    putWordProperty(
      parent,
      wordElement(
        doc,
        "u",
        value.underline === false ? "none" : (value.underlineStyle ?? "single"),
      ),
    );
  if (value.fontFamily !== undefined) {
    const font = editableProperty(parent, "rFonts");
    removeAttributes(font, [
      "asciiTheme",
      "hAnsiTheme",
      "eastAsiaTheme",
      "cstheme",
      "csTheme",
    ]);
    ["ascii", "hAnsi", "eastAsia", "cs"].forEach((name) =>
      setWordAttribute(font, name, value.fontFamily!),
    );
    putWordProperty(parent, font);
  }
  if (value.fontSize !== undefined) {
    ["sz", "szCs"].forEach((tag) =>
      putWordProperty(
        parent,
        wordElement(doc, tag, String(value.fontSize! * 2)),
      ),
    );
  }
  if (value.color !== undefined)
    putWordProperty(
      parent,
      wordElement(doc, "color", normalizedColor(value.color)),
    );
  if (value.highlight !== undefined)
    putWordProperty(parent, wordElement(doc, "highlight", value.highlight));
  if (value.shading !== undefined) applyWordShading(parent, value.shading);
  if (value.verticalAlign !== undefined)
    putWordProperty(parent, wordElement(doc, "vertAlign", value.verticalAlign));
  if (value.characterSpacing !== undefined)
    putWordProperty(
      parent,
      wordElement(
        doc,
        "spacing",
        String(Math.round(value.characterSpacing * 20)),
      ),
    );
  if (value.language !== undefined) {
    const lang = editableProperty(parent, "lang");
    setWordAttribute(lang, "val", value.language);
    putWordProperty(parent, lang);
  }
}

export function applyWordParagraphFormatting(
  parent: Element,
  value: WordParagraphFormatting,
): void {
  const doc = parent.ownerDocument;
  if (value.alignment !== undefined)
    putWordProperty(
      parent,
      wordElement(
        doc,
        "jc",
        value.alignment === "justify" ? "both" : value.alignment,
      ),
    );
  const booleans = {
    keepNext: "keepNext",
    keepTogether: "keepLines",
    pageBreakBefore: "pageBreakBefore",
    widowControl: "widowControl",
  } as const;
  for (const [key, tag] of Object.entries(booleans)) {
    const enabled = value[key as keyof typeof booleans];
    if (enabled !== undefined)
      putWordProperty(parent, wordElement(doc, tag, enabled ? "1" : "0"));
  }
  if (
    value.spacingBefore !== undefined ||
    value.spacingAfter !== undefined ||
    value.lineSpacing !== undefined
  ) {
    const spacing = editableProperty(parent, "spacing");
    if (value.spacingBefore !== undefined) {
      removeAttributes(spacing, ["beforeLines", "beforeAutospacing"]);
      setWordAttribute(spacing, "before", Math.round(value.spacingBefore * 20));
    }
    if (value.spacingAfter !== undefined) {
      removeAttributes(spacing, ["afterLines", "afterAutospacing"]);
      setWordAttribute(spacing, "after", Math.round(value.spacingAfter * 20));
    }
    if (value.lineSpacing) {
      setWordAttribute(
        spacing,
        "line",
        Math.round(
          value.lineSpacing.value *
            (value.lineSpacing.rule === "multiple" ? 240 : 20),
        ),
      );
      setWordAttribute(
        spacing,
        "lineRule",
        value.lineSpacing.rule === "multiple" ? "auto" : value.lineSpacing.rule,
      );
    }
    putWordProperty(parent, spacing);
  }
  if (
    value.indentLeft !== undefined ||
    value.indentRight !== undefined ||
    value.firstLineIndent !== undefined
  ) {
    const ind = editableProperty(parent, "ind");
    if (value.indentLeft !== undefined) {
      removeAttributes(ind, ["start", "startChars", "leftChars"]);
      setWordAttribute(ind, "left", Math.round(value.indentLeft * 20));
    }
    if (value.indentRight !== undefined) {
      removeAttributes(ind, ["end", "endChars", "rightChars"]);
      setWordAttribute(ind, "right", Math.round(value.indentRight * 20));
    }
    if (value.firstLineIndent !== undefined) {
      removeAttributes(ind, [
        "firstLine",
        "hanging",
        "firstLineChars",
        "hangingChars",
      ]);
      setWordAttribute(
        ind,
        value.firstLineIndent < 0 ? "hanging" : "firstLine",
        Math.round(Math.abs(value.firstLineIndent) * 20),
      );
    }
    putWordProperty(parent, ind);
  }
  if (value.shading !== undefined) applyWordShading(parent, value.shading);
  if (value.borders !== undefined)
    applyWordBorders(parent, "pBdr", value.borders);
  if (value.font !== undefined) {
    const font = editableProperty(parent, "rPr");
    applyWordRunFormatting(font, value.font);
    putWordProperty(parent, font);
  }
}

const on = (element: Element) =>
  !["0", "false", "off"].includes(wordAttribute(element));
const readNumber = (
  element: Element | undefined,
  attribute: string,
  divisor = 1,
) => {
  const raw = wordAttribute(element, attribute);
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) ? n / divisor : undefined;
};

export function readWordRunFormatting(
  parent: Element | undefined,
): WordRunFormatting {
  if (!parent) return {};
  const result: WordRunFormatting = {};
  for (const [key, tag] of Object.entries({
    bold: "b",
    italic: "i",
    strike: "strike",
    caps: "caps",
    smallCaps: "smallCaps",
  } as const)) {
    const prop = wordChild(parent, tag);
    if (prop)
      result[key as "bold" | "italic" | "strike" | "caps" | "smallCaps"] =
        on(prop);
  }
  const underline = wordChild(parent, "u");
  if (underline) {
    const style = wordAttribute(underline) || "single";
    result.underline = style !== "none";
    if (style !== "single" && underlineStyles.includes(style))
      result.underlineStyle = style as WordRunFormatting["underlineStyle"];
  }
  const family =
    wordAttribute(wordChild(parent, "rFonts"), "ascii") ||
    wordAttribute(wordChild(parent, "rFonts"), "hAnsi");
  if (family) result.fontFamily = family;
  const size = readNumber(wordChild(parent, "sz"), "val", 2);
  if (size !== undefined) result.fontSize = size;
  const textColor = wordAttribute(wordChild(parent, "color"));
  if (color(textColor)) result.color = normalizedColor(textColor);
  const highlight = wordAttribute(wordChild(parent, "highlight"));
  if (highlights.includes(highlight))
    result.highlight = highlight as WordRunFormatting["highlight"];
  const shading = wordAttribute(wordChild(parent, "shd"), "fill");
  if (color(shading)) result.shading = normalizedColor(shading);
  const alignment = wordAttribute(wordChild(parent, "vertAlign"));
  if (["baseline", "superscript", "subscript"].includes(alignment))
    result.verticalAlign = alignment as WordRunFormatting["verticalAlign"];
  const spacing = readNumber(wordChild(parent, "spacing"), "val", 20);
  if (spacing !== undefined) result.characterSpacing = spacing;
  const language = wordAttribute(wordChild(parent, "lang"));
  if (language) result.language = language;
  return result;
}

export function readWordBorders(
  parent: Element | undefined,
): WordBorders | undefined {
  if (!parent) return undefined;
  const result: WordBorders = {};
  for (const side of [
    "top",
    "left",
    "bottom",
    "right",
    "between",
    "insideH",
    "insideV",
  ] as const) {
    const e = wordChild(parent, side);
    if (!e) continue;
    const raw = wordAttribute(e);
    const style = raw === "nil" ? "none" : raw;
    if (
      !["none", "single", "double", "dotted", "dashed", "thick"].includes(style)
    )
      continue;
    const width = readNumber(e, "sz", 8);
    const space = readNumber(e, "space");
    const c = wordAttribute(e, "color");
    result[side] = {
      style: style as WordBorder["style"],
      ...(color(c) ? { color: normalizedColor(c) } : {}),
      ...(width === undefined ? {} : { width }),
      ...(space === undefined ? {} : { space }),
    };
  }
  return Object.keys(result).length ? result : undefined;
}

export function readWordParagraphFormatting(
  parent: Element | undefined,
): WordParagraphFormatting {
  if (!parent) return {};
  const result: WordParagraphFormatting = {};
  const alignment = wordAttribute(wordChild(parent, "jc"));
  if (["left", "center", "right", "both"].includes(alignment))
    result.alignment =
      alignment === "both"
        ? "justify"
        : (alignment as WordParagraphFormatting["alignment"]);
  for (const [key, tag] of Object.entries({
    keepNext: "keepNext",
    keepTogether: "keepLines",
    pageBreakBefore: "pageBreakBefore",
    widowControl: "widowControl",
  } as const)) {
    const e = wordChild(parent, tag);
    if (e)
      result[
        key as "keepNext" | "keepTogether" | "pageBreakBefore" | "widowControl"
      ] = on(e);
  }
  const spacing = wordChild(parent, "spacing");
  const before = readNumber(spacing, "before", 20);
  const after = readNumber(spacing, "after", 20);
  if (before !== undefined) result.spacingBefore = before;
  if (after !== undefined) result.spacingAfter = after;
  const line = readNumber(spacing, "line");
  const rule = wordAttribute(spacing, "lineRule") || "auto";
  if (line !== undefined && ["auto", "exact", "atLeast"].includes(rule))
    result.lineSpacing = {
      value: line / (rule === "auto" ? 240 : 20),
      rule: rule === "auto" ? "multiple" : (rule as "exact" | "atLeast"),
    };
  const ind = wordChild(parent, "ind");
  const left = readNumber(ind, "left", 20);
  const right = readNumber(ind, "right", 20);
  const first = readNumber(ind, "firstLine", 20);
  const hanging = readNumber(ind, "hanging", 20);
  if (left !== undefined) result.indentLeft = left;
  if (right !== undefined) result.indentRight = right;
  if (hanging !== undefined) result.firstLineIndent = -hanging;
  else if (first !== undefined) result.firstLineIndent = first;
  const fill = wordAttribute(wordChild(parent, "shd"), "fill");
  if (color(fill)) result.shading = normalizedColor(fill);
  const borders = readWordBorders(wordChild(parent, "pBdr"));
  if (borders) result.borders = borders;
  const font = readWordRunFormatting(wordChild(parent, "rPr"));
  if (Object.keys(font).length) result.font = font;
  return result;
}
