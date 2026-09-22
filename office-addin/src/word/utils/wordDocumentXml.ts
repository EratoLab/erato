import { wordReadableSourceBlock } from "./wordAuthoringReadData";
import {
  applyWordParagraphFormatting,
  applyWordRunFormatting,
  readWordParagraphFormatting,
  readWordRunFormatting,
} from "./wordBlockFormatting";
import {
  MAX_DOCUMENT_BLOCKS,
  MAX_SOURCE_BYTES,
  wordPlanOutput,
} from "./wordDocumentPlan";
import { sameWordFullDocumentContent } from "./wordFullDocumentComparison";
import { resolveWordImageAsset } from "./wordImageAssetData";
import {
  compileWordField,
  compileWordBookmark,
  compileWordContentControl,
  applyWordNativeStructures,
} from "./wordInlineStructures";
import {
  cloneWordMediaNode,
  isWordMediaElementActive,
} from "./wordMediaComparison";
import {
  compileWordImage,
  compileWordDrawing,
  rebindWordMediaRelationships,
  reserveWordNativeIds,
} from "./wordMediaContent";
import {
  nativeBodyGroups,
  nativeDescription,
  nativeVisibleText,
  wordMainBody,
  missingWordRelationships,
  createNativeContentSignature,
  preservedWordStories,
  sameWordPreservedParts,
} from "./wordNativeContent";
import { wordSourceDetails, resolveWordSource } from "./wordRichContent";
import {
  extractWordSections,
  extractWordStories,
  compileWordSections,
  compileWordStories,
} from "./wordStories";
import { compileWordTableBlock } from "./wordTableContent";
import { createWordXmlComparison } from "./wordXmlComparison";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
  WordSourceBlock,
} from "./wordDocumentPlan";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const xml = (node: Node) => new XMLSerializer().serializeToString(node);
const all = (node: Element | Document, local: string) =>
  Array.from(node.getElementsByTagNameNS(W, local)).filter(
    isWordMediaElementActive,
  );
const attr = (node: Element | undefined, name = "val") =>
  node?.getAttributeNS(W, name) ?? "";
const child = (node: Element, name: string) =>
  Array.from(node.children).find(
    (e) => e.namespaceURI === W && e.localName === name,
  );
const make = (doc: Document, name: string, value?: string) => {
  const e = doc.createElementNS(W, `w:${name}`);
  if (value !== undefined) e.setAttributeNS(W, "w:val", value);
  return e;
};
function parse(value: string): Document {
  if (value.length > 90 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(value))
    throw new Error("Unsupported document package");
  const doc = new DOMParser().parseFromString(value, "application/xml");
  if (doc.getElementsByTagName("parsererror").length || !wordMainBody(doc))
    throw new Error("Invalid document package");
  return doc;
}

export function wordDocumentFingerprint(value: string): string {
  return createWordXmlComparison(parse(value)).fingerprint();
}

function paragraphText(p: Element): string {
  let result = "";
  const visit = (e: Element) => {
    if (e.namespaceURI === W && e.localName === "t") {
      result += e.textContent ?? "";
      return;
    }
    if (e.namespaceURI === W && e.localName === "tab") {
      result += "\t";
      return;
    }
    if (e.namespaceURI === W && ["br", "cr"].includes(e.localName)) {
      result += "\n";
      return;
    }
    Array.from(e.children).forEach(visit);
  };
  visit(p);
  return result;
}

export function captureWordAuthoringSnapshot(
  ooxml: string,
  identity: string,
  tracking: string,
  fullDocument = false,
  purpose: "read" | "verify" = "read",
): WordAuthoringSnapshot {
  const base: WordAuthoringSnapshot = {
    token: globalThis.crypto.randomUUID(),
    identity,
    ooxml,
    fingerprint: "",
    blocks: [],
    styles: [],
    read: new Set(),
    revoked: false,
    used: false,
    ...(fullDocument ? { fullDocument: true } : {}),
  };
  try {
    const doc = parse(ooxml);
    const body = wordMainBody(doc)!;
    const styleNodes = all(doc, "style");
    base.styles = styleNodes
      .filter((s) => ["paragraph", "table"].includes(attr(s, "type")))
      .map((s) => ({
        id: attr(s, "styleId"),
        name: attr(child(s, "name")),
        type: attr(s, "type"),
      }));
    const styles = new Map(styleNodes.map((s) => [attr(s, "styleId"), s]));
    const inheritedProperty = (
      styleId: string,
      property: string,
    ): Element | undefined => {
      const visited = new Set<string>();
      let current = styleId;
      while (current && !visited.has(current)) {
        visited.add(current);
        const style = styles.get(current);
        if (!style) return undefined;
        const value = all(style, property)[0];
        if (value) return value;
        current = attr(child(style, "basedOn"));
      }
      return undefined;
    };
    const inventory = nativeBodyGroups(body);
    // Full-file imports can temporarily unlock ordinary content controls after
    // saving the original. The older body-only path cannot do this safely.
    base.issueDetails = inventory.issues.filter(
      (issue) => !fullDocument || issue !== "locked-content-control",
    );
    base.preservedStories = preservedWordStories(doc);
    base.stories = extractWordStories(doc);
    if (doc.getElementsByTagNameNS(PKG, "package").length)
      base.sections = extractWordSections(doc);
    if (missingWordRelationships(doc))
      base.issueDetails.push("missing-related-content");
    if (base.issueDetails.length) base.issue = "unsupported";
    const has = (nodes: Element[], names: string[]) =>
      nodes.some((n) =>
        names.some(
          (name) =>
            (n.namespaceURI === W && n.localName === name) ||
            all(n, name).length > 0,
        ),
      );
    base.blocks = inventory.groups.map((nodes, i) => {
      const p = nodes[0];
      const sectionBoundary = has(nodes, ["sectPr"]);
      const anchored = has(nodes, [
        "bookmarkStart",
        "bookmarkEnd",
        "commentRangeStart",
        "commentRangeEnd",
        "commentReference",
        "footnoteReference",
        "endnoteReference",
        "ins",
        "del",
        "moveFrom",
        "moveTo",
      ]);
      const specialRun = nodes.some((n) =>
        all(n, "r").some((r) =>
          Array.from(r.children).some(
            (e) =>
              e.namespaceURI !== W ||
              ![
                "rPr",
                "t",
                "tab",
                "br",
                "cr",
                "lastRenderedPageBreak",
              ].includes(e.localName),
          ),
        ),
      );
      const foreign = nodes.some((n) =>
        Array.from(n.getElementsByTagName("*")).some(
          (e) => e.namespaceURI !== W,
        ),
      );
      const native =
        nodes.length !== 1 ||
        p.namespaceURI !== W ||
        p.localName !== "p" ||
        Array.from(p.children).some(
          (e) =>
            e.namespaceURI !== W ||
            !["pPr", "r", "proofErr", "hyperlink"].includes(e.localName),
        ) ||
        sectionBoundary ||
        anchored ||
        specialRun ||
        foreign ||
        has(nodes, [
          "drawing",
          "pict",
          "object",
          "sdt",
          "fldSimple",
          "fldChar",
          "vanish",
          "webHidden",
        ]);
      if (native) {
        const wrapper = body.cloneNode(false) as Element;
        nodes.forEach((n) => wrapper.append(cloneWordMediaNode(n)));
        return {
          ref: `b${i + 1}`,
          type: "native",
          protected: false,
          nativeKind: sectionBoundary
            ? "section-break"
            : nodes.length > 1 || anchored
              ? "anchored-content"
              : has(nodes, ["tbl"])
                ? "table"
                : has(nodes, ["drawing", "pict", "object"])
                  ? "image"
                  : has(nodes, ["sdt"])
                    ? "content-control"
                    : has(nodes, ["fldSimple", "fldChar"])
                      ? "field"
                      : "rich-content",
          ...(sectionBoundary ? { sectionBoundary: true } : {}),
          ...(nativeDescription(nodes)
            ? { description: nativeDescription(nodes) }
            : {}),
          text: nodes.map(nativeVisibleText).join("\n"),
          xml: xml(wrapper),
        } satisfies WordSourceBlock;
      }
      const pPr = child(p, "pPr");
      const styleRef = pPr ? attr(child(pPr, "pStyle")) : "";
      const headingLevel = Number(
        attr(all(p, "outlineLvl")[0]) ||
          attr(inheritedProperty(styleRef, "outlineLvl")) ||
          (/^Heading[1-9]$/i.test(styleRef)
            ? String(Number(styleRef.slice(-1)) - 1)
            : "NaN"),
      );
      const numberingProps =
        all(p, "numPr")[0] ?? inheritedProperty(styleRef, "numPr");
      const numId = numberingProps ? attr(all(numberingProps, "numId")[0]) : "";
      const listLevel = numberingProps
        ? Number(attr(all(numberingProps, "ilvl")[0]) || "0")
        : 0;
      const numbering = all(doc, "num").find((n) => attr(n, "numId") === numId);
      const abstractId = numbering
        ? attr(all(numbering, "abstractNumId")[0])
        : "";
      const definition = all(doc, "abstractNum").find(
        (n) => attr(n, "abstractNumId") === abstractId,
      );
      const levelDefinition = definition
        ? all(definition, "lvl").find(
            (n) => attr(n, "ilvl") === String(listLevel),
          )
        : undefined;
      const format = levelDefinition
        ? attr(all(levelDefinition, "numFmt")[0])
        : "";
      const isList = !!numId && numId !== "0";
      const runs = all(p, "r").map((r) => ({
        text: paragraphText(r),
        ...readWordRunFormatting(child(r, "rPr")),
        ...(all(r, "b").some((e) => !["0", "false", "off"].includes(attr(e)))
          ? { bold: true }
          : {}),
        ...(all(r, "i").some((e) => !["0", "false", "off"].includes(attr(e)))
          ? { italic: true }
          : {}),
        ...(all(r, "u").some((e) => attr(e) !== "none")
          ? { underline: true }
          : {}),
      }));
      const directFormat = readWordParagraphFormatting(pPr);

      return {
        ref: `b${i + 1}`,
        text: paragraphText(p),
        type: isList
          ? "list-item"
          : headingLevel >= 0 && headingLevel < 9
            ? "heading"
            : "paragraph",
        ...(isList
          ? { level: listLevel }
          : Number.isFinite(headingLevel) && headingLevel < 9
            ? { level: headingLevel + 1 }
            : {}),
        ...(styleRef ? { styleRef } : {}),
        ...(isList
          ? { list: `existing-${numId}`, ordered: format !== "bullet" }
          : {}),
        ...(runs.some((r) => Object.keys(r).some((k) => k !== "text"))
          ? { runs }
          : {}),
        ...(Object.keys(directFormat).length ? { format: directFormat } : {}),
        protected: false,
        xml: xml(p),
      } satisfies WordSourceBlock;
    });
    for (const block of base.blocks)
      Object.assign(block, wordSourceDetails(block.xml, block.ref));
    const bodyParagraphs = all(body, "p");
    for (const section of base.sections ?? []) {
      if (section.afterParagraph === undefined) continue;
      const paragraph = bodyParagraphs[section.afterParagraph - 1];
      const group = inventory.groups.findIndex((nodes) =>
        nodes.some((node) => node === paragraph || node.contains(paragraph)),
      );
      if (group >= 0) section.afterBlock = base.blocks[group].ref;
    }
    if (
      purpose === "read" &&
      (base.blocks.length > MAX_DOCUMENT_BLOCKS ||
        new TextEncoder().encode(
          JSON.stringify(base.blocks.map(wordReadableSourceBlock)),
        ).length > MAX_SOURCE_BYTES)
    )
      base.issue = "too-large";
    if (tracking !== "Off") base.issue = "tracking";
    base.fingerprint = wordDocumentFingerprint(ooxml);
  } catch {
    base.issue = "unavailable";
  }
  return base;
}

/** Create a missing package part, maintaining its relationship to document.xml. */
function ensurePart(doc: Document, name: "styles" | "numbering"): Element {
  const existing = all(doc, name)[0];
  if (existing) return existing;
  const pkg = doc.getElementsByTagNameNS(PKG, "package")[0];
  if (!pkg)
    throw new Error("A Word package is required for new structural styles");
  const part = doc.createElementNS(PKG, "pkg:part");
  part.setAttributeNS(PKG, "pkg:name", `/word/${name}.xml`);
  part.setAttributeNS(
    PKG,
    "pkg:contentType",
    `application/vnd.openxmlformats-officedocument.wordprocessingml.${name}+xml`,
  );
  const data = doc.createElementNS(PKG, "pkg:xmlData");
  const root = make(doc, name);
  data.append(root);
  part.append(data);
  pkg.append(part);
  let relPart = Array.from(doc.getElementsByTagNameNS(PKG, "part")).find(
    (e) => e.getAttributeNS(PKG, "name") === "/word/_rels/document.xml.rels",
  );
  if (!relPart) {
    relPart = doc.createElementNS(PKG, "pkg:part");
    relPart.setAttributeNS(PKG, "pkg:name", "/word/_rels/document.xml.rels");
    relPart.setAttributeNS(
      PKG,
      "pkg:contentType",
      "application/vnd.openxmlformats-package.relationships+xml",
    );
    const relData = doc.createElementNS(PKG, "pkg:xmlData");
    relData.append(doc.createElementNS(REL, "Relationships"));
    relPart.append(relData);
    pkg.append(relPart);
  }
  const relRoot = relPart.getElementsByTagNameNS(REL, "Relationships")[0];
  const relationship = doc.createElementNS(REL, "Relationship");
  relationship.setAttribute(
    "Id",
    `erato-${name}-${globalThis.crypto.randomUUID()}`,
  );
  relationship.setAttribute("Type", `${OFFICE_REL}${name}`);
  relationship.setAttribute("Target", `${name}.xml`);
  relRoot.append(relationship);
  return root;
}

function ensureHeading(doc: Document, level: number): string {
  const styles = ensurePart(doc, "styles");
  const styleDefinitions = all(styles, "style");
  const existing = styleDefinitions.find(
    (s) =>
      attr(s, "type") === "paragraph" &&
      (attr(s, "styleId").toLowerCase() === `heading${level}` ||
        attr(child(s, "name")).toLowerCase() === `heading ${level}`),
  );
  if (existing) return attr(existing, "styleId");
  const existingIds = new Set(
    styleDefinitions.map((style) => attr(style, "styleId").toLowerCase()),
  );
  const allocateId = (preferred: string): string => {
    let result = preferred;
    for (let suffix = 2; existingIds.has(result.toLowerCase()); suffix++)
      result = `${preferred}_${suffix}`;
    existingIds.add(result.toLowerCase());
    return result;
  };
  // Style IDs share one namespace across paragraph, character and table styles.
  const headingId = allocateId(`Heading${level}`);
  const characterId = allocateId(`${headingId}Char`);
  const defaultStyleId = (type: string, conventional: string) => {
    const typed = styleDefinitions.filter(
      (style) => attr(style, "type") === type,
    );
    const style =
      typed.find((candidate) =>
        ["1", "true", "on"].includes(attr(candidate, "default")),
      ) ??
      typed.find(
        (candidate) =>
          attr(candidate, "styleId").toLowerCase() ===
          conventional.toLowerCase(),
      );
    return style ? attr(style, "styleId") : undefined;
  };
  const paragraphBase = defaultStyleId("paragraph", "Normal");
  const characterBase = defaultStyleId("character", "DefaultParagraphFont");
  const style = make(doc, "style");
  style.setAttributeNS(W, "w:type", "paragraph");
  style.setAttributeNS(W, "w:styleId", headingId);
  style.append(
    make(doc, "name", `heading ${level}`),
    ...(paragraphBase
      ? [make(doc, "basedOn", paragraphBase), make(doc, "next", paragraphBase)]
      : []),
    make(doc, "link", characterId),
    make(doc, "qFormat"),
  );
  const props = make(doc, "pPr");
  props.append(
    make(doc, "keepNext"),
    make(doc, "outlineLvl", String(level - 1)),
  );
  const runs = make(doc, "rPr");
  runs.append(
    make(doc, "b"),
    make(doc, "sz", String(Math.max(22, 36 - level * 2))),
  );
  style.append(props, runs);
  // Word's built-in heading is a linked paragraph/character style. Emit both
  // halves so native import does not have to complete the style definition.
  const character = make(doc, "style");
  character.setAttributeNS(W, "w:type", "character");
  character.setAttributeNS(W, "w:customStyle", "1");
  character.setAttributeNS(W, "w:styleId", characterId);
  character.append(
    make(doc, "name", `Heading ${level} Char`),
    ...(characterBase ? [make(doc, "basedOn", characterBase)] : []),
    make(doc, "link", headingId),
    runs.cloneNode(true),
  );
  styles.append(style, character);
  for (const latent of all(styles, "lsdException"))
    if (attr(latent, "name").toLowerCase() === `heading ${level}`)
      latent.setAttributeNS(W, "w:uiPriority", "0");
  return headingId;
}

function newList(doc: Document, ordered: boolean): string {
  const numbering = ensurePart(doc, "numbering");
  const next = (name: string, attribute: string) =>
    String(
      Math.max(
        0,
        ...all(numbering, name).map((n) => Number(attr(n, attribute)) || 0),
      ) + 1,
    );
  const abstractId = next("abstractNum", "abstractNumId");
  const numId = next("num", "numId");
  const abstract = make(doc, "abstractNum");
  abstract.setAttributeNS(W, "w:abstractNumId", abstractId);
  abstract.append(make(doc, "multiLevelType", "multilevel"));
  for (let level = 0; level < 9; level++) {
    const lvl = make(doc, "lvl");
    lvl.setAttributeNS(W, "w:ilvl", String(level));
    lvl.append(
      make(doc, "start", "1"),
      make(doc, "numFmt", ordered ? "decimal" : "bullet"),
      make(doc, "lvlText", ordered ? `%${level + 1}.` : "•"),
      make(doc, "lvlJc", "left"),
    );
    const props = make(doc, "pPr");
    const ind = make(doc, "ind");
    ind.setAttributeNS(W, "w:left", String((level + 1) * 720));
    ind.setAttributeNS(W, "w:hanging", "360");
    props.append(ind);
    lvl.append(props);
    abstract.append(lvl);
  }
  const num = make(doc, "num");
  num.setAttributeNS(W, "w:numId", numId);
  num.append(make(doc, "abstractNumId", abstractId));
  const firstNum = all(numbering, "num")[0];
  numbering.insertBefore(abstract, firstNum ?? null);
  numbering.append(num);
  return numId;
}

/** Deterministic typed output; never interpret model text as HTML/XML. */
export function compileWordDocumentPlan(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
): string {
  const doc = parse(snapshot.ooxml);
  const body = wordMainBody(doc)!;
  const section = child(body, "sectPr")?.cloneNode(true);
  const originalSections = extractWordSections(doc);
  const lists = new Map<string, string>();
  const outputBlocks = new Map<string, Element>();
  const output = wordPlanOutput(plan, snapshot);
  const unwrap = (fragment: Element): Element[] =>
    fragment.namespaceURI === W &&
    ["body", "hdr", "ftr", "footnote", "endnote", "comment"].includes(
      fragment.localName,
    )
      ? Array.from(fragment.children)
      : [fragment];
  const resolve = (ref: string) => {
    const source = resolveWordSource(snapshot, ref);
    if (!source) throw new Error("Unknown structured content reference");
    return source;
  };
  const compileBlocks = (
    blocks: WordPlanBlock[],
    owner = "/word/document.xml",
  ): Element[] => {
    const nodes: Element[] = [];
    for (const b of blocks) {
      let made: Element[];
      if (b.type === "table") {
        const source = b.sourceRef ? resolve(b.sourceRef) : undefined;
        const fragment = source
          ? new DOMParser().parseFromString(source.xml, "application/xml")
              .documentElement
          : undefined;
        const tables = fragment
          ? [
              fragment,
              ...Array.from(fragment.getElementsByTagNameNS(W, "tbl")),
            ].filter(
              (e, i, all) =>
                e.namespaceURI === W &&
                e.localName === "tbl" &&
                all.indexOf(e) === i,
            )
          : [];
        const table = compileWordTableBlock(
          doc,
          b,
          (childBlocks) => compileBlocks(childBlocks, owner),
          tables[source?.index ?? 0],
        );
        if (source && source.part !== owner)
          rebindWordMediaRelationships(doc, table, source.part, owner);
        made = [table];
      } else if (b.type === "image" || b.type === "drawing") {
        const spec = b.type === "image" ? b.image : b.drawing;
        const source = spec.sourceRef ? resolve(spec.sourceRef) : undefined;
        const options = {
          sourceXml: source?.xml,
          sourcePart: source?.part,
          storyPart: owner,
        };
        made = [
          b.type === "image"
            ? compileWordImage(
                doc,
                {
                  ...resolveWordImageAsset(b.image, snapshot.assets),
                  ...(source?.index !== undefined
                    ? { sourceIndex: source.index }
                    : {}),
                },
                options,
              )
            : compileWordDrawing(
                doc,
                {
                  ...b.drawing,
                  ...(source?.index !== undefined
                    ? { sourceIndex: source.index }
                    : {}),
                },
                options,
              ),
        ];
      } else if (b.type === "field") made = [compileWordField(doc, b.field)];
      else if (b.type === "bookmark")
        made = compileWordBookmark(doc, b.bookmark, (childBlocks) =>
          compileBlocks(childBlocks, owner),
        );
      else if (b.type === "content-control")
        made = [
          compileWordContentControl(doc, b.control, (childBlocks) =>
            compileBlocks(childBlocks, owner),
          ),
        ];
      else if (b.type === "native-edit") {
        const source = resolve(b.sourceRef);
        const sourceRoot = new DOMParser().parseFromString(
          source.xml,
          "application/xml",
        ).documentElement;
        const fragment = doc.importNode(sourceRoot, true);
        if (source.part !== owner)
          rebindWordMediaRelationships(doc, fragment, source.part, owner);
        const edits = b.edits.map((edit) =>
          edit.kind === "image" && edit.image
            ? {
                ...edit,
                image: resolveWordImageAsset(edit.image, snapshot.assets),
              }
            : edit,
        );
        made = unwrap(
          applyWordNativeStructures(doc, fragment, edits, {
            compileBlocks: (childBlocks) => compileBlocks(childBlocks, owner),
            sourcePart: owner,
            storyPart: owner,
            resolveMediaSource: (ref) => {
              const found = resolve(ref);
              return {
                sourceXml: found.xml,
                sourcePart: found.part,
                sourceIndex: found.index,
              };
            },
          }),
        );
      } else {
        const p = make(doc, "p"),
          props = make(doc, "pPr");
        if (b.type === "heading")
          props.append(
            make(doc, "pStyle", ensureHeading(doc, b.level ?? 1)),
            make(doc, "outlineLvl", String((b.level ?? 1) - 1)),
          );
        else props.append(make(doc, "pStyle", b.styleRef ?? "Normal"));
        if (b.type === "list-item" && b.list) {
          if (!lists.has(b.list)) lists.set(b.list, newList(doc, !!b.ordered));
          const num = make(doc, "numPr");
          num.append(
            make(doc, "ilvl", String(b.level ?? 0)),
            make(doc, "numId", lists.get(b.list)),
          );
          props.append(num);
        }
        if (b.format) applyWordParagraphFormatting(props, b.format);
        p.append(props);
        for (const run of b.runs ?? [{ text: b.text }]) {
          const r = make(doc, "r"),
            rp = make(doc, "rPr");
          applyWordRunFormatting(rp, { ...b.format?.font, ...run });
          if (rp.children.length) r.append(rp);
          run.text.split("\t").forEach((piece, i) => {
            if (i) r.append(make(doc, "tab"));
            const t = make(doc, "t");
            t.setAttributeNS(
              "http://www.w3.org/XML/1998/namespace",
              "xml:space",
              "preserve",
            );
            t.textContent = piece;
            r.append(t);
          });
          p.append(r);
        }
        made = [p];
      }
      // Adjacent tables are merged by Word unless separated by a paragraph.
      if (nodes.at(-1)?.localName === "tbl" && made[0]?.localName === "tbl")
        nodes.push(make(doc, "p"));
      nodes.push(...made);
      if (made.length) outputBlocks.set(b.id, made.at(-1)!);
    }
    return nodes;
  };
  reserveWordNativeIds(doc);
  body.replaceChildren();
  for (const entry of output) {
    let nodes: Element[];
    if (entry.kind === "keep") {
      const source = entry.block as WordSourceBlock;
      const fragment = new DOMParser().parseFromString(
        source.xml,
        "application/xml",
      ).documentElement;
      nodes = unwrap(fragment).map((n) => doc.importNode(n, true));
      if (nodes.length) outputBlocks.set(source.ref, nodes.at(-1)!);
    } else nodes = compileBlocks([entry.block as WordPlanBlock]);
    if (
      body.lastElementChild?.localName === "tbl" &&
      nodes[0]?.localName === "tbl"
    )
      body.append(make(doc, "p"));
    body.append(...nodes);
  }
  if (section) body.append(section);
  compileWordStories(
    doc,
    plan.stories ?? [],
    compileBlocks,
    outputBlocks,
    snapshot.stories,
  );
  if (plan.sections)
    compileWordSections(doc, plan.sections, outputBlocks, originalSections);

  return xml(doc);
}

/** Copy the compiled visible draft, including retained cells and native edits.
 * Model summaries are not the final text for these structured block types. */
export function wordPlanDraftText(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
): string {
  const doc = parse(compileWordDocumentPlan(plan, snapshot));
  return nativeVisibleText(wordMainBody(doc)!);
}

export function verifyWordPlanOutput(
  plan: WordDocumentPlan,
  before: WordAuthoringSnapshot,
  after: WordAuthoringSnapshot,
): boolean {
  const touchedNative =
    plan.entries.some(
      (e) =>
        e.kind === "replace" &&
        e.source.some(
          (ref) => before.blocks.find((b) => b.ref === ref)?.type === "native",
        ),
    ) ||
    plan.deleted.some((e) =>
      e.source.some(
        (ref) => before.blocks.find((b) => b.ref === ref)?.type === "native",
      ),
    );
  const richerBlocks = plan.entries.some(
    (e) =>
      e.kind !== "keep" &&
      e.blocks.some(
        (b) =>
          !["paragraph", "heading", "list-item"].includes(b.type) ||
          ("format" in b && b.format) ||
          b.runs?.some((r) =>
            Object.keys(r).some(
              (k) => !["text", "bold", "italic", "underline"].includes(k),
            ),
          ),
      ),
  );
  if (
    before.fullDocument ||
    plan.stories ||
    plan.sections ||
    touchedNative ||
    richerBlocks
  ) {
    const compiled = captureWordAuthoringSnapshot(
      compileWordDocumentPlan(plan, before),
      before.identity,
      "Off",
      before.fullDocument,
      "verify",
    );
    return sameWordBodyContent(compiled, after);
  }
  const expected = wordPlanOutput(plan, before);
  const beforeNative = createNativeContentSignature(before.ooxml);
  const afterNative = createNativeContentSignature(after.ooxml);
  const actualBlocks = verifiedBodyBlocks(
    expected.map((e) => e.block),
    after.blocks,
    afterNative,
  );
  return (
    !after.issue &&
    sameWordPreservedParts(before.ooxml, after.ooxml) &&
    expected.length === actualBlocks.length &&
    expected.every((e, i) => {
      const actual = actualBlocks[i];
      return (
        (e.kind !== "keep" ||
          beforeNative((e.block as WordSourceBlock).xml) ===
            afterNative(actual.xml)) &&
        (!("runs" in e.block) ||
          !e.block.runs ||
          runSignature(e.block) === runSignature(actual)) &&
        e.block.text === actual.text &&
        e.block.type === actual.type &&
        (e.block.type !== "heading" || e.block.level === actual.level) &&
        (e.block.type !== "list-item" ||
          ((e.block.level ?? 0) === (actual.level ?? 0) &&
            e.block.ordered === actual.ordered)) &&
        (!e.block.styleRef || e.block.styleRef === actual.styleRef)
      );
    })
  );
}

export function sameWordBodyContent(
  a: WordAuthoringSnapshot,
  b: WordAuthoringSnapshot,
): boolean {
  if (a.fullDocument && b.fullDocument)
    return (
      !a.issue && !b.issue && sameWordFullDocumentContent(a.ooxml, b.ooxml)
    );
  const beforeNative = createNativeContentSignature(a.ooxml);
  const afterNative = createNativeContentSignature(b.ooxml);
  const actualBlocks = verifiedBodyBlocks(a.blocks, b.blocks, afterNative);
  return (
    !a.issue &&
    !b.issue &&
    sameWordPreservedParts(a.ooxml, b.ooxml) &&
    a.blocks.length === actualBlocks.length &&
    a.blocks.every(
      (block, i) =>
        beforeNative(block.xml) === afterNative(actualBlocks[i].xml),
    )
  );
}

/** Body.insertOoxml can supply one empty terminal paragraph when the plan does
 * not end in one. This is a write-verification allowance only: fingerprints
 * still detect added/removed blank paragraphs before Apply or Revert. */
function verifiedBodyBlocks(
  expected: readonly { type: string; text: string }[],
  actual: WordSourceBlock[],
  signature: (fragment: string) => string,
): WordSourceBlock[] {
  const last = expected[expected.length - 1];
  return actual.length === expected.length + 1 &&
    (!last || last.type !== "paragraph" || last.text !== "") &&
    signature(actual[actual.length - 1].xml) ===
      signature(`<w:p xmlns:w="${W}"/>`)
    ? actual.slice(0, -1)
    : actual;
}

function runSignature(block: {
  text: string;
  runs?: {
    text: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
  }[];
}): string {
  const merged: { text: string; marks: string }[] = [];
  for (const run of block.runs ?? [{ text: block.text }]) {
    const marks = JSON.stringify([!!run.bold, !!run.italic, !!run.underline]);
    const previous = merged[merged.length - 1];
    if (previous?.marks === marks) previous.text += run.text;
    else merged.push({ text: run.text, marks });
  }
  return JSON.stringify(merged.filter((r) => r.text));
}
