const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const XMLNS = "http://www.w3.org/2000/xmlns/";

export type WordHousekeepingId =
  | "list-instance-id"
  | "table-look"
  | "theme-font-language"
  | "proofing-language";

export interface WordHousekeepingEntry {
  id: WordHousekeepingId;
  element: string;
  part: string;
  hosts: readonly ("Word for the web" | "Word PC" | "Word for Mac")[];
  /** The native run that showed Word changing it with nobody editing. */
  probe: string;
  /** "body-read": wherever a Body.getOoxml read is fingerprinted or compared; "written": a write's
   * result, compared against the document it replaced. */
  scope: "body-read" | "written";
}

/**
 * Changes Word makes to a document on its own. Fingerprints, write verification and Revert's
 * staleness checks compare through these rules in their scope, so none of them reads one as a
 * document change; each rule keeps a real change of the same element visible.
 */
export const WORD_HOUSEKEEPING: readonly WordHousekeepingEntry[] = [
  {
    id: "list-instance-id",
    element: "w:num/@w16cid:durableId",
    part: "/word/numbering.xml",
    hosts: ["Word for the web"],
    probe: "ERMAIN-961 F3: a new value on every Body.getOoxml read",
    scope: "body-read",
  },
  {
    id: "table-look",
    element:
      "w:tblPr/w:tblLook unset, 0000 or 04A0, on a table whose style has no conditional formatting",
    part: "/word/document.xml",
    hosts: ["Word for the web"],
    probe:
      "ERMAIN-961 bodyReads2 base-web.docx (2 of 30 reads); ERMAIN-970 reads@main base-web.docx (1 of 30)",
    scope: "body-read",
  },
  {
    id: "theme-font-language",
    element: "w:themeFontLang/@w:val, its region only (en-GB, en-US)",
    part: "/word/settings.xml",
    hosts: ["Word for the web"],
    probe:
      "ERMAIN-961 bodyReads2 v3c-multi.docx (1 of 30 reads); ERMAIN-970 reads@main v3c-multi.docx (6 of 30)",
    scope: "body-read",
  },
  {
    id: "proofing-language",
    element:
      "w:lang with only w:val in a written paragraph's mark or run, valued as a paragraph the write replaced",
    part: "/word/document.xml",
    hosts: ["Word PC", "Word for Mac"],
    probe:
      "ERMAIN-970 lang@main de-h2, de-reword-en, de-short (Word PC); de-h2-settled, de-short-settled (Word for Mac)",
    scope: "written",
  },
];

const elements = (root: Document | Element, local: string) =>
  Array.from(root.getElementsByTagNameNS(W, local));
const child = (e: Element, local: string) =>
  Array.from(e.children).find(
    (c) => c.namespaceURI === W && c.localName === local,
  );
const ownAttributes = (element: Element) =>
  Array.from(element.attributes).filter((a) => a.namespaceURI !== XMLNS);

const LOOK_FLAGS: Record<string, number> = {
  firstRow: 0x20,
  lastRow: 0x40,
  firstColumn: 0x80,
  lastColumn: 0x100,
  noHBand: 0x200,
  noVBand: 0x400,
};
/** The looks Word for the web alternates between, read after read, for a table without its own. */
const UNSET_LOOKS = new Set([0x0000, 0x04a0]);

function tableLookMask(look: Element): number | undefined {
  let mask = 0;
  let flags = false;
  for (const attribute of ownAttributes(look)) {
    if (attribute.namespaceURI !== W) return undefined;
    if (attribute.localName === "val") continue;
    const bit = LOOK_FLAGS[attribute.localName];
    if (bit === undefined) return undefined;
    flags = true;
    if (["1", "true", "on"].includes(attribute.value)) mask |= bit;
    else if (!["0", "false", "off"].includes(attribute.value)) return undefined;
  }
  const hex = look.getAttributeNS(W, "val");
  if (!hex) return mask;
  if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return undefined;
  const value = parseInt(hex, 16);
  return flags && value !== mask ? undefined : value;
}

/** Whether a table's style, own or inherited, has conditional formatting, which is all a table
 * look switches; undefined when the style can't be resolved. */
export function createWordConditionalTableStyles(
  doc: Document,
): (table: Element) => boolean | undefined {
  const styles = new Map(
    elements(doc, "style")
      .filter((s) => s.getAttributeNS(W, "type") === "table")
      .map((s) => [s.getAttributeNS(W, "styleId") ?? "", s]),
  );
  const fallback = [...styles.values()].find((s) =>
    ["1", "true", "on"].includes(s.getAttributeNS(W, "default") ?? ""),
  );
  return (table) => {
    const properties = child(table, "tblPr");
    const named = properties && child(properties, "tblStyle");
    let style = named
      ? styles.get(named.getAttributeNS(W, "val") ?? "")
      : fallback;
    if (named && !style) return undefined;
    const seen = new Set<Element>();
    while (style && !seen.has(style)) {
      seen.add(style);
      if (child(style, "tblStylePr")) return true;
      const basedOn = child(style, "basedOn");
      if (!basedOn) return false;
      style = styles.get(basedOn.getAttributeNS(W, "val") ?? "");
      if (!style) return undefined;
    }
    return false;
  };
}

/** list-instance-id. */
export function isWordListInstanceId(
  element: Element,
  attribute: Attr,
): boolean {
  return (
    element.namespaceURI === W &&
    element.localName === "num" &&
    attribute.namespaceURI === CID &&
    attribute.localName === "durableId"
  );
}

/** table-look: a table's own look, unset, 0000 or 04A0, where its style has no conditional
 * formatting for the look to switch. */
export function isWordInertTableLook(
  look: Element,
  conditional: (table: Element) => boolean | undefined,
): boolean {
  const properties = look.parentElement;
  const table = properties?.parentElement;
  if (
    look.namespaceURI !== W ||
    look.localName !== "tblLook" ||
    look.children.length ||
    properties?.namespaceURI !== W ||
    properties.localName !== "tblPr" ||
    table?.namespaceURI !== W ||
    table.localName !== "tbl"
  )
    return false;
  const mask = tableLookMask(look);
  return (
    mask !== undefined && UNSET_LOOKS.has(mask) && conditional(table) === false
  );
}

/** theme-font-language: a language tag without its region; anything else stays as written. */
export function wordThemeFontLanguage(value: string): string {
  const match =
    /^([A-Za-z]{2,3})(-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|\d{3}))?$/.exec(value);
  return match ? (match[1] + (match[2] ?? "")).toLowerCase() : value;
}

/** Per body-read rule, the values it treats alike in one read, in document order: list instance
 * IDs, the looks of tables it applies to ("-" for the others) and theme font languages. Content-free. */
export type WordBodyReadHousekeeping = Record<
  "list-instance-id" | "table-look" | "theme-font-language",
  string[]
>;

export function wordHousekeepingTokens(
  doc: Document,
): WordBodyReadHousekeeping {
  const conditional = createWordConditionalTableStyles(doc);
  return {
    "list-instance-id": elements(doc, "num").map(
      (num) => num.getAttributeNS(CID, "durableId") ?? "",
    ),
    "table-look": elements(doc, "tbl").map((table) => {
      const properties = child(table, "tblPr");
      const look = properties && child(properties, "tblLook");
      if (look)
        return isWordInertTableLook(look, conditional)
          ? (tableLookMask(look) ?? 0).toString(16).padStart(4, "0")
          : "-";
      return conditional(table) === false ? "unset" : "-";
    }),
    "theme-font-language": elements(doc, "themeFontLang").map(
      (e) => e.getAttributeNS(W, "val") ?? "",
    ),
  };
}

/** proofing-language: a w:lang in a paragraph mark's or run's properties that sets only w:val. */
export function isWordDetectedLanguage(lang: Element): boolean {
  const properties = lang.parentElement;
  const owner = properties?.parentElement;
  return (
    lang.namespaceURI === W &&
    lang.localName === "lang" &&
    !lang.children.length &&
    !!lang.getAttributeNS(W, "val") &&
    ownAttributes(lang).every(
      (a) => a.namespaceURI === W && a.localName === "val",
    ) &&
    properties?.namespaceURI === W &&
    properties.localName === "rPr" &&
    owner?.namespaceURI === W &&
    ["pPr", "r"].includes(owner.localName)
  );
}

export type WordHousekeepingCounts = Partial<
  Record<WordHousekeepingId, number>
>;

/** Per rule, how many differences between two reads it hid; zero counts are left out. */
export function wordHousekeepingDifferences(
  a: WordBodyReadHousekeeping | undefined,
  b: WordBodyReadHousekeeping | undefined,
  extra: WordHousekeepingCounts = {},
): WordHousekeepingCounts {
  const counts: WordHousekeepingCounts = {};
  const count = (
    id: keyof WordBodyReadHousekeeping,
    hidden: (x: string, y: string) => boolean,
  ) => {
    const x = a?.[id] ?? [],
      y = b?.[id] ?? [];
    let n = 0;
    for (let i = 0; i < Math.min(x.length, y.length); i++)
      if (x[i] !== y[i] && hidden(x[i], y[i])) n++;
    if (n) counts[id] = n;
  };
  count("list-instance-id", () => true);
  count("table-look", (x, y) => x !== "-" && y !== "-");
  count(
    "theme-font-language",
    (x, y) => wordThemeFontLanguage(x) === wordThemeFontLanguage(y),
  );
  for (const [id, n] of Object.entries(extra) as [WordHousekeepingId, number][])
    if (n) counts[id] = (counts[id] ?? 0) + n;
  return counts;
}
