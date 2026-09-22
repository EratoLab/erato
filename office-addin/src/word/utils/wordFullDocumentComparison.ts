import {
  parseWordXml,
  wordRelationshipOwner,
  wordRelationshipTarget,
} from "./wordDocumentPackageCodec";
import { normalizeWordInlineForComparison } from "./wordInlineStructures";
import { normalizeWordMediaForComparison } from "./wordMediaComparison";
import { normalizeWordTablesForComparison } from "./wordTableComparison";
import { createWordXmlComparison } from "./wordXmlComparison";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const WP14 =
  "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing";
const XMLNS = "http://www.w3.org/2000/xmlns/";
const all = (root: Document | Element, ns: string, local: string) =>
  Array.from(root.getElementsByTagNameNS(ns, local));
const direct = (root: Element | undefined, local: string) =>
  Array.from(root?.children ?? []).find(
    (e) => e.namespaceURI === W && e.localName === local,
  );
const attr = (e: Element | undefined, name = "val") =>
  e?.getAttributeNS(W, name) ?? "";
const children = (e: Element | undefined) => Array.from(e?.children ?? []);

interface PackageView {
  doc: Document;
  parts: Map<string, Element>;
  roots: Map<string, Element>;
  body: Element;
}
function view(xml: string): PackageView {
  const doc = parseWordXml(xml);
  const parts = new Map(
    all(doc, PKG, "part").map((p) => [p.getAttributeNS(PKG, "name") ?? "", p]),
  );
  if (!parts.size || parts.size !== all(doc, PKG, "part").length)
    throw new Error("Invalid document package");
  const roots = new Map<string, Element>();
  for (const [path, part] of parts) {
    const root = all(part, PKG, "xmlData")[0]?.firstElementChild;
    if (root) roots.set(path, root);
  }
  const body = roots
    .get("/word/document.xml")
    ?.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw new Error("Missing document body");
  return { doc, parts, roots, body };
}

/** Native Word declares many unused compatibility namespaces on every new
 * story. Retain the meaning of every used namespace; only unused declarations
 * and the serialization identities already ignored by the base comparator
 * disappear. Unknown/unbound prefixes are never silently accepted. */
function normalizeCompatibility(v: PackageView): void {
  for (const root of v.roots.values()) {
    for (const element of [root, ...all(root, "*", "*")]) {
      const value = element.getAttributeNS(MC, "Ignorable");
      if (value === null) continue;
      const nodes = [element, ...all(element, "*", "*")];
      const used = new Set<string>();
      for (const node of nodes) {
        if (node.namespaceURI) used.add(node.namespaceURI);
        for (const a of Array.from(node.attributes))
          if (
            a.namespaceURI &&
            a.namespaceURI !== XMLNS &&
            a.namespaceURI !== MC &&
            !(
              a.namespaceURI === W14 &&
              ["paraId", "textId"].includes(a.localName)
            ) &&
            !(
              a.namespaceURI === WP14 &&
              ["anchorId", "editId"].includes(a.localName)
            )
          )
            used.add(a.namespaceURI);
      }
      const namespaces = value
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((prefix) => {
          const namespace = element.lookupNamespaceURI(prefix);
          if (!namespace) throw new Error("Unbound compatibility namespace");
          return used.has(namespace) ? namespace : "";
        })
        .filter(Boolean);
      if (namespaces.length)
        element.setAttributeNS(
          MC,
          "mc:Ignorable",
          [...new Set(namespaces)].sort().join(" "),
        );
      else element.removeAttributeNS(MC, "Ignorable");
    }
  }
}

/** Only properties whose complete inherited value is established are removed.
 * A differing explicit size/outline level remains visible to verification. */
function normalizeInheritedFormatting(v: PackageView): void {
  const stylesRoot = v.roots.get("/word/styles.xml");
  const styles = new Map(
    (stylesRoot ? all(stylesRoot, W, "style") : []).map((s) => [
      attr(s, "styleId"),
      s,
    ]),
  );
  const defaults = stylesRoot && all(stylesRoot, W, "docDefaults")[0];
  const pDefault = direct(direct(defaults, "pPrDefault"), "pPr");
  const rDefault = direct(direct(defaults, "rPrDefault"), "rPr");
  const defaultStyle = [...styles.values()].find(
    (s) =>
      attr(s, "type") === "paragraph" &&
      ["1", "true", "on"].includes(attr(s, "default")),
  );
  const inherited = (
    style: Element | undefined,
    group: string,
    name: string,
    fallback: Element | undefined,
    visited = new Set<Element>(),
  ): Element | undefined => {
    if (!style) return direct(fallback, name);
    if (visited.has(style)) return undefined;
    visited.add(style);
    return (
      direct(direct(style, group), name) ??
      inherited(
        styles.get(attr(direct(style, "basedOn"))),
        group,
        name,
        fallback,
        visited,
      )
    );
  };
  const sameProperty = (a: Element, b: Element | undefined) =>
    !!b &&
    !a.children.length &&
    !b.children.length &&
    JSON.stringify(
      Array.from(a.attributes)
        .filter((x) => x.namespaceURI !== XMLNS)
        .map((x) => [x.namespaceURI, x.localName, x.value])
        .sort(),
    ) ===
      JSON.stringify(
        Array.from(b.attributes)
          .filter((x) => x.namespaceURI !== XMLNS)
          .map((x) => [x.namespaceURI, x.localName, x.value])
          .sort(),
      );
  for (const [path, root] of v.roots) {
    if (
      path === "/word/styles.xml" ||
      root.namespaceURI !== W ||
      !["document", "hdr", "ftr", "footnotes", "endnotes", "comments"].includes(
        root.localName,
      )
    )
      continue;
    for (const paragraph of all(root, W, "p")) {
      const pPr = direct(paragraph, "pPr");
      const style = styles.get(attr(direct(pPr, "pStyle"))) ?? defaultStyle;
      const outline = direct(pPr, "outlineLvl");
      if (
        outline &&
        sameProperty(outline, inherited(style, "pPr", "outlineLvl", pDefault))
      )
        outline.remove();
      const markProperties = direct(pPr, "rPr");
      for (const name of ["sz", "szCs"]) {
        const property = direct(markProperties, name);
        if (
          property &&
          sameProperty(property, inherited(style, "rPr", name, rDefault))
        )
          property.remove();
      }
      if (
        markProperties &&
        !markProperties.children.length &&
        !markProperties.attributes.length
      )
        markProperties.remove();
      // Table style conditional run formatting has its own inheritance rules.
      // Leave that case exact instead of assuming the paragraph style wins.
      let inTable = false;
      for (
        let parent = paragraph.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (parent.namespaceURI === W && parent.localName === "tbl")
          inTable = true;
      if (inTable) continue;
      for (const run of all(paragraph, W, "r")) {
        const rPr = direct(run, "rPr");
        if (!rPr) continue;
        const runStyle = styles.get(attr(direct(rPr, "rStyle")));
        for (const name of ["sz", "szCs"]) {
          const property = direct(rPr, name);
          const value =
            inherited(runStyle, "rPr", name, undefined) ??
            inherited(style, "rPr", name, rDefault);
          if (property && sameProperty(property, value)) property.remove();
        }
        if (!rPr.children.length && !rPr.attributes.length) rPr.remove();
      }
    }
    for (const columns of all(root, W, "cols"))
      if (["1", "true", "on"].includes(attr(columns, "equalWidth")))
        columns.removeAttributeNS(W, "equalWidth");
    for (const page of all(root, W, "pgSz"))
      if (attr(page, "orient") === "portrait")
        page.removeAttributeNS(W, "orient");
  }
}

/** w:id on these elements links an anchor to its story; it is not the displayed
 * footnote number or the comment's durable identity. Canonical IDs preserve the
 * complete placement/repetition graph, including bookmark endpoints. */
function normalizeAnchorIds(v: PackageView): void {
  for (const [kind, names] of [
    ["footnote", ["footnoteReference"]],
    ["endnote", ["endnoteReference"]],
    ["comment", ["commentRangeStart", "commentRangeEnd", "commentReference"]],
  ] as const) {
    const root = v.roots.get(`/word/${kind}s.xml`);
    const definitions = new Map<string, Element>();
    for (const node of children(root).filter(
      (e) => e.namespaceURI === W && e.localName === kind,
    )) {
      const id = attr(node, "id");
      if (definitions.has(id)) throw new Error("Duplicate story identity");
      definitions.set(id, node);
    }
    const ids = new Map<string, string>();
    const anchors = all(v.body, W, "*").filter((e) =>
      (names as readonly string[]).includes(e.localName),
    );
    for (const anchor of anchors) {
      const id = attr(anchor, "id");
      if (!definitions.has(id)) throw new Error("Dangling story anchor");
      if (!ids.has(id)) ids.set(id, `anchor-${ids.size}`);
      anchor.setAttributeNS(W, "w:id", ids.get(id)!);
    }
    for (const [id, node] of definitions)
      if (ids.has(id)) node.setAttributeNS(W, "w:id", ids.get(id)!);
    if (root) {
      const expectedChildren = children(root);
      if (
        expectedChildren.every(
          (e) => e.namespaceURI === W && e.localName === kind,
        )
      )
        root.replaceChildren(
          ...expectedChildren.sort((a, b) =>
            attr(a, "id").localeCompare(attr(b, "id")),
          ),
        );
    }
  }
  for (const root of v.roots.values()) {
    const starts = all(root, W, "bookmarkStart"),
      ends = all(root, W, "bookmarkEnd");
    const ids = new Map<string, string>();
    for (const node of starts) {
      const id = attr(node, "id");
      if (ids.has(id) || ends.filter((e) => attr(e, "id") === id).length !== 1)
        throw new Error("Invalid bookmark range");
      ids.set(id, `bookmark-${ids.size}`);
    }
    if (ends.some((e) => !ids.has(attr(e, "id"))))
      throw new Error("Dangling bookmark endpoint");
    for (const node of [...starts, ...ends])
      node.setAttributeNS(W, "w:id", ids.get(attr(node, "id"))!);
  }
}

function commentsById(v: PackageView): Map<string, Element> {
  return new Map(
    children(v.roots.get("/word/comments.xml"))
      .filter((e) => e.namespaceURI === W && e.localName === "comment")
      .map((e) => [attr(e, "id"), e]),
  );
}
function commentParagraphOwners(v: PackageView): Map<string, string> {
  const result = new Map<string, string>();
  for (const [id, node] of commentsById(v))
    for (const p of all(node, W, "p")) {
      const key = p.getAttributeNS(W14, "paraId");
      if (key) {
        if (result.has(key))
          throw new Error("Duplicate comment paragraph identity");
        result.set(key, id);
      }
    }
  return result;
}
const onlyAttributes = (e: Element, ns: string, names: string[]) =>
  Array.from(e.attributes).every(
    (a) =>
      a.namespaceURI === XMLNS ||
      (a.namespaceURI === ns && names.includes(a.localName)),
  );

/** New classic comments acquire default modern records in Word. Existing
 * durable IDs, resolution/reply metadata, and unknown extensions stay exact. */
function normalizeNewCommentMetadata(
  expected: PackageView,
  actual: PackageView,
): void {
  const expectedOwners = commentParagraphOwners(expected),
    actualOwners = commentParagraphOwners(actual);
  const expectedComments = commentsById(expected);
  for (const [path, ns, local] of [
    ["/word/commentsExtended.xml", W15, "commentEx"],
    ["/word/commentsIds.xml", CID, "commentId"],
  ]) {
    const a = expected.roots.get(path),
      b = actual.roots.get(path);
    const expectedRecords = new Set(
      children(a)
        .map((e) => expectedOwners.get(e.getAttributeNS(ns, "paraId") ?? ""))
        .filter(Boolean),
    );
    const ids = new Set<string>();
    for (const e of children(b)) {
      if (e.namespaceURI !== ns || e.localName !== local) continue;
      const owner = actualOwners.get(e.getAttributeNS(ns, "paraId") ?? "");
      if (owner && ids.has(owner))
        throw new Error("Duplicate comment metadata");
      if (owner) ids.add(owner);
      if (!owner || !expectedComments.has(owner) || expectedRecords.has(owner))
        continue;
      if (
        local === "commentEx" &&
        !e.children.length &&
        onlyAttributes(e, ns, ["paraId", "done"]) &&
        [null, "0", "false", "off"].includes(e.getAttributeNS(ns, "done"))
      )
        e.remove();
      if (
        local === "commentId" &&
        !e.children.length &&
        onlyAttributes(e, ns, ["paraId", "durableId"])
      ) {
        const durable = e.getAttributeNS(ns, "durableId") ?? "";
        const references = all(actual.doc, "*", "*")
          .flatMap((n) => Array.from(n.attributes))
          .filter((x) => x.localName === "durableId" && x.value === durable);
        if (/^[0-9A-F]{8}$/i.test(durable) && references.length === 1)
          e.remove();
      }
    }
    for (const [root, owners] of [
      [a, expectedOwners],
      [b, actualOwners],
    ] as const) {
      if (!root) continue;
      for (const e of children(root))
        if (
          ns === W15 &&
          ["0", "false", "off"].includes(e.getAttributeNS(ns, "done") ?? "")
        )
          e.removeAttributeNS(ns, "done");
      // Table order in a metadata part is not thread order; its paraId links are.
      const entries = children(root);
      if (
        entries.every(
          (e) =>
            e.namespaceURI === ns &&
            e.localName === local &&
            owners.has(e.getAttributeNS(ns, "paraId") ?? ""),
        )
      )
        root.replaceChildren(
          ...entries.sort((x, y) =>
            owners
              .get(x.getAttributeNS(ns, "paraId")!)!
              .localeCompare(owners.get(y.getAttributeNS(ns, "paraId")!)!),
          ),
        );
    }
  }
}

function normalizeMarkerDefaults(v: PackageView): void {
  const styles = new Map(
    all(v.doc, W, "style").map((s) => [attr(s, "styleId"), s]),
  );
  const defaults = direct(all(v.doc, W, "rPrDefault")[0], "rPr");
  for (const run of all(v.doc, W, "r")) {
    const content = children(run).filter(
      (e) => !(e.namespaceURI === W && e.localName === "rPr"),
    );
    if (
      content.length !== 1 ||
      content[0].namespaceURI !== W ||
      !["footnoteRef", "endnoteRef", "commentReference"].includes(
        content[0].localName,
      )
    )
      continue;
    const props = direct(run, "rPr"),
      styleRef = direct(props, "rStyle");
    const styleId = attr(styleRef),
      style = styles.get(styleId);
    if (
      !props ||
      !styleRef ||
      !onlyAttributes(props, W, []) ||
      !onlyAttributes(styleRef, W, ["val"])
    )
      continue;
    if (
      ["FootnoteReference", "EndnoteReference"].includes(styleId) &&
      !style &&
      props.children.length === 1
    )
      props.remove();
    if (
      content[0].localName === "commentReference" &&
      styleId === "CommentReference" &&
      style
    ) {
      const styleProps = new Map<string, Element>();
      const visited = new Set<Element>();
      let simpleStyle = true;
      for (
        let source: Element | undefined = style;
        source;
        source = styles.get(attr(direct(source, "basedOn")))
      ) {
        if (visited.has(source)) {
          simpleStyle = false;
          break;
        }
        visited.add(source);
        const rPr = direct(source, "rPr");
        if (rPr && !onlyAttributes(rPr, W, [])) simpleStyle = false;
        for (const p of children(rPr)) {
          if (
            p.namespaceURI !== W ||
            !["sz", "szCs"].includes(p.localName) ||
            !onlyAttributes(p, W, ["val"]) ||
            p.children.length
          )
            simpleStyle = false;
          if (!styleProps.has(p.localName)) styleProps.set(p.localName, p);
        }
      }
      if (
        simpleStyle &&
        children(props).every(
          (p) =>
            p.namespaceURI === W &&
            ["rStyle", "sz", "szCs"].includes(p.localName),
        ) &&
        ["sz", "szCs"].every((name) => {
          const effective =
            direct(props, name) ??
            styleProps.get(name) ??
            direct(defaults, name);
          return (
            !!effective &&
            attr(effective) === attr(direct(defaults, name)) &&
            onlyAttributes(effective, W, ["val"])
          );
        })
      )
        props.remove();
    }
  }
}
function normalizeAddedCommentMarkers(
  expected: PackageView,
  actual: PackageView,
): void {
  const observed = commentsById(actual);
  for (const [id, before] of commentsById(expected)) {
    if (all(before, W, "annotationRef").length) continue;
    const after = observed.get(id);
    if (!after) continue;
    const p = all(after, W, "p")[0];
    const run = children(p).find(
      (e) => !(e.namespaceURI === W && e.localName === "pPr"),
    );
    const props = direct(run, "rPr");
    if (
      run?.namespaceURI === W &&
      run.localName === "r" &&
      onlyAttributes(run, W, ["rsidR", "rsidRPr", "rsidDel"]) &&
      children(run).filter((e) => e !== props).length === 1 &&
      direct(run, "annotationRef") &&
      !direct(run, "annotationRef")!.attributes.length &&
      (!props ||
        (onlyAttributes(props, W, []) &&
          props.children.length === 1 &&
          attr(direct(props, "rStyle")) === "CommentReference" &&
          onlyAttributes(direct(props, "rStyle")!, W, ["val"])))
    )
      run.remove();
  }
}

function emptyOptionalPart(root: Element): boolean {
  return (
    !root.children.length &&
    !root.textContent?.trim() &&
    Array.from(root.attributes).every(
      (a) =>
        a.namespaceURI === XMLNS ||
        (a.namespaceURI === MC && a.localName === "Ignorable"),
    ) &&
    ((root.namespaceURI === W && root.localName === "comments") ||
      (root.namespaceURI === W15 && root.localName === "commentsEx") ||
      (root.namespaceURI === CID && root.localName === "commentsIds"))
  );
}
/** Native import registers fonts needed by authored runs. Existing definitions
 * (including embedded font relationships) and every requested rFonts value
 * remain exact; only additional, uniquely named registrations are optional. */
function normalizeAddedFonts(expected: PackageView, actual: PackageView): void {
  const before = expected.roots.get("/word/fontTable.xml"),
    after = actual.roots.get("/word/fontTable.xml");
  if (
    !before ||
    !after ||
    before.namespaceURI !== W ||
    after.namespaceURI !== W ||
    before.localName !== "fonts" ||
    after.localName !== "fonts"
  )
    return;
  const names = new Set(
    children(before)
      .filter((e) => e.namespaceURI === W && e.localName === "font")
      .map((e) => attr(e, "name")),
  );
  const seen = new Set<string>();
  for (const font of children(after).filter(
    (e) => e.namespaceURI === W && e.localName === "font",
  )) {
    const name = attr(font, "name");
    if (!name || seen.has(name)) throw new Error("Invalid font registration");
    seen.add(name);
    if (!names.has(name)) font.remove();
  }
}

function definitions(
  root: Element | undefined,
  local: string,
  key: string,
): Map<string, Element> {
  const result = new Map<string, Element>();
  for (const entry of children(root).filter(
    (e) => e.namespaceURI === W && e.localName === local,
  )) {
    const id = attr(entry, key);
    if (!id || result.has(id)) throw new Error("Duplicate document definition");
    result.set(id, entry);
  }
  return result;
}

/** Native Word completes an unused linked character style from the unchanged
 * paragraph partner's effective typography after importing another document.
 * This is a catalog repair, not permission to change a style applied to content.
 * https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.linkedstyle
 */
function normalizeUnusedLinkedCharacterStyles(
  expected: PackageView,
  actual: PackageView,
): void {
  const path = "/word/styles.xml",
    before = definitions(expected.roots.get(path), "style", "styleId"),
    after = definitions(actual.roots.get(path), "style", "styleId"),
    beforeComparison = createWordXmlComparison(expected.doc),
    afterComparison = createWordXmlComparison(actual.doc);
  const unused = (
    v: PackageView,
    style: Element,
    partner: Element,
    id: string,
  ) => {
    const pairedLink = direct(partner, "link");
    for (const node of all(v.doc, "*", "*")) {
      for (const a of Array.from(node.attributes))
        if (
          a.namespaceURI !== XMLNS &&
          a.value === id &&
          !(
            node === style &&
            a.namespaceURI === W &&
            a.localName === "styleId"
          ) &&
          !(
            node === pairedLink &&
            a.namespaceURI === W &&
            a.localName === "val"
          )
        )
          return false;
      // An unknown extension may use element text instead of an attribute to
      // bind a style. Retain that possibility, too.
      if (
        node.namespaceURI !== W &&
        !node.children.length &&
        node.textContent?.trim() === id
      )
        return false;
    }
    return true;
  };
  const inherited = (
    v: PackageView,
    styles: Map<string, Element>,
    start: Element,
    ns: string,
    name: string,
    defaults: boolean,
  ) => {
    const seen = new Set<Element>();
    let style: Element | undefined = start;
    while (style) {
      if (seen.has(style)) return { known: false };
      seen.add(style);
      const values = children(direct(style, "rPr")).filter(
        (e) => e.namespaceURI === ns && e.localName === name,
      );
      if (values.length > 1) return { known: false };
      if (values.length) return { known: true, value: values[0] };
      const base = attr(direct(style, "basedOn"));
      if (base && !styles.has(base)) return { known: false };
      style = styles.get(base);
    }
    const values = defaults
      ? children(direct(all(v.doc, W, "rPrDefault")[0], "rPr")).filter(
          (e) => e.namespaceURI === ns && e.localName === name,
        )
      : [];
    return { known: values.length <= 1, value: values[0] };
  };
  for (const [id, oldStyle] of before) {
    const newStyle = after.get(id),
      partnerId = attr(direct(oldStyle, "link")),
      oldPartner = before.get(partnerId),
      newPartner = after.get(partnerId);
    if (
      !newStyle ||
      !oldPartner ||
      !newPartner ||
      attr(oldStyle, "type") !== "character" ||
      attr(newStyle, "type") !== "character" ||
      attr(oldPartner, "type") !== "paragraph" ||
      attr(newPartner, "type") !== "paragraph" ||
      attr(direct(newStyle, "link")) !== partnerId ||
      attr(direct(oldPartner, "link")) !== id ||
      attr(direct(newPartner, "link")) !== id ||
      !unused(expected, oldStyle, oldPartner, id) ||
      !unused(actual, newStyle, newPartner, id) ||
      beforeComparison.signature(oldPartner, path) !==
        afterComparison.signature(newPartner, path)
    )
      continue;
    for (const [ns, name] of [
      [W, "rFonts"],
      [W, "kern"],
      [W14, "ligatures"],
    ]) {
      const characterValue = inherited(
          expected,
          before,
          oldStyle,
          ns,
          name,
          false,
        ),
        paragraphValue = inherited(
          expected,
          before,
          oldPartner,
          ns,
          name,
          true,
        ),
        observedPartner = inherited(actual, after, newPartner, ns, name, true),
        values = children(direct(newStyle, "rPr")).filter(
          (e) => e.namespaceURI === ns && e.localName === name,
        );
      if (
        !characterValue.known ||
        characterValue.value ||
        !paragraphValue.known ||
        !paragraphValue.value ||
        !observedPartner.known ||
        !observedPartner.value ||
        values.length !== 1
      )
        continue;
      const signature = beforeComparison.signature(paragraphValue.value, path);
      if (
        afterComparison.signature(observedPartner.value, path) === signature &&
        afterComparison.signature(values[0], path) === signature
      )
        values[0].remove();
    }
  }
}

/** Definitions added during native import can remain after restoring a clean
 * document. Keep all expected definitions, defaults and the transitive closure
 * of actual content/style references. Only additional unreachable registrations
 * are optional; changing a referenced style or introducing a default is not. */
function normalizeAddedStyles(
  expected: PackageView,
  actual: PackageView,
): void {
  const path = "/word/styles.xml",
    beforeRoot = expected.roots.get(path),
    afterRoot = actual.roots.get(path);
  if (!beforeRoot || !afterRoot) return;
  const before = definitions(beforeRoot, "style", "styleId"),
    after = definitions(afterRoot, "style", "styleId"),
    required = new Set(before.keys());
  const referenceNames = new Set([
    "pStyle",
    "rStyle",
    "tblStyle",
    "styleLink",
    "numStyleLink",
    "basedOn",
    "next",
    "link",
    "defaultTableStyle",
    "clickAndTypeStyle",
  ]);
  const collect = (root: Element) => {
    for (const element of [root, ...all(root, "*", "*")])
      for (const attribute of Array.from(element.attributes))
        if (
          after.has(attribute.value) &&
          attribute.namespaceURI !== XMLNS &&
          !(
            element.namespaceURI === W &&
            element.localName === "style" &&
            attribute.namespaceURI === W &&
            attribute.localName === "styleId"
          ) &&
          // Known style bindings and unknown exact-ID references both keep the
          // definition; do not assume an extension cannot refer to a style.
          ((element.namespaceURI === W &&
            referenceNames.has(element.localName)) ||
            attribute.namespaceURI !== W)
        )
          required.add(attribute.value);
  };
  for (const [owner, root] of actual.roots) if (owner !== path) collect(root);
  for (const [id, style] of after)
    if (["1", "true", "on"].includes(attr(style, "default"))) required.add(id);
  const visited = new Set<string>();
  for (const id of required) {
    if (visited.has(id)) continue;
    visited.add(id);
    const style = after.get(id);
    if (style) collect(style);
  }
  for (const [id, style] of after) {
    if (required.has(id)) continue;
    // Unknown extensions on an otherwise unused registration stay strict.
    if (
      [style, ...all(style, "*", "*")].some(
        (e) =>
          e.namespaceURI !== W ||
          Array.from(e.attributes).some(
            (a) => a.namespaceURI !== W && a.namespaceURI !== XMLNS,
          ),
      )
    )
      continue;
    const name = attr(direct(style, "name"));
    if (/^heading [1-9]$/i.test(name)) {
      const oldLatent = all(beforeRoot, W, "lsdException").find(
          (e) => attr(e, "name").toLowerCase() === name.toLowerCase(),
        ),
        newLatent = all(afterRoot, W, "lsdException").find(
          (e) => attr(e, "name").toLowerCase() === name.toLowerCase(),
        );
      // Activating an unused built-in heading registers its gallery priority.
      // Formatting, visibility, locking and all other latent properties remain.
      if (
        oldLatent &&
        newLatent &&
        attr(oldLatent, "uiPriority") === "9" &&
        attr(newLatent, "uiPriority") === "0"
      )
        newLatent.setAttributeNS(W, "w:uiPriority", "9");
    }
    style.remove();
  }
}

function removeOptionalPart(v: PackageView, path: string, type: string): void {
  v.parts.get(path)?.remove();
  v.parts.delete(path);
  v.roots.delete(path);
  for (const [relPath, root] of v.roots) {
    if (root.namespaceURI !== REL || root.localName !== "Relationships")
      continue;
    const owner = wordRelationshipOwner(relPath.replace(/^\//, ""));
    for (const rel of children(root))
      if (
        rel.getAttribute("Type") === `${R}/${type}` &&
        `/${wordRelationshipTarget(owner, rel.getAttribute("Target") ?? "")}` ===
          path &&
        Array.from(rel.attributes).every(
          (a) =>
            a.namespaceURI === XMLNS ||
            (a.namespaceURI === null &&
              ["Id", "Type", "Target"].includes(a.localName)),
        )
      )
        rel.remove();
  }
}

/** numId is a list instance, not an allocator-only identity. It stays exact so
 * splitting a continuing list cannot pass. Only newly assigned optional IDs on
 * matching definitions, and extra definitions with no references, may differ. */
function normalizeAddedNumbering(
  expected: PackageView,
  actual: PackageView,
): void {
  const path = "/word/numbering.xml",
    beforeRoot = expected.roots.get(path),
    afterRoot = actual.roots.get(path);
  if (!afterRoot) return;
  const beforeNums = definitions(beforeRoot, "num", "numId"),
    afterNums = definitions(afterRoot, "num", "numId"),
    beforeAbstracts = definitions(beforeRoot, "abstractNum", "abstractNumId"),
    afterAbstracts = definitions(afterRoot, "abstractNum", "abstractNumId"),
    requiredNums = new Set(beforeNums.keys());
  for (const [owner, root] of actual.roots)
    if (owner !== path) {
      for (const reference of all(root, W, "numId"))
        requiredNums.add(attr(reference));
      for (const element of [root, ...all(root, "*", "*")])
        for (const attribute of Array.from(element.attributes))
          if (
            attribute.namespaceURI !== W &&
            attribute.namespaceURI !== XMLNS &&
            element.namespaceURI !==
              "http://schemas.openxmlformats.org/drawingml/2006/main" &&
            element.namespaceURI !==
              "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" &&
            element.namespaceURI !==
              "http://schemas.microsoft.com/office/word/2010/wordprocessingShape" &&
            element.namespaceURI !==
              "http://schemas.openxmlformats.org/officeDocument/2006/math" &&
            afterNums.has(attribute.value)
          )
            requiredNums.add(attribute.value);
    }
  const matchedAbstracts = new Map<Element, Element[]>();
  for (const [id, num] of afterNums) {
    const original = beforeNums.get(id);
    if (original) {
      const durable = num.getAttributeNS(CID, "durableId");
      if (
        !original.hasAttributeNS(CID, "durableId") &&
        durable !== null &&
        /^\d+$/.test(durable) &&
        Number(durable) <= 0xffffffff &&
        [...afterNums.values()].filter(
          (n) => n.getAttributeNS(CID, "durableId") === durable,
        ).length === 1
      )
        num.removeAttributeNS(CID, "durableId");
      const before = beforeAbstracts.get(
          attr(direct(original, "abstractNumId")),
        ),
        after = afterAbstracts.get(attr(direct(num, "abstractNumId")));
      if (before && after)
        matchedAbstracts.set(after, [
          ...(matchedAbstracts.get(after) ?? []),
          before,
        ]);
    }
    if (
      !requiredNums.has(id) &&
      [num, ...all(num, "*", "*")].every(
        (e) =>
          e.namespaceURI === W &&
          Array.from(e.attributes).every(
            (a) =>
              a.namespaceURI === W ||
              a.namespaceURI === XMLNS ||
              (e === num &&
                a.namespaceURI === CID &&
                a.localName === "durableId"),
          ),
      )
    )
      num.remove();
  }
  for (const [definition, originals] of matchedAbstracts) {
    for (const name of ["nsid", "tmpl"]) {
      const value = direct(definition, name);
      if (
        originals.every((o) => !direct(o, name)) &&
        value &&
        !value.children.length &&
        onlyAttributes(value, W, ["val"]) &&
        /^[0-9a-f]{8}$/i.test(attr(value))
      )
        value.remove();
    }
    if (
      originals.every(
        (o) => !o.hasAttributeNS(W15, "restartNumberingAfterBreak"),
      ) &&
      ["0", "false", "off"].includes(
        definition.getAttributeNS(W15, "restartNumberingAfterBreak") ?? "",
      )
    )
      definition.removeAttributeNS(W15, "restartNumberingAfterBreak");
  }
  const requiredAbstracts = new Set(
    children(afterRoot)
      .filter((e) => e.namespaceURI === W && e.localName === "num")
      .map((e) => attr(direct(e, "abstractNumId"))),
  );
  // Preserve old abstract definitions even if unused; their identities may be
  // renumbered by native import, so compare by the resolved complete definition.
  const comparison = createWordXmlComparison(actual.doc),
    originalComparison = createWordXmlComparison(expected.doc);
  const originalSignatures = new Map<string, number>();
  for (const definition of beforeAbstracts.values()) {
    const signature = originalComparison.signature(definition, path);
    originalSignatures.set(
      signature,
      (originalSignatures.get(signature) ?? 0) + 1,
    );
  }
  for (const definition of afterAbstracts.values()) {
    const signature = comparison.signature(definition, path),
      remaining = originalSignatures.get(signature) ?? 0;
    if (remaining > 0) originalSignatures.set(signature, remaining - 1);
    else if (
      !requiredAbstracts.has(attr(definition, "abstractNumId")) &&
      [definition, ...all(definition, "*", "*")].every(
        (e) =>
          e.namespaceURI === W &&
          Array.from(e.attributes).every(
            (a) =>
              a.namespaceURI === W ||
              a.namespaceURI === XMLNS ||
              (e === definition &&
                a.namespaceURI === W15 &&
                a.localName === "restartNumberingAfterBreak"),
          ),
      )
    )
      definition.remove();
  }
  if (
    !beforeRoot &&
    !afterRoot.children.length &&
    Array.from(afterRoot.attributes).every(
      (a) =>
        a.namespaceURI === XMLNS ||
        (a.namespaceURI === MC && a.localName === "Ignorable"),
    )
  )
    removeOptionalPart(actual, path, "numbering");
}

/** A clean document can retain the two standard, unused note separators after
 * native restoration. A note body, anchor, custom separator or settings change
 * must still fail. Existing note parts are always compared in full. */
function normalizeAddedNoteSeparators(
  expected: PackageView,
  actual: PackageView,
): void {
  for (const type of ["footnote", "endnote"]) {
    const path = `/word/${type}s.xml`,
      root = actual.roots.get(path);
    if (
      expected.roots.has(path) ||
      !root ||
      root.namespaceURI !== W ||
      root.localName !== `${type}s` ||
      Array.from(root.attributes).some(
        (a) =>
          a.namespaceURI !== XMLNS &&
          !(a.namespaceURI === MC && a.localName === "Ignorable"),
      ) ||
      all(actual.doc, W, `${type}Reference`).length
    )
      continue;
    const entries = children(root);
    if (
      entries.length !== 2 ||
      new Set(entries.map((e) => attr(e, "id"))).size !== 2 ||
      !entries.every((entry) => {
        const special =
          attr(entry, "id") === "-1"
            ? "separator"
            : attr(entry, "id") === "0"
              ? "continuationSeparator"
              : "";
        const paragraph = direct(entry, "p"),
          properties = direct(paragraph, "pPr"),
          run = direct(paragraph, "r"),
          marker = run?.firstElementChild;
        const plainParagraph =
          paragraph &&
          Array.from(paragraph.attributes).every(
            (a) =>
              a.namespaceURI === XMLNS ||
              (a.namespaceURI === W14 &&
                ["paraId", "textId"].includes(a.localName)) ||
              (a.namespaceURI === W &&
                ["rsidR", "rsidRDefault", "rsidP", "rsidRPr"].includes(
                  a.localName,
                )),
          );
        const spacing = direct(properties, "spacing");
        return (
          special &&
          entry.namespaceURI === W &&
          entry.localName === type &&
          attr(entry, "type") === special &&
          onlyAttributes(entry, W, ["id", "type"]) &&
          entry.children.length === 1 &&
          plainParagraph &&
          paragraph.children.length === (properties ? 2 : 1) &&
          (!properties ||
            (onlyAttributes(properties, W, []) &&
              properties.children.length === 1 &&
              spacing &&
              onlyAttributes(spacing, W, ["after", "line", "lineRule"]) &&
              attr(spacing, "after") === "0" &&
              attr(spacing, "line") === "240" &&
              attr(spacing, "lineRule") === "auto" &&
              !spacing.children.length)) &&
          run &&
          onlyAttributes(run, W, []) &&
          run.children.length === 1 &&
          marker &&
          marker.namespaceURI === W &&
          marker.localName === special &&
          onlyAttributes(marker, W, []) &&
          !marker.children.length &&
          !entry.textContent?.trim()
        );
      })
    )
      continue;
    const settings = direct(
        actual.roots.get("/word/settings.xml"),
        `${type}Pr`,
      ),
      oldSettings = direct(
        expected.roots.get("/word/settings.xml"),
        `${type}Pr`,
      );
    if (
      oldSettings ||
      (settings &&
        (!onlyAttributes(settings, W, []) ||
          settings.children.length !== 2 ||
          new Set(children(settings).map((e) => attr(e, "id"))).size !== 2 ||
          !children(settings).every(
            (e) =>
              e.namespaceURI === W &&
              e.localName === type &&
              onlyAttributes(e, W, ["id"]) &&
              ["-1", "0"].includes(attr(e, "id")) &&
              !e.children.length,
          )))
    )
      continue;
    settings?.remove();
    removeOptionalPart(actual, path, `${type}s`);
  }
}

/** Definition tables are keyed maps. Their XML order is not paragraph/list
 * order. Preserve every definition, instance ID and reference; sort only known
 * distinct keyed entries, leaving other schema children in their positions. */
function normalizeDefinitionOrder(v: PackageView): void {
  const comparison = createWordXmlComparison(v.doc);
  for (const [path, local, key] of [
    ["/word/styles.xml", "style", "styleId"],
    ["/word/fontTable.xml", "font", "name"],
    ["/word/numbering.xml", "num", "numId"],
    ["/word/numbering.xml", "abstractNum", "abstractNumId"],
  ]) {
    const root = v.roots.get(path);
    if (!root) continue;
    const entries = children(root).filter(
      (e) => e.namespaceURI === W && e.localName === local,
    );
    const identities = entries.map((e) => attr(e, key));
    if (
      identities.some((id) => !id) ||
      new Set(identities).size !== identities.length
    )
      throw new Error("Duplicate document definition");
    const sorted = [...entries].sort((a, b) =>
      (local === "abstractNum"
        ? comparison.signature(a, path)
        : attr(a, key)
      ).localeCompare(
        local === "abstractNum" ? comparison.signature(b, path) : attr(b, key),
      ),
    );
    let index = 0;
    root.replaceChildren(
      ...Array.from(root.childNodes).map((node) =>
        node.nodeType === 1 &&
        (node as Element).namespaceURI === W &&
        (node as Element).localName === local
          ? sorted[index++]
          : node,
      ),
    );
  }
}

/** These two optional records store allocation history for future VML IDs.
 * Never discard a shape default with fill, stroke, layout rules or extensions.
 * https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.vml.office.shapeidmap
 */
function normalizeShapeIdBookkeeping(v: PackageView): void {
  const O = "urn:schemas-microsoft-com:office:office",
    V = "urn:schemas-microsoft-com:vml";
  const wrapper = direct(v.roots.get("/word/settings.xml"), "shapeDefaults");
  if (
    !wrapper ||
    !onlyAttributes(wrapper, W, []) ||
    children(wrapper).length !== 2
  )
    return;
  const defaults = children(wrapper).find(
    (e) => e.namespaceURI === O && e.localName === "shapedefaults",
  );
  const layout = children(wrapper).find(
    (e) => e.namespaceURI === O && e.localName === "shapelayout",
  );
  const map = layout?.firstElementChild;
  const permitted = (node: Element, key?: string) =>
    Array.from(node.attributes).every(
      (a) =>
        a.namespaceURI === XMLNS ||
        (a.namespaceURI === V && a.localName === "ext" && a.value === "edit") ||
        (a.namespaceURI === null && a.localName === key),
    );
  if (
    defaults &&
    layout &&
    map &&
    !defaults.children.length &&
    permitted(defaults, "spidmax") &&
    /^\d+$/.test(defaults.getAttribute("spidmax") ?? "") &&
    permitted(layout) &&
    layout.children.length === 1 &&
    map.namespaceURI === O &&
    map.localName === "idmap" &&
    !map.children.length &&
    permitted(map, "data") &&
    /^\d+(?:,\d+)*$/.test(map.getAttribute("data") ?? "")
  )
    wrapper.remove();
}
function isHeader(root: Element | undefined): boolean {
  return root?.namespaceURI === W && ["hdr", "ftr"].includes(root.localName);
}
function isMedia(part: Element | undefined): boolean {
  return (part?.getAttributeNS(PKG, "contentType") ?? "").startsWith("image/");
}

/** Compare the active section/story graph, package definitions and unknown
 * parts. Word may duplicate a header part per section or remove now-unused
 * image/header relationships; each active r:id is still resolved by content. */
function packageSignatures(v: PackageView): Map<string, string> {
  const comparison = createWordXmlComparison(v.doc);
  const result = new Map<string, string>();
  for (const [path, part] of v.parts) {
    const root = v.roots.get(path);
    if (isHeader(root) || isMedia(part) || (root && emptyOptionalPart(root)))
      continue;
    if (root?.namespaceURI === REL && root.localName === "Relationships") {
      const ownerName = wordRelationshipOwner(path.replace(/^\//, ""));
      const owner = ownerName ? `/${ownerName}` : "";
      const ownerRoot = v.roots.get(owner);
      const refs = new Set(
        ownerRoot
          ? [ownerRoot, ...all(ownerRoot, "*", "*")]
              .flatMap((n) => Array.from(n.attributes))
              .filter((a) => a.namespaceURI === R)
              .map((a) => a.value)
          : [],
      );
      const entries = children(root).filter((rel) => {
        const type = rel.getAttribute("Type") ?? "";
        const target = `/${wordRelationshipTarget(ownerName, rel.getAttribute("Target") ?? "")}`;
        const targetRoot = v.roots.get(target);
        if (refs.has(rel.getAttribute("Id") ?? "")) return false; // checked at the referring element, including its type/target bytes
        if (
          ["header", "footer", "image", "hyperlink"].some(
            (t) => type === `${R}/${t}`,
          )
        )
          return false;
        return !(targetRoot && emptyOptionalPart(targetRoot));
      });
      const clone = root.cloneNode(false) as Element;
      for (const rel of entries) {
        const copy = rel.cloneNode(true) as Element;
        // The base comparator resolves Id to target content. Keep that check
        // even for unknown implicit relationships to a binary/media part.
        clone.append(copy);
      }
      if (
        entries.length ||
        Array.from(root.attributes).some((a) => a.namespaceURI !== XMLNS)
      )
        result.set(path, comparison.signature(clone, path));
      continue;
    }
    const content = root
      ? comparison.signature(root, path)
      : (all(part, PKG, "binaryData")[0]?.textContent ?? "").replace(/\s/g, "");
    result.set(
      path,
      (part.getAttributeNS(PKG, "contentType") ?? "") + ":" + content,
    );
  }
  return result;
}

/** This is post-write verification only. Never use it for proposal staleness,
 * Apply/Revert CAS, or ownership checks; their full capture fingerprint stays
 * stricter and includes all original package parts and bindings. */
export function wordFullDocumentComparisonIssue(
  expectedXml: string,
  actualXml: string,
): string | undefined {
  try {
    const expected = view(expectedXml),
      actual = view(actualXml);
    for (const v of [expected, actual]) {
      normalizeWordMediaForComparison(v.doc);
      normalizeWordInlineForComparison(v.doc);
      normalizeAnchorIds(v);
      normalizeMarkerDefaults(v);
      normalizeInheritedFormatting(v);
      normalizeWordTablesForComparison(v.doc);
      normalizeShapeIdBookkeeping(v);
    }
    normalizeNewCommentMetadata(expected, actual);
    normalizeAddedCommentMarkers(expected, actual);
    normalizeAddedFonts(expected, actual);
    normalizeUnusedLinkedCharacterStyles(expected, actual);
    normalizeAddedStyles(expected, actual);
    normalizeAddedNumbering(expected, actual);
    normalizeAddedNoteSeparators(expected, actual);
    normalizeCompatibility(expected);
    normalizeCompatibility(actual);
    normalizeDefinitionOrder(expected);
    normalizeDefinitionOrder(actual);
    const a = packageSignatures(expected),
      b = packageSignatures(actual);
    for (const path of new Set([...a.keys(), ...b.keys()]))
      if (a.get(path) !== b.get(path))
        return `Document content differs in ${path}`;
    return undefined;
  } catch {
    return "Document comparison could not validate the package";
  }
}
export function sameWordFullDocumentContent(
  expectedXml: string,
  actualXml: string,
): boolean {
  return wordFullDocumentComparisonIssue(expectedXml, actualXml) === undefined;
}
