const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const WP =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const WP14 =
  "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing";
const CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const XMLNS = "http://www.w3.org/2000/xmlns/";
const XML = "http://www.w3.org/XML/1998/namespace";
export const WORD_FINGERPRINT_PREFIX = "word-body-v2:";
const RSIDS = new Set([
  "rsidR",
  "rsidRDefault",
  "rsidRPr",
  "rsidP",
  "rsidDel",
  "rsidSect",
]);
const ON_OFF_PROPERTIES = new Set([
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
  "rtl",
  "cs",
  "specVanish",
  "oMath",
  "keepNext",
  "keepLines",
  "pageBreakBefore",
  "widowControl",
  "suppressLineNumbers",
  "contextualSpacing",
  "mirrorIndents",
  "adjustRightInd",
  "bidi",
  "cantSplit",
  "tblHeader",
  "noWrap",
  "tcFitText",
  "titlePg",
  "evenAndOddHeaders",
]);
export function wordXmlElements(
  node: Document | Element,
  ns: string,
  name: string,
): Element[] {
  const matches = node.getElementsByTagNameNS(ns, name);
  // jsdom rescans named properties on each live-collection lookup, including length.
  const length = matches.length;
  const item = matches.item.bind(matches);
  return Array.from({ length }, (_, index) => item(index)!);
}

function relationshipOwner(path: string): string {
  if (path === "/_rels/.rels") return "";
  return path.replace(/\/_rels\/([^/]+)\.rels$/, "/$1");
}
function targetPath(owner: string, target: string): string {
  const result = target.startsWith("/") ? [] : owner.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") result.pop();
    else if (part && part !== ".") result.push(part);
  }
  return "/" + result.filter(Boolean).join("/");
}
function commentReference(element: Element, attribute: Attr): boolean {
  return (
    (element.namespaceURI === W15 &&
      element.localName === "commentEx" &&
      attribute.namespaceURI === W15 &&
      ["paraId", "paraIdParent"].includes(attribute.localName)) ||
    (element.namespaceURI === CID &&
      element.localName === "commentId" &&
      attribute.namespaceURI === CID &&
      attribute.localName === "paraId")
  );
}
function drawingIdentity(element: Element, attribute: Attr): boolean {
  return (
    element.namespaceURI === WP &&
    ["inline", "anchor"].includes(element.localName) &&
    attribute.namespaceURI === WP14 &&
    ["anchorId", "editId"].includes(attribute.localName)
  );
}

export interface WordXmlComparison {
  fingerprint: () => string;
  signature: (node: Node, owner?: string) => string;
}

export function createWordXmlComparison(doc: Document): WordXmlComparison {
  const parts = new Map(
    wordXmlElements(doc, PKG, "part").map((part) => [
      part.getAttributeNS(PKG, "name") ?? "",
      part,
    ]),
  );
  const roots = new Map<string, Element>();
  if (!parts.size) roots.set("/word/document.xml", doc.documentElement);
  for (const [path, part] of parts) {
    const root = wordXmlElements(part, PKG, "xmlData")[0]?.firstElementChild;
    if (root) roots.set(path, root);
  }
  const relationships = new Map<string, Map<string, Element>>();
  for (const [path, root] of roots) {
    if (root.namespaceURI === REL && root.localName === "Relationships")
      relationships.set(
        relationshipOwner(path),
        new Map(
          Array.from(root.children).map((rel) => [
            rel.getAttribute("Id") ?? "",
            rel,
          ]),
        ),
      );
  }
  const commentTargets = new Set(
    [...(relationships.get("/word/document.xml")?.values() ?? [])]
      .filter((rel) => rel.getAttribute("Type") === R + "/comments")
      .map((rel) =>
        targetPath("/word/document.xml", rel.getAttribute("Target") ?? ""),
      ),
  );
  // Bare packages may omit relationships; infer a comments owner only when there is one candidate.
  if (!commentTargets.size)
    for (const [path, root] of roots)
      if (root.namespaceURI === W && root.localName === "comments")
        commentTargets.add(path);
  const commentsOwner =
    commentTargets.size === 1 ? [...commentTargets][0] : undefined;
  const paragraphIds = new Map<string, Map<string, number | null>>();
  const unknownReferences = new Set<string>();
  const unknownDrawingReferences = new Set<string>();
  for (const [path, root] of roots) {
    const ids = new Map<string, number | null>();
    // MS-DOCX 2.2.4 defines paraId on both paragraphs and table rows.
    wordXmlElements(root, W, "*")
      .filter((e) => ["p", "tr"].includes(e.localName))
      .forEach((p, index) => {
        const id = p.getAttributeNS(W14, "paraId");
        if (id) ids.set(id, ids.has(id) ? null : index);
      });
    paragraphIds.set(path, ids);
    for (const element of [root, ...wordXmlElements(root, "*", "*")])
      for (const attribute of Array.from(element.attributes)) {
        if (
          ["anchorId", "editId"].includes(attribute.localName) &&
          !drawingIdentity(element, attribute)
        )
          unknownDrawingReferences.add(attribute.value);
        if (
          ["paraId", "paraIdParent"].includes(attribute.localName) &&
          !(
            element.namespaceURI === W &&
            ["p", "tr"].includes(element.localName) &&
            attribute.namespaceURI === W14 &&
            attribute.localName === "paraId"
          ) &&
          !commentReference(element, attribute)
        )
          unknownReferences.add(attribute.value);
      }
  }
  const paragraphReference = (
    owner: string | undefined,
    id: string,
  ): string => {
    const index = owner ? paragraphIds.get(owner)?.get(id) : undefined;
    return index !== undefined && index !== null && !unknownReferences.has(id)
      ? JSON.stringify(["paragraph", index])
      : JSON.stringify(["unresolved-paragraph", id]);
  };
  const partCache = new Map<string, string>();
  const defaultParagraphStyle = wordXmlElements(doc, W, "style")
    .find(
      (s) =>
        s.getAttributeNS(W, "type") === "paragraph" &&
        ["1", "true", "on"].includes(s.getAttributeNS(W, "default") ?? ""),
    )
    ?.getAttributeNS(W, "styleId");
  const activeParts = new Set<string>();
  const numberingRoot = roots.get("/word/numbering.xml");
  const abstracts = new Map(
    (numberingRoot ? wordXmlElements(numberingRoot, W, "abstractNum") : []).map(
      (element) => [element.getAttributeNS(W, "abstractNumId"), element],
    ),
  );
  const activeAbstracts = new Set<string>();
  function abstractDefinition(id: string): string {
    const definition = abstracts.get(id);
    if (!definition || activeAbstracts.has(id))
      return JSON.stringify(["unresolved-numbering", id]);
    activeAbstracts.add(id);
    const result = canonical(definition, "/word/numbering.xml", true);
    activeAbstracts.delete(id);
    return result;
  }
  function related(owner: string, id: string, content: boolean): string {
    const rel = relationships.get(owner)?.get(id);
    if (!rel) return JSON.stringify(["missing-relationship", id]);
    const target = rel.getAttribute("Target") ?? "";
    const external = rel.getAttribute("TargetMode") === "External";
    const path = targetPath(owner, target);
    return JSON.stringify([
      rel.getAttribute("Type"),
      external ? "External" : "Internal",
      external ? target : content ? partSignature(path) : path,
    ]);
  }
  function attributes(
    element: Element,
    owner: string,
    content: boolean,
  ): string[] {
    return Array.from(element.attributes)
      .flatMap((attribute) => {
        const ns = attribute.namespaceURI,
          name = attribute.localName;
        if (
          ns === XMLNS ||
          (ns === W && RSIDS.has(name)) ||
          (ns === W14 && name === "textId")
        )
          return [];
        let value = attribute.value;
        if (
          ns === W &&
          name === "val" &&
          element.namespaceURI === W &&
          ON_OFF_PROPERTIES.has(element.localName)
        ) {
          if (["1", "true", "on"].includes(value)) return [];
          if (["0", "false", "off"].includes(value)) value = "0";
        }
        if (
          drawingIdentity(element, attribute) &&
          !unknownDrawingReferences.has(value)
        )
          return [];
        // Word can reorder abstract definitions; resolve them while retaining numId/durableId list identity.
        if (content && ns === W && element.namespaceURI === W) {
          if (element.localName === "abstractNum" && name === "abstractNumId")
            return [];
          if (element.localName === "abstractNumId" && name === "val")
            value = abstractDefinition(value);
        }
        if (
          element.namespaceURI === W &&
          ["p", "tr"].includes(element.localName) &&
          ns === W14 &&
          name === "paraId"
        ) {
          // Only resolved annotation declarations can be omitted for block moves; references retain topology.
          const ids = paragraphIds.get(owner);
          if (
            ids?.has(value) &&
            ids.get(value) !== null &&
            !unknownReferences.has(value)
          )
            return [];
        }
        if (commentReference(element, attribute))
          value = paragraphReference(commentsOwner, value);
        if (ns === R && ["id", "embed", "link"].includes(name))
          value = related(owner, value, content);
        if (
          element.namespaceURI === REL &&
          element.localName === "Relationship" &&
          name === "Id"
        )
          value = related(relationshipOwner(owner), value, content);
        return [JSON.stringify([ns ?? "", name, value])];
      })
      .sort();
  }
  function ignored(element: Element, owner: string): boolean {
    const ns = element.namespaceURI,
      local = element.localName;
    return (
      (ns === W && ["proofErr", "lastRenderedPageBreak"].includes(local)) ||
      (ns === W &&
        local === "rsid" &&
        element.parentElement?.namespaceURI === W &&
        element.parentElement.localName === "style") ||
      (ns === W &&
        local === "sdtEndPr" &&
        !element.children.length &&
        attributes(element, owner, true).length === 0) ||
      (ns === W &&
        local === "pStyle" &&
        !!defaultParagraphStyle &&
        element.getAttributeNS(W, "val") === defaultParagraphStyle &&
        !element.children.length &&
        Array.from(element.attributes).every(
          (a) =>
            a.namespaceURI === XMLNS ||
            (a.namespaceURI === W && a.localName === "val"),
        )) ||
      (owner === "/word/settings.xml" &&
        ns === W &&
        ["rsids", "proofState"].includes(local)) ||
      (owner === "/docProps/app.xml" &&
        ns ===
          "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" &&
        [
          "TotalTime",
          "Pages",
          "Words",
          "Characters",
          "CharactersWithSpaces",
          "Lines",
          "Paragraphs",
          "Application",
          "AppVersion",
        ].includes(local)) ||
      (owner === "/docProps/core.xml" &&
        ((ns ===
          "http://schemas.openxmlformats.org/package/2006/metadata/core-properties" &&
          ["lastModifiedBy", "revision", "lastPrinted"].includes(local)) ||
          (ns === "http://purl.org/dc/terms/" && local === "modified")))
    );
  }
  function textRun(
    node: Node,
    owner: string,
    content: boolean,
  ): { signature: string; text: string } | null | undefined {
    if (node.nodeType !== 1) return undefined;
    const run = node as Element;
    if (run.namespaceURI !== W || run.localName !== "r") return undefined;
    const children = Array.from(run.children);
    if (
      children.some(
        (e) =>
          e.namespaceURI !== W ||
          !["rPr", "t", "lastRenderedPageBreak"].includes(e.localName),
      )
    )
      return undefined;
    const texts = children.filter((e) => e.localName === "t");
    if (
      texts.some(
        (e) =>
          e.children.length ||
          Array.from(e.attributes).some(
            (a) =>
              a.namespaceURI !== XMLNS &&
              !(a.namespaceURI === XML && a.localName === "space"),
          ),
      )
    )
      return undefined;
    const attrs = attributes(run, owner, content);
    const props = children
      .filter(
        (e) =>
          e.localName === "rPr" && (e.children.length || e.attributes.length),
      )
      .map((e) => canonical(e, owner, content));
    const text = texts
      .map((element) => {
        let space: string | null = null;
        for (
          let ancestor: Element | null = element;
          ancestor && space === null;
          ancestor = ancestor.parentElement
        )
          space = ancestor.getAttributeNS(XML, "space");
        const value = element.textContent ?? "";
        return space === "preserve"
          ? value
          : value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
      })
      .join("");
    if (!text && !attrs.length && !props.length) return null;
    return { signature: JSON.stringify([attrs, props]), text };
  }
  function canonical(node: Node, owner: string, content: boolean): string {
    if (node.nodeType === 3 || node.nodeType === 4) {
      if (!node.nodeValue?.trim() && node.parentElement?.children.length)
        return "";
      return JSON.stringify(node.nodeValue ?? "");
    }
    if (node.nodeType !== 1) return "";
    const element = node as Element;
    if (ignored(element, owner)) return "";
    const sequence: { signature: string; text?: string }[] = [];
    for (const child of Array.from(element.childNodes)) {
      const run = textRun(child, owner, content);
      if (run === null) continue;
      if (run) {
        const previous = sequence[sequence.length - 1];
        if (
          previous?.text !== undefined &&
          previous.signature === run.signature
        )
          previous.text += run.text;
        else sequence.push(run);
      } else {
        const signature = canonical(child, owner, content);
        if (signature) sequence.push({ signature });
      }
    }
    const children = sequence.map(({ signature, text }) =>
      text === undefined
        ? signature
        : JSON.stringify(["text-run", signature, text]),
    );
    // Word omits empty paragraph properties after removing an explicit default style.
    if (
      element.namespaceURI === W &&
      element.localName === "pPr" &&
      !children.length &&
      !attributes(element, owner, content).length
    )
      return "";
    if (element.namespaceURI === REL) children.sort();
    return (
      JSON.stringify([
        element.namespaceURI,
        element.localName,
        attributes(element, owner, content),
      ]) +
      "[" +
      children.join(",") +
      "]"
    );
  }
  function partSignature(path: string): string {
    const cached = partCache.get(path);
    if (cached !== undefined) return cached;
    if (activeParts.has(path)) return "relationship-cycle";
    const part = parts.get(path);
    if (!part) return "missing-part";
    activeParts.add(path);
    const binary = wordXmlElements(part, PKG, "binaryData")[0];
    const root = roots.get(path);
    const result =
      (part.getAttributeNS(PKG, "contentType") ?? "") +
      ":" +
      (binary
        ? (binary.textContent ?? "").replace(/\s/g, "")
        : root
          ? canonical(root, path, true)
          : "");
    activeParts.delete(path);
    partCache.set(path, result);
    return result;
  }
  return {
    fingerprint: () =>
      WORD_FINGERPRINT_PREFIX +
      (!parts.size
        ? canonical(doc.documentElement, "/word/document.xml", false)
        : [...parts]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([path, part]) => {
              const root = roots.get(path);
              const binary = wordXmlElements(part, PKG, "binaryData")[0];
              return (
                JSON.stringify([
                  path,
                  part.getAttributeNS(PKG, "contentType"),
                ]) +
                (root
                  ? canonical(root, path, false)
                  : (binary?.textContent ?? "").replace(/\s/g, ""))
              );
            })
            .join("\n")),
    signature: (node, owner = "/word/document.xml") =>
      canonical(node, owner, true),
  };
}
