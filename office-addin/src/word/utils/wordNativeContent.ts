import {
  effectiveWordMediaChildren,
  isWordMediaElementActive,
} from "./wordMediaComparison";
import { createWordXmlComparison } from "./wordXmlComparison";

/** Native islands and package checks for structural authoring. No model XML. */
export const WORD_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const W = WORD_NS;
const direct = (e: Element | undefined, local: string) =>
  Array.from(e?.children ?? []).find(
    (n) => n.namespaceURI === W && n.localName === local,
  );
const descendants = (e: Element, name: string) =>
  Array.from(e.getElementsByTagNameNS(W, name));
const withSelf = (e: Element) =>
  [e, ...Array.from(e.getElementsByTagName("*"))].filter(
    isWordMediaElementActive,
  );
export const wordMainBody = (doc: Document): Element | undefined => {
  const part = Array.from(doc.getElementsByTagNameNS(PKG, "part")).find(
    (e) => e.getAttributeNS(PKG, "name") === "/word/document.xml",
  );
  if (!part && doc.getElementsByTagNameNS(PKG, "part").length) return undefined;
  return (part ?? doc).getElementsByTagNameNS(W, "body")[0];
};

/** A range crossing paragraphs/tables is one native island. Splitting it would
 * detach bookmarks, comments or field instructions from the text they describe. */
export function nativeBodyGroups(body: Element): {
  groups: Element[][];
  issues: string[];
} {
  const nodes = Array.from(body.children).filter(
    (e) => !(e.namespaceURI === W && e.localName === "sectPr"),
  );
  const ends = nodes.map((_, i) => i);
  const ranges = new Map<string, number>();
  const comments = new Map<string, number[]>();
  const fields: number[] = [];
  const issues = new Set<string>();
  const sections = Array.from(body.children).filter(
    (e) => e.namespaceURI === W && e.localName === "sectPr",
  );
  if (
    sections.length > 1 ||
    (sections.length === 1 && sections[0] !== body.lastElementChild)
  )
    issues.add("invalid-section-boundaries");
  for (const [i, node] of nodes.entries()) {
    for (const e of withSelf(node)) {
      if (e.namespaceURI !== W) continue;
      const name = e.localName;
      if (
        ["commentRangeStart", "commentRangeEnd", "commentReference"].includes(
          name,
        )
      ) {
        const id = e.getAttributeNS(W, "id") ?? "";
        comments.set(id, [...(comments.get(id) ?? []), i]);
      }
      // These pairs use an ID, including ranges introduced by newer Word builds.
      if (
        name === "bookmarkStart" ||
        name === "permStart" ||
        name.endsWith("RangeStart")
      ) {
        const key = `${name.replace(/Start$/, "")}:${e.getAttributeNS(W, "id")}`;
        if (ranges.has(key)) issues.add("unbalanced-anchors");
        ranges.set(key, i);
      } else if (
        name === "bookmarkEnd" ||
        name === "permEnd" ||
        name.endsWith("RangeEnd")
      ) {
        const key = `${name.replace(/End$/, "")}:${e.getAttributeNS(W, "id")}`;
        const start = ranges.get(key);
        if (start === undefined) issues.add("unbalanced-anchors");
        else {
          ends[start] = Math.max(ends[start], i);
          ranges.delete(key);
        }
      }
      if (name === "fldChar") {
        const kind = e.getAttributeNS(W, "fldCharType");
        if (kind === "begin") fields.push(i);
        if (kind === "end") {
          const start = fields.pop();
          if (start === undefined) issues.add("unbalanced-fields");
          else ends[start] = Math.max(ends[start], i);
        }
      }
      if (name === "altChunk") issues.add("unreadable-imported-content");
      // Replacing the body would touch a locked control even when retained.
      if (name === "lock" && e.getAttributeNS(W, "val") !== "unlocked")
        issues.add("locked-content-control");
    }
  }
  if (ranges.size) issues.add("unbalanced-anchors");
  if (fields.length) issues.add("unbalanced-fields");
  for (const positions of comments.values()) {
    const first = Math.min(...positions),
      last = Math.max(...positions);
    ends[first] = Math.max(ends[first], last);
  }
  const groups: Element[][] = [];
  for (let start = 0; start < nodes.length; ) {
    let end = ends[start];
    for (let i = start; i <= end; i++) end = Math.max(end, ends[i]);
    groups.push(nodes.slice(start, end + 1));
    start = end + 1;
  }
  return { groups, issues: [...issues] };
}

/** Human-readable source only; hidden/deleted text, field code and binary data
 * stay on the host. Paragraph/cell boundaries remain visible in table context. */
export function nativeVisibleText(root: Element): string {
  const visit = (e: Element): string => {
    if (e.namespaceURI === W) {
      if (
        [
          "del",
          "moveFrom",
          "instrText",
          "delInstrText",
          "rPr",
          "pPr",
          "sdtPr",
        ].includes(e.localName)
      )
        return "";
      if (
        e.localName === "r" &&
        ["vanish", "webHidden"].some((name) =>
          descendants(e, name).some(
            (n) =>
              !["0", "false", "off"].includes(n.getAttributeNS(W, "val") ?? ""),
          ),
        )
      )
        return "";
      if (e.localName === "t") return e.textContent ?? "";
      if (e.localName === "tab") return "\t";
      if (["br", "cr"].includes(e.localName)) return "\n";
    }
    const value = effectiveWordMediaChildren(e).map(visit).join("");
    if (e.namespaceURI === W && e.localName === "tc")
      return value.replace(/\n$/, "") + "\t";
    if (e.namespaceURI === W && e.localName === "tr")
      return value.replace(/\t$/, "") + "\n";
    return value + (e.namespaceURI === W && e.localName === "p" ? "\n" : "");
  };
  return visit(root).replace(/\n$/, "");
}

export function nativeDescription(nodes: Element[]): string {
  return nodes
    .flatMap((n) =>
      withSelf(n).flatMap((e) => {
        if (
          e.namespaceURI ===
            "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" &&
          e.localName === "docPr"
        )
          return [
            e.getAttribute("descr") ||
              e.getAttribute("title") ||
              e.getAttribute("name") ||
              "",
          ];
        if (e.namespaceURI === W && e.localName === "alias")
          return [e.getAttributeNS(W, "val") ?? ""];
        return [];
      }),
    )
    .filter(Boolean)
    .join("; ");
}

function parts(doc: Document): Map<string, Element> {
  return new Map(
    Array.from(doc.getElementsByTagNameNS(PKG, "part")).map((p) => [
      p.getAttributeNS(PKG, "name") ?? "",
      p,
    ]),
  );
}
function targetPath(owner: string, target: string): string {
  const result: string[] = [];
  for (const segment of (target.startsWith("/")
    ? target
    : owner.slice(0, owner.lastIndexOf("/") + 1) + target
  ).split("/")) {
    if (segment === "..") result.pop();
    else if (segment && segment !== ".") result.push(segment);
  }
  return "/" + result.join("/");
}
function relationships(owner: string, packageParts: Map<string, Element>) {
  const at = owner.lastIndexOf("/");
  const path =
    owner.slice(0, at + 1) + "_rels/" + owner.slice(at + 1) + ".rels";
  const part = packageParts.get(path);
  return new Map(
    Array.from(part?.getElementsByTagNameNS(REL, "Relationship") ?? []).map(
      (e) => [e.getAttribute("Id") ?? "", e],
    ),
  );
}
export function missingWordRelationships(doc: Document): boolean {
  const packageParts = parts(doc);
  for (const [path, part] of packageParts) {
    if (path.endsWith(".rels")) continue;
    const rels = relationships(path, packageParts);
    for (const e of Array.from(part.getElementsByTagName("*"))) {
      for (const a of Array.from(e.attributes)) {
        if (a.namespaceURI !== R) continue;
        const rel = rels.get(a.value);
        if (
          !rel ||
          (rel.getAttribute("TargetMode") !== "External" &&
            !packageParts.has(
              targetPath(path, rel.getAttribute("Target") ?? ""),
            ))
        )
          return true;
      }
    }
  }
  const body = wordMainBody(doc);
  if (body) {
    for (const [reference, name, path] of [
      ["footnoteReference", "footnote", "/word/footnotes.xml"],
      ["endnoteReference", "endnote", "/word/endnotes.xml"],
      ["commentReference", "comment", "/word/comments.xml"],
    ]) {
      const ids = new Set(
        Array.from(
          packageParts.get(path)?.getElementsByTagNameNS(W, name) ?? [],
        ).map((e) => e.getAttributeNS(W, "id")),
      );
      if (
        descendants(body, reference).some(
          (e) => !ids.has(e.getAttributeNS(W, "id")),
        )
      )
        return true;
    }
    for (const binding of descendants(body, "dataBinding")) {
      const store = binding.getAttributeNS(W, "storeItemID")?.toLowerCase();
      if (
        !store ||
        !Array.from(
          doc.getElementsByTagNameNS(
            "http://schemas.openxmlformats.org/officeDocument/2006/customXml",
            "datastoreItem",
          ),
        ).some((e) =>
          Array.from(e.attributes).some(
            (a) => a.localName === "itemID" && a.value.toLowerCase() === store,
          ),
        )
      )
        return true;
    }
  }
  return false;
}

/** Content identity resolves relationship IDs through the package. Word can
 * rename rIds/media files without changing the object; lost bytes or a changed
 * external link must still fail verification. */
export function createNativeContentSignature(
  packageXml: string,
): (value: string, owner?: string) => string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(packageXml, "application/xml");
  const comparison = createWordXmlComparison(doc);
  return (value, owner = "/word/document.xml") => {
    const fragment = parser.parseFromString(value, "application/xml");
    if (fragment.getElementsByTagName("parsererror").length)
      throw new Error("Invalid retained Word content");
    normalizeRedundantTableMargins(fragment, doc);
    return comparison.signature(fragment.documentElement, owner);
  };
}

export function nativeContentSignature(
  value: string,
  packageXml: string,
  owner = "/word/document.xml",
): string {
  return createNativeContentSignature(packageXml)(value, owner);
}

export function preservedWordStories(doc: Document): string[] {
  const paths = [...parts(doc).keys()];
  return ["header", "footer", "footnotes", "endnotes", "comments"].filter(
    (kind) =>
      paths.some((p) => new RegExp(`^/word/${kind}[^/]*\\.xml$`).test(p)),
  );
}

/** Verify all out-of-body stories, including unreferenced headers and notes.
 * Styles/numbering are checked separately since the compiler can extend them. */
export function sameWordPreservedParts(before: string, after: string): boolean {
  const parse = (v: string) =>
    new DOMParser().parseFromString(v, "application/xml");
  const a = parse(before),
    b = parse(after);
  const beforeSignature = createNativeContentSignature(before);
  const afterSignature = createNativeContentSignature(after);
  // Existing definitions must survive. New heading styles/list definitions may
  // be added, so equality of the entire styles/numbering part is inappropriate.
  for (const [local, key] of [
    ["style", "styleId"],
    ["num", "numId"],
    ["font", "name"],
  ]) {
    const actual = new Map(
      Array.from(b.getElementsByTagNameNS(W, local)).map((e) => [
        e.getAttributeNS(W, key),
        e,
      ]),
    );
    for (const original of Array.from(a.getElementsByTagNameNS(W, local))) {
      const retained = actual.get(original.getAttributeNS(W, key));
      if (
        !retained ||
        beforeSignature(new XMLSerializer().serializeToString(original)) !==
          afterSignature(new XMLSerializer().serializeToString(retained))
      )
        return false;
    }
  }
  // Word renumbers abstract definitions on import. Compare retained definition
  // content with multiplicity; each num reference above still resolves to its
  // own definition and retains the list-instance identity.
  const definitions = new Map<string, number>();
  for (const element of Array.from(
    b.getElementsByTagNameNS(W, "abstractNum"),
  )) {
    const key = afterSignature(new XMLSerializer().serializeToString(element));
    definitions.set(key, (definitions.get(key) ?? 0) + 1);
  }
  for (const element of Array.from(
    a.getElementsByTagNameNS(W, "abstractNum"),
  )) {
    const key = beforeSignature(new XMLSerializer().serializeToString(element));
    const remaining = definitions.get(key) ?? 0;
    if (!remaining) return false;
    definitions.set(key, remaining - 1);
  }
  const signature = (doc: Document, original: string) =>
    [...parts(doc)]
      .filter(
        ([p]) =>
          /^\/word\/(header[^/]*|footer[^/]*|footnotes|endnotes|comments[^/]*|theme\/[^/]+)\.xml$/.test(
            p,
          ) || /^\/customXml\/.*\.xml$/.test(p),
      )
      .map(([path, part]) => {
        const root = part.getElementsByTagNameNS(PKG, "xmlData")[0]
          ?.firstElementChild;
        return root
          ? nativeContentSignature(
              new XMLSerializer().serializeToString(root),
              original,
              path,
            )
          : "";
      })
      .sort();
  if (
    JSON.stringify(signature(a, before)) !== JSON.stringify(signature(b, after))
  )
    return false;
  const section = (doc: Document, original: string) =>
    Array.from(wordMainBody(doc)?.children ?? [])
      .filter((e) => e.namespaceURI === W && e.localName === "sectPr")
      .map((e) =>
        nativeContentSignature(
          new XMLSerializer().serializeToString(e),
          original,
        ),
      );
  return (
    JSON.stringify(section(a, before)) === JSON.stringify(section(b, after))
  );
}

/** Word removes row margin exceptions equal to the inherited table/style
 * margin. Normalize only proven redundant top/bottom exceptions; never ignore
 * a changed margin, style or conditional table-style override. */
function normalizeRedundantTableMargins(
  fragment: Document,
  packageDoc: Document,
): void {
  const styles = Array.from(packageDoc.getElementsByTagNameNS(W, "style"));
  const byId = new Map(styles.map((s) => [s.getAttributeNS(W, "styleId"), s]));
  for (const table of Array.from(fragment.getElementsByTagNameNS(W, "tbl"))) {
    const props = direct(table, "tblPr");
    const styleId = direct(props, "tblStyle")?.getAttributeNS(W, "val");
    const tableStyle = styleId
      ? byId.get(styleId)
      : styles.find(
          (s) =>
            s.getAttributeNS(W, "type") === "table" &&
            s.getAttributeNS(W, "default") === "1",
        );
    const margin = (side: string): Element | undefined => {
      const own = direct(direct(props, "tblCellMar"), side);
      if (own) return own;
      const visited = new Set<Element>();
      let style = tableStyle;
      while (style && !visited.has(style)) {
        visited.add(style);
        if (
          descendants(style, "tblStylePr").some((p) =>
            descendants(p, "tblCellMar").some((m) => direct(m, side)),
          )
        )
          return undefined;
        const inherited = direct(
          direct(direct(style, "tblPr"), "tblCellMar"),
          side,
        );
        if (inherited) return inherited;
        style = byId.get(
          direct(style, "basedOn")?.getAttributeNS(W, "val") ?? "",
        );
      }
      return undefined;
    };
    for (const row of Array.from(table.children).filter(
      (e) => e.namespaceURI === W && e.localName === "tr",
    )) {
      const exceptions = direct(row, "tblPrEx");
      const margins = direct(exceptions, "tblCellMar");
      for (const side of ["top", "bottom"]) {
        const actual = direct(margins, side),
          inherited = margin(side);
        if (
          actual &&
          inherited &&
          actual.getAttributeNS(W, "type") === "dxa" &&
          inherited.getAttributeNS(W, "type") === "dxa" &&
          actual.getAttributeNS(W, "w") === inherited.getAttributeNS(W, "w") &&
          Array.from(actual.attributes).every(
            (a) =>
              a.namespaceURI === "http://www.w3.org/2000/xmlns/" ||
              (a.namespaceURI === W && ["w", "type"].includes(a.localName)),
          )
        )
          actual.remove();
      }
      if (margins && !margins.children.length && !margins.attributes.length)
        margins.remove();
      if (
        exceptions &&
        !exceptions.children.length &&
        !exceptions.attributes.length
      )
        exceptions.remove();
    }
  }
}
