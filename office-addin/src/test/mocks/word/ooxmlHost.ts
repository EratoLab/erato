import { vi } from "vitest";

import {
  wordDocumentFileToOoxml,
  wordDocumentOoxmlToFile,
} from "../../../word/utils/wordDocumentPackage";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/**
 * Both profiles keep the open document's customXml and custom properties
 * (InsertFileOptions, WordApi 1.6): the file's customXml items are added next to
 * them only when importCustomXmlParts is not false, and the file's properties
 * overwrite same-named ones only when importCustomProperties is not false.
 * Otherwise "word-web" takes the imported file wholesale, while
 * "word-pc-16.0.20326" merges it the way Word PC 16.0.20326 was observed to:
 * list definitions get new nsid values plus one unused definition, and saved
 * task-pane records are dropped.
 */
export type WordOoxmlHostProfile = "word-web" | "word-pc-16.0.20326";

export interface WordOoxmlHostOptions {
  profile?: WordOoxmlHostProfile;
  /** Word PC: list paragraphs move to a new, content-equal list instance on each import. */
  rePointKeptLists?: boolean;
  /** Word PC: spacing-before of the first body paragraph changes whenever paragraph spacing is imported. */
  spacingDrift?: boolean;
  /** Import the file's customXml and custom properties whatever the import options say. */
  ignoreImportOptions?: boolean;
  url?: string;
  /** Defaults to every requirement set. */
  isSetSupported?: (name: string, version?: string) => boolean;
  /** body.paragraphs also lists text-box paragraphs, unlike the package prediction. */
  includeTextBoxParagraphs?: boolean;
  /** Adversarial: insertText "Replace" drops the first run's properties. */
  replaceDropsRunProperties?: boolean;
  /** Paragraph.text of table-cell paragraphs ends with this, as a host may report the end-of-cell mark. */
  cellParagraphTextSuffix?: string;
  /** Adversarial: insertParagraph copies all of the anchor's paragraph properties, not just its
   * style and list membership. */
  insertInheritsAnchorProperties?: boolean;
  /** Adversarial: attachToList joins a new, content-equal list instance instead of the list's own. */
  attachToListNewNum?: boolean;
  /** Localized Word: the style ID it gives a built-in style it adds, e.g. { Heading2: "berschrift2" }. */
  builtInStyleIds?: Record<string, string>;
  /** Localized Word: Paragraph.style finds built-in styles only by their localized UI names, which
   * the package does not carry, so only custom style names resolve. */
  localizedStyleNames?: boolean;
}

/** Adversarial insertText "Replace" behaviour, switchable mid-test. */
export type WordReplaceFault =
  | "drops-rpr"
  /** An extra empty paragraph appears after the written one. */
  | "adds-paragraph"
  /** The following paragraph turns bold as well. */
  | "edits-next";

type When =
  | "now"
  | "after-capture"
  | "after-import"
  /** Right after that many further context.sync() calls have completed. */
  | { afterSync: number };

/** CT_RPr child order; Word writes run properties in this order. */
const RUN_PROPERTY_ORDER = [
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
];

function setRunMark(run: Element, names: string[], value: string | null): void {
  const doc = run.ownerDocument;
  let props = child(run, "rPr");
  for (const name of names) child(props, name)?.remove();
  if (value === null) {
    if (props && !props.children.length && !props.attributes.length)
      props.remove();
    return;
  }
  if (!props) {
    props = doc.createElementNS(W, "w:rPr");
    run.prepend(props);
  }
  for (const name of names) {
    const element = doc.createElementNS(W, `w:${name}`);
    if (value) element.setAttributeNS(W, "w:val", value);
    const position = RUN_PROPERTY_ORDER.indexOf(name);
    props.insertBefore(
      element,
      Array.from(props.children).find(
        (e) =>
          e.namespaceURI === W &&
          RUN_PROPERTY_ORDER.indexOf(e.localName) > position,
      ) ?? null,
    );
  }
}

/** CT_PPrBase child order; Word writes paragraph properties in this order. */
const PARAGRAPH_PROPERTY_ORDER = [
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
];

/** Replace (or with `value` null, remove) one paragraph property, keeping schema order. */
function setParagraphProperty(
  paragraph: Element,
  name: string,
  value: Element | null,
): void {
  let props = child(paragraph, "pPr");
  if (!props) {
    if (!value) return;
    props = paragraph.ownerDocument.createElementNS(W, "w:pPr");
    paragraph.prepend(props);
  }
  child(props, name)?.remove();
  if (value) {
    const position = PARAGRAPH_PROPERTY_ORDER.indexOf(name);
    props.insertBefore(
      value,
      Array.from(props.children).find(
        (e) =>
          e.namespaceURI === W &&
          PARAGRAPH_PROPERTY_ORDER.indexOf(e.localName) > position,
      ) ?? null,
    );
  }
  if (!props.children.length && !props.attributes.length) props.remove();
}

const numIdOf = (paragraph: Element) => {
  const numPr = child(child(paragraph, "pPr"), "numPr");
  const id = child(numPr, "numId")?.getAttributeNS(W, "val");
  return id && id !== "0" ? id : undefined;
};

/** Paragraph.styleBuiltIn names and the canonical w:name Word gives each style. */
const BUILT_IN_STYLE_NAMES: Record<string, string> = {
  Normal: "Normal",
  Title: "Title",
  Subtitle: "Subtitle",
  Quote: "Quote",
  IntenseQuote: "Intense Quote",
  NoSpacing: "No Spacing",
  ListParagraph: "List Paragraph",
  Caption: "caption",
  TocHeading: "TOC Heading",
  Bibliography: "Bibliography",
  Header: "header",
  Footer: "footer",
  FootnoteText: "footnote text",
  EndnoteText: "endnote text",
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [
      [`Heading${i + 1}`, `heading ${i + 1}`],
      [`Toc${i + 1}`, `toc ${i + 1}`],
    ]).flat(),
  ),
};

function newRun(doc: Document, text: string, props?: Element): Element {
  const run = doc.createElementNS(W, "w:r");
  if (props) run.append(props.cloneNode(true));
  const pieces = text.split("\t");
  pieces.forEach((piece, i) => {
    if (i) run.append(doc.createElementNS(W, "w:tab"));
    if (!piece && pieces.length > 1) return;
    const t = doc.createElementNS(W, "w:t");
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.textContent = piece;
    run.append(t);
  });
  return run;
}

/** Text as Paragraph.text reports it: soft breaks as \v, deleted and field-code text left out. */
function paragraphText(paragraph: Element): string {
  let text = "";
  const visit = (e: Element) => {
    if (e.namespaceURI === W) {
      if (
        ["del", "moveFrom", "instrText", "delText", "pPr", "rPr"].includes(
          e.localName,
        )
      )
        return;
      if (e.localName === "t") text += e.textContent ?? "";
      else if (e.localName === "tab") text += "\t";
      else if (e.localName === "br" || e.localName === "cr") text += "\v";
    }
    Array.from(e.children).forEach(visit);
  };
  visit(paragraph);
  return text;
}

const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, "application/xml");
const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc);
const elements = (root: Document | Element, ns: string, name: string) =>
  Array.from(root.getElementsByTagNameNS(ns, name));
const child = (parent: Element | undefined, name: string) =>
  Array.from(parent?.children ?? []).find(
    (e) => e.namespaceURI === W && e.localName === name,
  );
const parts = (doc: Document) => elements(doc, PKG, "part");
const partName = (part: Element) => part.getAttributeNS(PKG, "name") ?? "";
const partRoot = (doc: Document, name: string): Element | undefined => {
  const part = parts(doc).find((p) => partName(p) === name);
  return (
    (part && elements(part, PKG, "xmlData")[0]?.firstElementChild) || undefined
  );
};
const nextId = (values: string[]) =>
  String(Math.max(0, ...values.map((v) => Number(v) || 0)) + 1);

/** Edit a flat-OPC package string as a DOM; returns the serialized result. */
export function editWordPackage(
  ooxml: string,
  edit: (doc: Document) => void,
): string {
  const doc = parse(ooxml);
  edit(doc);
  return serialize(doc);
}

export function renameWordNsids(doc: Document, next: () => string): void {
  for (const definition of elements(doc, W, "abstractNum"))
    child(definition, "nsid")?.setAttributeNS(W, "w:val", next());
}

export function addUnreferencedWordNumbering(
  doc: Document,
  nsid: string,
): void {
  const root = partRoot(doc, "/word/numbering.xml");
  if (!root) return;
  const abstractId = nextId(
    elements(root, W, "abstractNum").map(
      (e) => e.getAttributeNS(W, "abstractNumId") ?? "",
    ),
  );
  const numId = nextId(
    elements(root, W, "num").map((e) => e.getAttributeNS(W, "numId") ?? ""),
  );
  const fragment = parse(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="${abstractId}"><w:nsid w:val="${nsid}"/><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum><w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractId}"/></w:num></w:numbering>`,
  ).documentElement;
  const [abstract, num] = Array.from(fragment.children).map((e) =>
    doc.importNode(e, true),
  );
  root.insertBefore(abstract, elements(root, W, "num")[0] ?? null);
  root.append(num);
}

/** Every list paragraph of the body moves to a new num with the same definition and overrides. */
export function rePointWordLists(doc: Document): void {
  const numbering = partRoot(doc, "/word/numbering.xml");
  const body = partRoot(doc, "/word/document.xml");
  if (!numbering || !body) return;
  const nums = new Map(
    elements(numbering, W, "num").map((e) => [
      e.getAttributeNS(W, "numId") ?? "",
      e,
    ]),
  );
  const moved = new Map<string, string>();
  for (const reference of elements(body, W, "numId")) {
    const id = reference.getAttributeNS(W, "val") ?? "";
    const original = nums.get(id);
    if (!original || id === "0") continue;
    if (!moved.has(id)) {
      const numId = nextId([...nums.keys(), ...moved.values()]);
      const copy = original.cloneNode(true) as Element;
      copy.setAttributeNS(W, "w:numId", numId);
      numbering.append(copy);
      moved.set(id, numId);
    }
    reference.setAttributeNS(W, "w:val", moved.get(id)!);
  }
}

const AFTER_SPACING = new Set([
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
]);

export function driftFirstParagraphSpacing(doc: Document, step = 120): void {
  const body = partRoot(doc, "/word/document.xml");
  const paragraph = body && elements(body, W, "p")[0];
  if (!paragraph) return;
  let pPr = child(paragraph, "pPr");
  if (!pPr) {
    pPr = doc.createElementNS(W, "w:pPr");
    paragraph.prepend(pPr);
  }
  let spacing = child(pPr, "spacing");
  if (!spacing) {
    spacing = doc.createElementNS(W, "w:spacing");
    pPr.insertBefore(
      spacing,
      Array.from(pPr.children).find(
        (e) => e.namespaceURI === W && AFTER_SPACING.has(e.localName),
      ) ?? null,
    );
  }
  spacing.setAttributeNS(
    W,
    "w:before",
    String((Number(spacing.getAttributeNS(W, "before")) || 0) + step),
  );
}

const DOCUMENT_RELS = "/word/_rels/document.xml.rels";
const PACKAGE_RELS = "/_rels/.rels";
const CUSTOM_PROPERTIES = "/docProps/custom.xml";
const customXmlIndex = (part: Element) =>
  /^\/customXml\/item(\d+)\.xml$/.exec(partName(part))?.[1];
const relationshipsOf = (root: Element | undefined) =>
  root ? elements(root, REL, "Relationship") : [];
const hasType = (rel: Element, type: string) =>
  (rel.getAttribute("Type") ?? "").endsWith(`/${type}`);

function addRelationship(root: Element, rel: Element): void {
  const ids = new Set(relationshipsOf(root).map((r) => r.getAttribute("Id")));
  const preferred = rel.getAttribute("Id") || "rIdHost";
  let id = preferred;
  for (let n = 1; ids.has(id); n++) id = `${preferred}_${n}`;
  rel.setAttribute("Id", id);
  root.append(rel);
}

/** Adds every customXml item of `from` to `into` under new item numbers. */
function appendWordCustomXml(into: Document, from: Document): void {
  const items = parts(from)
    .map(customXmlIndex)
    .filter((n): n is string => !!n);
  const relationships = partRoot(into, DOCUMENT_RELS);
  let next = Number(nextId(parts(into).map((p) => customXmlIndex(p) ?? "")));
  for (const index of items) {
    const copy = (source: string, target: string) => {
      const part = parts(from).find((p) => partName(p) === source);
      if (!part) return undefined;
      const clone = into.importNode(part, true);
      clone.setAttributeNS(PKG, "pkg:name", target);
      into.documentElement.append(clone);
      return clone;
    };
    const n = next++;
    copy(`/customXml/item${index}.xml`, `/customXml/item${n}.xml`);
    copy(`/customXml/itemProps${index}.xml`, `/customXml/itemProps${n}.xml`);
    const rels = copy(
      `/customXml/_rels/item${index}.xml.rels`,
      `/customXml/_rels/item${n}.xml.rels`,
    );
    for (const rel of relationshipsOf(rels))
      rel.setAttribute("Target", `itemProps${n}.xml`);
    if (relationships) {
      const rel = into.createElementNS(REL, "Relationship");
      rel.setAttribute("Id", `rIdCustomXml${n}`);
      rel.setAttribute("Type", `${OFFICE_REL}/customXml`);
      rel.setAttribute("Target", `../customXml/item${n}.xml`);
      addRelationship(relationships, rel);
    }
  }
}

export function duplicateWordCustomXml(doc: Document): void {
  appendWordCustomXml(doc, doc);
}

/** Replaces `into`'s customXml items with `from`'s, keeping their names. */
function replaceWordCustomXml(into: Document, from: Document): void {
  for (const part of parts(into))
    if (partName(part).startsWith("/customXml/")) part.remove();
  const relationships = partRoot(into, DOCUMENT_RELS);
  for (const rel of relationshipsOf(relationships))
    if (hasType(rel, "customXml")) rel.remove();
  for (const part of parts(from))
    if (partName(part).startsWith("/customXml/"))
      into.documentElement.append(into.importNode(part, true));
  if (relationships)
    for (const rel of relationshipsOf(partRoot(from, DOCUMENT_RELS)))
      if (hasType(rel, "customXml"))
        addRelationship(relationships, into.importNode(rel, true));
}

/** Replaces `into`'s custom document properties with `from`'s. */
function replaceWordCustomProperties(into: Document, from: Document): void {
  parts(into)
    .find((p) => partName(p) === CUSTOM_PROPERTIES)
    ?.remove();
  const relationships = partRoot(into, PACKAGE_RELS);
  for (const rel of relationshipsOf(relationships))
    if (hasType(rel, "custom-properties")) rel.remove();
  const kept = parts(from).find((p) => partName(p) === CUSTOM_PROPERTIES);
  if (!kept) return;
  into.documentElement.append(into.importNode(kept, true));
  const rel = relationshipsOf(partRoot(from, PACKAGE_RELS)).find((r) =>
    hasType(r, "custom-properties"),
  );
  if (relationships && rel)
    addRelationship(relationships, into.importNode(rel, true));
}

/** Imported custom document properties overwrite those with the same name, as InsertFileOptions documents. */
function importWordCustomProperties(into: Document, from: Document): void {
  const imported = partRoot(from, CUSTOM_PROPERTIES);
  if (!imported) return;
  const root = partRoot(into, CUSTOM_PROPERTIES);
  if (!root) {
    replaceWordCustomProperties(into, from);
    return;
  }
  for (const property of Array.from(imported.children)) {
    const name = property.getAttribute("name");
    const existing = Array.from(root.children).find(
      (p) => p.getAttribute("name") === name,
    );
    const clone = into.importNode(property, true);
    if (existing) {
      clone.setAttribute("pid", existing.getAttribute("pid") ?? "");
      existing.replaceWith(clone);
    } else {
      clone.setAttribute(
        "pid",
        nextId(
          Array.from(root.children).map((p) => p.getAttribute("pid") ?? ""),
        ),
      );
      root.append(clone);
    }
  }
}

export function duplicateWordCustomProperties(doc: Document): void {
  const root = partRoot(doc, "/docProps/custom.xml");
  if (!root) return;
  const properties = Array.from(root.children);
  let pid = Number(nextId(properties.map((p) => p.getAttribute("pid") ?? "")));
  for (const property of properties) {
    const clone = property.cloneNode(true) as Element;
    clone.setAttribute("pid", String(pid++));
    root.append(clone);
  }
}

export function dropWordTaskPanes(doc: Document): void {
  for (const part of parts(doc))
    if (partName(part).startsWith("/word/webextensions/")) part.remove();
  for (const rel of elements(doc, REL, "Relationship"))
    if (
      (rel.getAttribute("Type") ?? "").endsWith("/webextensiontaskpanes") ||
      (rel.getAttribute("Target") ?? "").includes("webextensions/")
    )
      rel.remove();
}

function merged(
  imported: Uint8Array,
  open: Uint8Array,
  options: Word.InsertFileOptions | undefined,
  settings: WordOoxmlHostOptions,
  nsid: () => string,
): Uint8Array {
  const importedXml = wordDocumentFileToOoxml(imported);
  const source = parse(importedXml);
  const target = parse(wordDocumentFileToOoxml(open));
  const ooxml = editWordPackage(importedXml, (doc) => {
    replaceWordCustomXml(doc, target);
    if (settings.ignoreImportOptions || options?.importCustomXmlParts !== false)
      appendWordCustomXml(doc, source);
    replaceWordCustomProperties(doc, target);
    if (
      settings.ignoreImportOptions ||
      options?.importCustomProperties !== false
    )
      importWordCustomProperties(doc, source);
    if ((settings.profile ?? "word-web") === "word-web") return;
    dropWordTaskPanes(doc);
    renameWordNsids(doc, nsid);
    if (settings.rePointKeptLists) rePointWordLists(doc);
    addUnreferencedWordNumbering(doc, nsid());
    if (settings.spacingDrift && options?.importParagraphSpacing !== false)
      driftFirstParagraphSpacing(doc);
  });
  return wordDocumentOoxmlToFile(ooxml);
}

const decode = (base64: string) =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/** A complete-document Word host backed by a real DOCX: file capture, import, content-control locks. */
export function installWordOoxmlHost(
  source: Uint8Array | string,
  settings: WordOoxmlHostOptions = {},
) {
  let current: Uint8Array =
    typeof source === "string"
      ? wordDocumentOoxmlToFile(source)
      : new Uint8Array(source);
  let pending:
    | { bytes: Uint8Array; options: Word.InsertFileOptions | undefined }
    | undefined;
  // Paragraph object model over the same package; IDs survive edits but not imports, as in Word.
  let liveDoc: Document | undefined;
  let carriedIds: string[] | undefined;
  const paragraphIds = new WeakMap<Element, string>();
  let paragraphSeed = 0;
  const newParagraphId = () =>
    `{${(0x5e170000 + ++paragraphSeed).toString(16).toUpperCase()}-0A1B-4C2D-8E3F-${String(paragraphSeed).padStart(12, "0")}}`;
  const mainBody = (doc: Document) =>
    partRoot(doc, "/word/document.xml")
      ? elements(partRoot(doc, "/word/document.xml")!, W, "body")[0]
      : undefined;
  const bodyParagraphs = (doc: Document) => {
    const body = mainBody(doc);
    if (!body) return [];
    return elements(body, W, "p").filter((p) => {
      for (let a = p.parentElement; a && a !== body; a = a.parentElement) {
        if (a.namespaceURI === MC && a.localName === "Fallback") return false;
        if (
          !settings.includeTextBoxParagraphs &&
          a.namespaceURI === W &&
          a.localName === "txbxContent"
        )
          return false;
      }
      return true;
    });
  };
  const live = (): Document => {
    if (liveDoc) return liveDoc;
    const doc = parse(wordDocumentFileToOoxml(current));
    const paragraphs = bodyParagraphs(doc);
    const carried =
      carriedIds?.length === paragraphs.length ? carriedIds : undefined;
    paragraphs.forEach((p, i) =>
      paragraphIds.set(p, carried?.[i] ?? newParagraphId()),
    );
    carriedIds = undefined;
    liveDoc = doc;
    return doc;
  };
  const replaceCurrent = (bytes: Uint8Array, keepIds: boolean) => {
    carriedIds =
      keepIds && liveDoc
        ? bodyParagraphs(liveDoc).map((p) => paragraphIds.get(p) ?? "")
        : undefined;
    liveDoc = undefined;
    current = bytes;
  };
  const idOf = (p: Element) => {
    let id = paragraphIds.get(p);
    if (!id) paragraphIds.set(p, (id = newParagraphId()));
    return id;
  };
  let replaceFault: WordReplaceFault | undefined =
    settings.replaceDropsRunProperties ? "drops-rpr" : undefined;
  let paragraphOoxmlFault: string | undefined;
  type Command = { write: boolean; name: string; run: () => void };
  const queue: Command[] = [];
  let failAt: number | undefined;
  let failMessage = "Word rejected the change.";
  let writesSeen = 0;
  let omDirty = false;
  const afterSyncs: { remaining: number; apply: () => void }[] = [];
  const itemNotFound = () =>
    Object.assign(new Error("The requested resource doesn't exist."), {
      code: "ItemNotFound",
    });
  const alive = (element: Element) => {
    if (element.ownerDocument !== liveDoc || !liveDoc.contains(element))
      throw itemNotFound();
    return element;
  };
  const enqueue = (write: boolean, name: string, run: () => void) =>
    queue.push({ write, name, run });
  const result = <T>(compute: () => T) => {
    const holder = { value: undefined as unknown as T };
    enqueue(false, "read", () => {
      holder.value = compute();
    });
    return holder;
  };
  const loadedValue = (
    loaded: Map<string, unknown>,
    property: string,
  ): unknown => {
    if (!loaded.has(property))
      throw Object.assign(
        new Error(`The property '${property}' is not available.`),
        { code: "PropertyNotLoaded" },
      );
    return loaded.get(property);
  };
  const runsOf = (p: Element) => elements(p, W, "r");
  const rangeProxy = (runs: () => Element[]) => {
    const mark = (names: string[], value: string | null) => () =>
      runs().forEach((run) => setRunMark(alive(run), names, value));
    return {
      font: {
        set bold(value: boolean) {
          enqueue(true, "font.bold", mark(["b", "bCs"], value ? "" : null));
        },
        set italic(value: boolean) {
          enqueue(true, "font.italic", mark(["i", "iCs"], value ? "" : null));
        },
        set underline(value: string) {
          enqueue(
            true,
            "font.underline",
            mark(["u"], value === "None" ? null : value.toLowerCase()),
          );
        },
      },
    };
  };
  const cellProxy = (resolve: () => Element) => {
    const loaded = new Map<string, unknown>();
    return {
      load: (properties: string) =>
        enqueue(false, "load", () => {
          let cell: Element | undefined;
          for (let a = resolve().parentElement; a; a = a.parentElement)
            if (a.namespaceURI === W && a.localName === "tc") {
              cell = a;
              break;
            }
          const row = cell?.parentElement;
          const siblings = (e: Element | null | undefined, name: string) =>
            Array.from(e?.parentElement?.children ?? []).filter(
              (c) => c.namespaceURI === W && c.localName === name,
            );
          const values: Record<string, unknown> = {
            isNullObject: !cell,
            rowIndex: row ? siblings(row, "tr").indexOf(row) : undefined,
            cellIndex: cell ? siblings(cell, "tc").indexOf(cell) : undefined,
          };
          loaded.set("isNullObject", values.isNullObject);
          for (const name of properties.split(","))
            if (name.trim() !== "isNullObject" && !values.isNullObject)
              loaded.set(name.trim(), values[name.trim()]);
        }),
      get isNullObject() {
        return loadedValue(loaded, "isNullObject");
      },
      get rowIndex() {
        return loadedValue(loaded, "rowIndex");
      },
      get cellIndex() {
        return loadedValue(loaded, "cellIndex");
      },
    };
  };
  const paragraphValues = (p: Element): Record<string, unknown> => {
    let nesting = 0;
    for (let a = p.parentElement; a; a = a.parentElement)
      if (a.namespaceURI === W && a.localName === "tbl") nesting++;
    return {
      uniqueLocalId: idOf(p),
      tableNestingLevel: nesting,
      text:
        paragraphText(p) +
        (nesting ? (settings.cellParagraphTextSuffix ?? "") : ""),
      isListItem: numIdOf(p) !== undefined,
    };
  };
  const paragraphStyles = () => {
    const root = partRoot(live(), "/word/styles.xml");
    return root
      ? elements(root, W, "style").filter(
          (style) => style.getAttributeNS(W, "type") === "paragraph",
        )
      : [];
  };
  const styleName = (style: Element) =>
    child(style, "name")?.getAttributeNS(W, "val") ?? "";
  /** Word omits w:pStyle for the default paragraph style. */
  const applyStyle = (paragraph: Element, style: Element) => {
    const styles = paragraphStyles();
    const fallback = styles.some((s) => s.getAttributeNS(W, "default") === "1")
      ? undefined
      : styles.find((s) => styleName(s) === "Normal");
    if (style.getAttributeNS(W, "default") === "1" || style === fallback) {
      setParagraphProperty(paragraph, "pStyle", null);
      return;
    }
    const pStyle = paragraph.ownerDocument.createElementNS(W, "w:pStyle");
    pStyle.setAttributeNS(W, "w:val", style.getAttributeNS(W, "styleId") ?? "");
    setParagraphProperty(paragraph, "pStyle", pStyle);
  };
  /** Word adds a built-in style the first time it is applied. */
  const builtInStyle = (builtIn: string): Element => {
    const name = BUILT_IN_STYLE_NAMES[builtIn];
    if (!name) throw new Error(`Unsupported built-in style ${builtIn}.`);
    const existing = paragraphStyles().find(
      (style) => styleName(style).toLowerCase() === name.toLowerCase(),
    );
    if (existing) return existing;
    const root = partRoot(live(), "/word/styles.xml");
    if (!root) throw new Error("The document has no styles part.");
    const heading = /^Heading([1-9])$/.exec(builtIn);
    const style = parse(
      `<w:style xmlns:w="${W}" w:type="paragraph" w:styleId="${settings.builtInStyleIds?.[builtIn] ?? builtIn}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>${
        heading
          ? `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="40" w:after="0"/><w:outlineLvl w:val="${Number(heading[1]) - 1}"/></w:pPr><w:rPr><w:sz w:val="26"/></w:rPr>`
          : ""
      }</w:style>`,
    ).documentElement;
    const made = root.ownerDocument.importNode(style, true);
    root.append(made);
    return made;
  };
  const listProxy = (resolve: () => Element) => {
    const loaded = new Map<string, unknown>();
    return {
      load: () =>
        enqueue(false, "load", () => {
          const id = numIdOf(resolve());
          loaded.set("isNullObject", id === undefined);
          if (id !== undefined) loaded.set("id", Number(id));
        }),
      get isNullObject() {
        return loadedValue(loaded, "isNullObject");
      },
      get id() {
        return loadedValue(loaded, "id");
      },
    };
  };
  /** A list instance with the same definition and overrides as `numId`, as Word may create. */
  const copyNum = (numId: string): string => {
    const numbering = partRoot(live(), "/word/numbering.xml");
    const original = numbering
      ? elements(numbering, W, "num").find(
          (e) => e.getAttributeNS(W, "numId") === numId,
        )
      : undefined;
    if (!numbering || !original) throw itemNotFound();
    const copy = original.cloneNode(true) as Element;
    const next = nextId(
      elements(numbering, W, "num").map(
        (e) => e.getAttributeNS(W, "numId") ?? "",
      ),
    );
    copy.setAttributeNS(W, "w:numId", next);
    numbering.append(copy);
    return next;
  };
  /** A new decimal list, as Paragraph.startNewList creates one. */
  const newNum = (): string => {
    const doc = live();
    let numbering = partRoot(doc, "/word/numbering.xml");
    if (!numbering) {
      const part = parse(
        `<pkg:part xmlns:pkg="${PKG}" pkg:name="/word/numbering.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"><pkg:xmlData><w:numbering xmlns:w="${W}"/></pkg:xmlData></pkg:part>`,
      ).documentElement;
      doc.documentElement.append(doc.importNode(part, true));
      numbering = partRoot(doc, "/word/numbering.xml")!;
    }
    const abstractId = nextId(
      elements(numbering, W, "abstractNum").map(
        (e) => e.getAttributeNS(W, "abstractNumId") ?? "",
      ),
    );
    const numId = nextId(
      elements(numbering, W, "num").map(
        (e) => e.getAttributeNS(W, "numId") ?? "",
      ),
    );
    const fragment = parse(
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="${abstractId}"><w:nsid w:val="${nsid()}"/><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum><w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractId}"/></w:num></w:numbering>`,
    ).documentElement;
    const [abstract, num] = Array.from(fragment.children).map((e) =>
      doc.importNode(e, true),
    );
    numbering.insertBefore(abstract, elements(numbering, W, "num")[0] ?? null);
    numbering.append(num);
    return numId;
  };
  const setNumbering = (paragraph: Element, level: number, numId: string) => {
    const doc = paragraph.ownerDocument;
    const numPr = doc.createElementNS(W, "w:numPr");
    const ilvl = doc.createElementNS(W, "w:ilvl");
    ilvl.setAttributeNS(W, "w:val", String(level));
    const id = doc.createElementNS(W, "w:numId");
    id.setAttributeNS(W, "w:val", numId);
    numPr.append(ilvl, id);
    setParagraphProperty(paragraph, "numPr", numPr);
  };
  const paragraphOoxml = (p: Element) => {
    if (paragraphOoxmlFault !== undefined)
      throw Object.assign(new Error(paragraphOoxmlFault), {
        code: "GeneralException",
        debugInfo: { errorLocation: "Paragraph.getOoxml" },
      });
    const doc = live();
    const packagePart = (name: string, contentType: string, root?: Element) =>
      root
        ? `<pkg:part pkg:name="${name}" pkg:contentType="${contentType}"><pkg:xmlData>${new XMLSerializer().serializeToString(root)}</pkg:xmlData></pkg:part>`
        : "";
    const wrapper = parse(`<w:document xmlns:w="${W}"><w:body/></w:document>`);
    const body = elements(wrapper, W, "body")[0];
    body.append(wrapper.importNode(p, true));
    body.append(wrapper.createElementNS(W, "w:sectPr"));
    return `<pkg:package xmlns:pkg="${PKG}">${packagePart(
      "/word/document.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
      wrapper.documentElement,
    )}${packagePart(
      "/word/styles.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
      partRoot(doc, "/word/styles.xml"),
    )}${packagePart(
      "/word/numbering.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
      partRoot(doc, "/word/numbering.xml"),
    )}</pkg:package>`;
  };
  /** A paragraph as Word inserts it next to `anchor`: with the anchor's style and list membership. */
  const newParagraph = (
    doc: Document,
    anchor: Element | undefined,
  ): Element => {
    const made = doc.createElementNS(W, "w:p");
    const props = child(anchor, "pPr");
    if (props) {
      const copy = props.cloneNode(true) as Element;
      if (!settings.insertInheritsAnchorProperties)
        for (const property of Array.from(copy.children))
          if (
            property.namespaceURI !== W ||
            !["pStyle", "numPr"].includes(property.localName)
          )
            property.remove();
      if (copy.children.length) made.append(copy);
    }
    return made;
  };
  const isParagraph = (e: Element | null | undefined): e is Element =>
    !!e && e.namespaceURI === W && e.localName === "p";
  /** The body's last paragraph, which holds the document's final paragraph mark. */
  const finalParagraph = (doc: Document) => {
    const content = Array.from(mainBody(doc)?.children ?? []).filter(
      (e) => !(e.namespaceURI === W && e.localName === "sectPr"),
    );
    const last = content.at(-1);
    return isParagraph(last) ? last : undefined;
  };
  const paragraphProxy = (
    resolve: () => Element,
    loaded = new Map<string, unknown>(),
  ): Word.Paragraph => {
    const target = () => alive(resolve());
    const proxy = {
      load: (properties: string) =>
        enqueue(false, "load", () => {
          const values = paragraphValues(target());
          for (const name of properties.split(","))
            loaded.set(name.trim(), values[name.trim()]);
        }),
      get uniqueLocalId() {
        return loadedValue(loaded, "uniqueLocalId");
      },
      get tableNestingLevel() {
        return loadedValue(loaded, "tableNestingLevel");
      },
      get text() {
        return loadedValue(loaded, "text");
      },
      get isListItem() {
        return loadedValue(loaded, "isListItem");
      },
      get listOrNullObject() {
        return listProxy(target);
      },
      get listItem() {
        return {
          set level(value: number) {
            enqueue(true, "listItem.level", () => {
              const p = target();
              const numId = numIdOf(p);
              if (numId === undefined) throw itemNotFound();
              setNumbering(p, value, numId);
            });
          },
        };
      },
      attachToList: (listId: number, level: number) => {
        enqueue(true, "attachToList", () => {
          const p = target();
          if (numIdOf(p) !== undefined)
            throw Object.assign(
              new Error("The paragraph is already a list item."),
              { code: "InvalidArgument" },
            );
          setNumbering(
            p,
            level,
            settings.attachToListNewNum
              ? copyNum(String(listId))
              : String(listId),
          );
        });
        return listProxy(target);
      },
      detachFromList: () =>
        enqueue(true, "detachFromList", () =>
          setParagraphProperty(target(), "numPr", null),
        ),
      startNewList: () => {
        enqueue(true, "startNewList", () => {
          const p = target();
          if (numIdOf(p) !== undefined)
            throw Object.assign(
              new Error("The paragraph is already a list item."),
              { code: "InvalidArgument" },
            );
          setNumbering(p, 0, newNum());
        });
        return listProxy(target);
      },
      set alignment(value: string) {
        enqueue(true, "alignment", () => {
          const jc = target().ownerDocument.createElementNS(W, "w:jc");
          jc.setAttributeNS(
            W,
            "w:val",
            { Left: "left", Centered: "center", Right: "right" }[value] ??
              "both",
          );
          setParagraphProperty(target(), "jc", jc);
        });
      },
      set styleBuiltIn(value: string) {
        enqueue(true, "styleBuiltIn", () =>
          applyStyle(target(), builtInStyle(value)),
        );
      },
      set style(value: string) {
        enqueue(true, "style", () => {
          const style = paragraphStyles().find(
            (s) =>
              styleName(s).toLowerCase() === value.toLowerCase() &&
              (!settings.localizedStyleNames ||
                ["1", "true", "on"].includes(
                  s.getAttributeNS(W, "customStyle") ?? "",
                )),
          );
          if (!style) throw itemNotFound();
          applyStyle(target(), style);
        });
      },
      getText: () => result(() => paragraphText(target())),
      getOoxml: () => result(() => paragraphOoxml(target())),
      get parentTableCellOrNullObject() {
        return cellProxy(target);
      },
      insertText: (text: string, location: string) => {
        let inserted: Element[] = [];
        enqueue(true, "insertText", () => {
          const p = target();
          const runs = runsOf(p);
          const first = child(runs[0], "rPr");
          const last = child(runs.at(-1), "rPr");
          if (location === "Replace") {
            for (const node of Array.from(p.childNodes))
              if (
                !(
                  node instanceof Element &&
                  node.namespaceURI === W &&
                  node.localName === "pPr"
                )
              )
                node.remove();
            const run = newRun(
              p.ownerDocument,
              text,
              replaceFault === "drops-rpr" ? undefined : first,
            );
            p.append(run);
            inserted = [run];
            if (replaceFault === "adds-paragraph")
              p.after(p.ownerDocument.createElementNS(W, "w:p"));
            const next = p.nextElementSibling;
            if (
              replaceFault === "edits-next" &&
              next?.namespaceURI === W &&
              next.localName === "p"
            )
              runsOf(next).forEach((r) => setRunMark(r, ["b", "bCs"], ""));
          } else if (location === "End") {
            const run = newRun(p.ownerDocument, text, last);
            p.append(run);
            inserted = [run];
          } else if (location === "Start") {
            const run = newRun(p.ownerDocument, text, first);
            p.insertBefore(run, child(p, "pPr")?.nextSibling ?? p.firstChild);
            inserted = [run];
          } else throw new Error(`Unsupported insert location ${location}.`);
        });
        return rangeProxy(() => inserted);
      },
      insertParagraph: (text: string, location: string) => {
        let made: Element | undefined;
        enqueue(true, "insertParagraph", () => {
          const anchor = target();
          made = newParagraph(anchor.ownerDocument, anchor);
          if (text) made.append(newRun(anchor.ownerDocument, text));
          anchor.parentElement!.insertBefore(
            made,
            location === "Before" ? anchor : anchor.nextSibling,
          );
        });
        return paragraphProxy(() => {
          if (!made) throw itemNotFound();
          return made;
        });
      },
      delete: () =>
        enqueue(true, "delete", () => {
          const p = target();
          // Word keeps the document's final paragraph mark: deleting that paragraph only empties it.
          if (p === finalParagraph(p.ownerDocument))
            for (const node of Array.from(p.childNodes)) {
              if (
                !(
                  node instanceof Element &&
                  node.namespaceURI === W &&
                  node.localName === "pPr"
                )
              )
                node.remove();
            }
          else p.remove();
        }),
    };
    return proxy as unknown as Word.Paragraph;
  };
  const paragraphCollection = () => {
    let items: Word.Paragraph[] | undefined;
    return {
      load: (properties: string) =>
        enqueue(false, "load", () => {
          const names = properties
            .split(",")
            .map((name) => name.trim().replace(/^items\//, ""));
          items = bodyParagraphs(live()).map((p) => {
            const values = paragraphValues(p);
            return paragraphProxy(
              () => p,
              new Map(names.map((name) => [name, values[name]])),
            );
          });
        }),
      get items() {
        if (!items)
          throw Object.assign(new Error("The collection is not loaded."), {
            code: "PropertyNotLoaded",
          });
        return items;
      },
    };
  };
  const runQueue = () => {
    if (!queue.length) return;
    const doc = live();
    try {
      while (queue.length) {
        const command = queue.shift()!;
        if (command.write) {
          writesSeen++;
          if (failAt !== undefined && writesSeen === failAt) {
            failAt = undefined;
            throw Object.assign(new Error(failMessage), {
              code: "GeneralException",
              debugInfo: { errorLocation: `Paragraph.${command.name}` },
            });
          }
          events.push(`mutation:${command.name}`);
          omDirty = true;
        }
        command.run();
      }
    } finally {
      queue.length = 0;
      if (omDirty && liveDoc === doc) {
        omDirty = false;
        current = wordDocumentOoxmlToFile(serialize(doc));
        loadControls();
      }
    }
  };
  let faultAfterWrite: string | undefined;
  let faultBeforeWrite = false;
  let faultLockId: number | undefined;
  let changeUrlOnFailure: string | undefined;
  let cannotRead = false;
  let getFileCalls = 0;
  const failingReads = new Set<number>();
  const afterCapture: (() => void)[] = [];
  const afterImport: (() => void)[] = [];
  let trackingMode = "Off";
  let nsidSeed = 0x7e570000;
  const nsid = () => (nsidSeed++).toString(16).toUpperCase().padStart(8, "0");
  let decorateWrite = (bytes: Uint8Array) => bytes;
  const events: string[] = [];
  const importOptions: (Word.InsertFileOptions | undefined)[] = [];
  type ControlState = {
    id: number;
    parentId?: number;
    cannotEdit: boolean;
    cannotDelete: boolean;
  };
  let controls = new Map<number, ControlState>();
  const pendingLocks: {
    id: number;
    key: "cannotEdit" | "cannotDelete";
    value: boolean;
  }[] = [];
  const controlId = (node: Element) => {
    const props = child(node, "sdtPr");
    const id = props && child(props, "id")?.getAttributeNS(W, "val");
    return id === null || id === undefined ? undefined : Number(id);
  };
  const loadControls = () => {
    const doc = parse(wordDocumentFileToOoxml(current));
    controls = new Map(
      elements(doc, W, "sdt").flatMap((node) => {
        const id = controlId(node);
        if (id === undefined) return [];
        const props = child(node, "sdtPr")!;
        const lock = child(props, "lock")?.getAttributeNS(W, "val");
        let parentId: number | undefined;
        for (
          let parent = node.parentElement;
          parent;
          parent = parent.parentElement
        )
          if (parent.namespaceURI === W && parent.localName === "sdt") {
            parentId = controlId(parent);
            break;
          }
        return [
          [
            id,
            {
              id,
              parentId,
              cannotEdit:
                lock === "contentLocked" || lock === "sdtContentLocked",
              cannotDelete: lock === "sdtLocked" || lock === "sdtContentLocked",
            },
          ],
        ];
      }),
    );
  };
  const persistLocks = () => {
    const doc = parse(wordDocumentFileToOoxml(current));
    for (const node of elements(doc, W, "sdt")) {
      const id = controlId(node),
        state = id === undefined ? undefined : controls.get(id);
      if (!state) continue;
      const props = child(node, "sdtPr")!;
      child(props, "lock")?.remove();
      if (state.cannotEdit || state.cannotDelete) {
        const lock = doc.createElementNS(W, "w:lock");
        lock.setAttributeNS(
          W,
          "w:val",
          state.cannotEdit
            ? state.cannotDelete
              ? "sdtContentLocked"
              : "contentLocked"
            : "sdtLocked",
        );
        props.append(lock);
      }
    }
    replaceCurrent(wordDocumentOoxmlToFile(serialize(doc)), true);
  };
  const controlProxy = (id: number | undefined): Word.ContentControl => {
    const proxy = {
      get id() {
        return id;
      },
      get isNullObject() {
        return id === undefined || !controls.has(id);
      },
      get cannotEdit() {
        return controls.get(id!)!.cannotEdit;
      },
      set cannotEdit(value: boolean) {
        events.push(`queue-lock:${id}:cannotEdit=${value}`);
        pendingLocks.push({ id: id!, key: "cannotEdit", value });
      },
      get cannotDelete() {
        return controls.get(id!)!.cannotDelete;
      },
      set cannotDelete(value: boolean) {
        events.push(`queue-lock:${id}:cannotDelete=${value}`);
        pendingLocks.push({ id: id!, key: "cannotDelete", value });
      },
      get parentContentControlOrNullObject() {
        return controlProxy(controls.get(id!)?.parentId);
      },
      load: vi.fn(),
    };
    return proxy as unknown as Word.ContentControl;
  };
  const set = (bytes: Uint8Array) => {
    replaceCurrent(new Uint8Array(bytes), true);
    loadControls();
  };
  const editNow = (edit: (ooxml: string) => string) =>
    set(wordDocumentOoxmlToFile(edit(wordDocumentFileToOoxml(current))));
  loadControls();
  const close = vi.fn((callback: () => void) => callback());
  const insert = vi.fn(
    (base64: string, _location?: unknown, options?: Word.InsertFileOptions) => {
      events.push("queue-import");
      importOptions.push(options);
      pending = { bytes: decode(base64), options };
    },
  );
  const bodyInsert = vi.fn(() => {
    throw new Error("A complete document must not use a body-only mutation.");
  });
  const officeDocument = {
    url: settings.url ?? "file:///disposable-rich-document.docx",
    getFileAsync: vi.fn(
      (
        _type: unknown,
        _options: unknown,
        callback: (result: unknown) => void,
      ) => {
        events.push("capture-file");
        const call = getFileCalls++;
        if (cannotRead || failingReads.delete(call)) {
          callback({ status: "failed" });
          return;
        }
        const captured = new Uint8Array(current);
        const count = Math.ceil(captured.length / 65536);
        callback({
          status: "succeeded",
          value: {
            size: captured.length,
            sliceCount: count,
            closeAsync: close,
            getSliceAsync: (index: number, done: (result: unknown) => void) => {
              const data = captured.slice(index * 65536, (index + 1) * 65536);
              done({
                status: "succeeded",
                value: { index, size: data.length, data: Array.from(data) },
              });
            },
          },
        });
        afterCapture.splice(0).forEach((apply) => apply());
      },
    ),
  };
  const document = {
    get changeTrackingMode() {
      return trackingMode;
    },
    set changeTrackingMode(_value: string) {
      throw new Error("The add-in must never change the Track Changes mode.");
    },
    load: vi.fn(),
    insertFileFromBase64: insert,
    getParagraphByUniqueLocalId: (id: string) =>
      paragraphProxy(() => {
        const found = bodyParagraphs(live()).find((p) => idOf(p) === id);
        if (!found) throw itemNotFound();
        return found;
      }),
    contentControls: {
      get items() {
        return [...controls.keys()].map(controlProxy);
      },
      getByIdOrNullObject: controlProxy,
      load: vi.fn(),
    },
    body: {
      insertOoxml: bodyInsert,
      getOoxml: () => ({ value: wordDocumentFileToOoxml(current) }),
      get paragraphs() {
        return paragraphCollection();
      },
      load: (properties: string) =>
        enqueue(false, "load", () => {
          if (properties.split(",").some((p) => p.trim() === "text"))
            bodyText = bodyParagraphs(live()).map(paragraphText).join("\r");
        }),
      get text() {
        if (bodyText === undefined)
          throw Object.assign(
            new Error("The property 'text' is not available."),
            {
              code: "PropertyNotLoaded",
            },
          );
        return bodyText;
      },
      insertParagraph: (text: string, location: string) => {
        let made: Element | undefined;
        enqueue(true, "insertParagraph", () => {
          const doc = live();
          const body = mainBody(doc)!;
          const first = Array.from(body.children)[0];
          // Like pressing Enter at that end of the body: the new paragraph continues its neighbour.
          made = newParagraph(
            doc,
            location === "Start"
              ? isParagraph(first)
                ? first
                : undefined
              : finalParagraph(doc),
          );
          if (text) made.append(newRun(doc, text));
          const section = Array.from(body.children).find(
            (e) => e.namespaceURI === W && e.localName === "sectPr",
          );
          body.insertBefore(
            made,
            location === "Start" ? body.firstChild : (section ?? null),
          );
        });
        return paragraphProxy(() => {
          if (!made) throw itemNotFound();
          return made;
        });
      },
    },
  };
  let bodyText: string | undefined;
  const afterSync = () => {
    for (const entry of [...afterSyncs])
      if (--entry.remaining <= 0) {
        afterSyncs.splice(afterSyncs.indexOf(entry), 1);
        entry.apply();
      }
  };
  const context = {
    document,
    sync: vi.fn(async () => {
      events.push("sync");
      try {
        runQueue();
      } finally {
        afterSync();
      }
      let changedLocks = false;
      while (pendingLocks.length) {
        const write = pendingLocks.shift()!;
        if (write.id === faultLockId) {
          pendingLocks.length = 0;
          if (changedLocks) persistLocks();
          throw Object.assign(new Error("Native control flag rejected."), {
            code: "GeneralException",
          });
        }
        const state = controls.get(write.id)!;
        let ancestor = state.parentId;
        while (ancestor !== undefined) {
          if (controls.get(ancestor)?.cannotEdit)
            throw new Error("Outer control is still locked.");
          ancestor = controls.get(ancestor)?.parentId;
        }
        state[write.key] = write.value;
        changedLocks = true;
        events.push(`native-lock:${write.id}:${write.key}=${write.value}`);
      }
      if (changedLocks) persistLocks();
      if (!pending) return;
      if (
        faultBeforeWrite ||
        [...controls.values()].some((c) => c.cannotEdit || c.cannotDelete)
      ) {
        pending = undefined;
        if (changeUrlOnFailure) officeDocument.url = changeUrlOnFailure;
        throw Object.assign(new Error("Native import rejected."), {
          code: "GeneralException",
          debugInfo: { errorLocation: "Document.insertFileFromBase64" },
        });
      }
      replaceCurrent(
        decorateWrite(
          merged(pending.bytes, current, pending.options, settings, nsid),
        ),
        false,
      );
      pending = undefined;
      loadControls();
      events.push("native-import-completed");
      afterImport.splice(0).forEach((apply) => apply());
      if (faultAfterWrite !== undefined)
        throw Object.assign(new Error(faultAfterWrite), {
          code: "GeneralException",
          debugInfo: {
            errorLocation: "Document.insertFileFromBase64",
            statement: faultAfterWrite,
          },
        });
    }),
  };
  const web = (settings.profile ?? "word-web") === "word-web";
  vi.stubGlobal("Office", {
    context: {
      document: officeDocument,
      requirements: { isSetSupported: settings.isSetSupported ?? (() => true) },
      diagnostics: {
        host: "Word",
        platform: web ? "OfficeOnline" : "PC",
        version: web ? "16.0.0.0" : "16.0.20326.20000",
      },
    },
    FileType: { Compressed: "compressed" },
    AsyncResultStatus: { Succeeded: "succeeded" },
  });
  vi.stubGlobal("Word", {
    run: async (
      callback: (context: Word.RequestContext) => Promise<unknown>,
    ) => {
      // Office.js gives each Word.run its own context and caches navigation properties on it:
      // body.paragraphs is one collection per run, and each load replaces its items.
      const paragraphs = paragraphCollection();
      const body = Object.create(document.body, {
        paragraphs: { get: () => paragraphs },
      });
      const runDocument = Object.create(document, { body: { value: body } });
      return callback(
        Object.create(context, {
          document: { value: runDocument },
        }) as Word.RequestContext,
      );
    },
  });
  const at = (when: When, apply: () => void) => {
    if (when === "now") apply();
    else if (typeof when === "object")
      afterSyncs.push({ remaining: when.afterSync, apply });
    else (when === "after-capture" ? afterCapture : afterImport).push(apply);
  };
  return {
    insert,
    bodyInsert,
    close,
    document,
    officeDocument,
    context,
    events,
    importOptions,
    get: () => current,
    ooxml: () => wordDocumentFileToOoxml(current),
    set,
    controls: () => [...controls.values()].map((control) => ({ ...control })),
    setTrackingMode: (mode: string) => {
      trackingMode = mode;
    },
    failImport: (newUrl?: string) => {
      faultBeforeWrite = true;
      changeUrlOnFailure = newUrl;
    },
    failUnlock: (id: number) => {
      faultLockId = id;
    },
    /** The import lands, then Word reports an error whose message is `message`. */
    failAfterWrite: (message = "private content must not escape") => {
      faultAfterWrite = message;
    },
    failRead: () => {
      cannotRead = true;
    },
    /** Fail one file capture, `after` successful captures from now. */
    failGetFile: (after = 0) => {
      failingReads.add(getFileCalls + after);
    },
    changeUrl: (url: string, when: When = "now") =>
      at(when, () => {
        officeDocument.url = url;
      }),
    /** A user edit to the open document, applied now or right after the next capture/import. */
    userEdit: (edit: (ooxml: string) => string, when: When = "now") =>
      at(when, () => editNow(edit)),
    /** A user retyping body paragraph `index` (body.paragraphs order); its ID stays the same. */
    editParagraph: (index: number, text: string, when: When = "now") =>
      at(when, () => {
        const doc = live();
        const paragraph = bodyParagraphs(doc)[index];
        const props = child(runsOf(paragraph)[0], "rPr");
        for (const node of Array.from(paragraph.childNodes))
          if (
            !(
              node instanceof Element &&
              node.namespaceURI === W &&
              node.localName === "pPr"
            )
          )
            node.remove();
        paragraph.append(newRun(doc, text, props));
        current = wordDocumentOoxmlToFile(serialize(doc));
        loadControls();
      }),
    /** The n-th object-model change from now (1-based) is rejected; earlier ones stay written. */
    failAtCommand: (n: number, message = "Word rejected the change.") => {
      failAt = writesSeen + n;
      failMessage = message;
    },
    setReplaceFault: (fault: WordReplaceFault | undefined) => {
      replaceFault = fault;
    },
    /** Every Paragraph.getOoxml read fails with `message` until resume(). */
    failParagraphOoxml: (message = "Word could not read the paragraph.") => {
      paragraphOoxmlFault = message;
    },
    paragraphIds: () => bodyParagraphs(live()).map(idOf),
    resume: () => {
      faultAfterWrite = undefined;
      faultBeforeWrite = false;
      faultLockId = undefined;
      changeUrlOnFailure = undefined;
      cannotRead = false;
      failingReads.clear();
      failAt = undefined;
      paragraphOoxmlFault = undefined;
    },
    transform: (value: (bytes: Uint8Array) => Uint8Array) => {
      decorateWrite = value;
    },
    clearNativeUndo: () => events.push("native-undo-cleared"),
  };
}

export type WordOoxmlHost = ReturnType<typeof installWordOoxmlHost>;
