import * as CFB from "cfb";

export type WordDocumentParts = ReadonlyMap<string, Uint8Array>;
export const MAX_WORD_DOCX_BYTES = 4 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
export const WORD_XML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const WORD_REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const PACKAGE_REL_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES_NS =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const encoder = new TextEncoder();

export function wordPartPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 512 &&
    !/[\\\s\u0000-\u001f?#]/.test(path) &&
    !path.split("/").some((part) => !part || part === "." || part === "..")
  );
}

export function parseWordXml(text: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("XML declarations with entities are not supported.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (!doc.documentElement || doc.getElementsByTagName("parsererror").length)
    throw new Error("The proposed XML is incomplete or malformed.");
  return doc;
}

export function wordXmlText(bytes: Uint8Array): string {
  const utf16 =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  return new TextDecoder(utf16, { fatal: true }).decode(bytes);
}

export function readWordPackage(bytes: Uint8Array): WordDocumentParts {
  if (
    bytes.length > MAX_WORD_DOCX_BYTES ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b
  )
    throw new Error("Word document import supports DOCX files up to 4 MB.");
  inspectZipDirectory(bytes);
  // CFB mutates its input; copy the bytes to preserve the original recovery file.
  const zip = CFB.read(new Uint8Array(bytes), { type: "array" });
  const root = zip.FullPaths[0];
  const parts = new Map<string, Uint8Array>();
  let expanded = 0;
  zip.FileIndex.forEach((entry, index) => {
    if (entry.type !== 2 || entry.name === "\u0001Sh33tJ5") return;
    const path = zip.FullPaths[index].slice(root.length);
    if (!wordPartPath(path) || parts.has(path))
      throw new Error("Invalid or duplicate DOCX part.");
    const data = new Uint8Array(entry.content);
    expanded += data.length;
    if (expanded > MAX_EXPANDED_BYTES || parts.size >= 2048)
      throw new Error(
        "The expanded document is too large to process in this pane.",
      );
    parts.set(path, data);
  });
  validateWordPackage(parts);
  return parts;
}

export function writeWordPackage(parts: WordDocumentParts): Uint8Array {
  validateWordPackage(parts);
  const zip = CFB.utils.cfb_new();
  for (const [path, data] of parts)
    CFB.utils.cfb_add(zip, path, new Uint8Array(data));
  const bytes = new Uint8Array(
    CFB.write(zip, {
      type: "array",
      fileType: "zip",
      compression: true,
    }) as number[],
  );
  if (bytes.length > MAX_WORD_DOCX_BYTES)
    throw new Error("The proposed document exceeds Word's 4 MB import limit.");
  return bytes;
}

/** Bound inflation before the ZIP library allocates, and reject duplicate names. */
function inspectZipDirectory(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    view.getUint32(end, true) !== 0x06054b50
  )
    end--;
  if (
    end < 0 ||
    end < bytes.length - 65557 ||
    end + 22 + view.getUint16(end + 20, true) !== bytes.length
  )
    throw new Error("Invalid DOCX ZIP directory.");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true),
    expanded = 0;
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    count > 2048 ||
    cursor + view.getUint32(end + 12, true) !== end
  )
    throw new Error("Unsupported DOCX ZIP directory.");
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error("Incomplete DOCX ZIP directory.");
    const length = view.getUint16(cursor + 28, true);
    const next =
      cursor +
      46 +
      length +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true);
    if (next > end || view.getUint16(cursor + 8, true) & 1)
      throw new Error("Encrypted or invalid DOCX part.");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(cursor + 46, cursor + 46 + length),
    );
    if (!wordPartPath(name.replace(/\/$/, "")) || names.has(name))
      throw new Error("Invalid or duplicate DOCX part.");
    names.add(name);
    expanded += view.getUint32(cursor + 24, true);
    if (expanded > MAX_EXPANDED_BYTES)
      throw new Error("The expanded document is too large.");
    cursor = next;
  }
  if (cursor !== end) throw new Error("Invalid DOCX directory size.");
}

export function wordContentTypes(
  parts: WordDocumentParts,
): Map<string, string> {
  const bytes = parts.get("[Content_Types].xml");
  if (!bytes) throw new Error("The DOCX content types are missing.");
  const root = parseWordXml(wordXmlText(bytes)).documentElement;
  if (root.namespaceURI !== CONTENT_TYPES_NS || root.localName !== "Types")
    throw new Error("Invalid DOCX content types.");
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const element of Array.from(root.children)) {
    const type = element.getAttribute("ContentType");
    const name = element.getAttribute(
      element.localName === "Default" ? "Extension" : "PartName",
    );
    const map = element.localName === "Default" ? defaults : overrides;
    if (
      element.namespaceURI !== CONTENT_TYPES_NS ||
      !["Default", "Override"].includes(element.localName) ||
      !name ||
      !type ||
      map.has(name)
    )
      throw new Error("Invalid or duplicate content type.");
    if (
      element.localName === "Override" &&
      (!name.startsWith("/") || !parts.has(name.slice(1)))
    )
      throw new Error("A content type refers to a missing part.");
    map.set(name, type);
  }
  return new Map(
    Array.from(parts.keys(), (path) => {
      const type =
        path === "[Content_Types].xml"
          ? "application/xml"
          : (overrides.get(`/${path}`) ??
            defaults.get(path.split(".").pop() ?? ""));
      if (!type) throw new Error(`Missing content type: ${path}`);
      return [path, type];
    }),
  );
}

export function isWordXmlPart(
  path: string,
  types: ReadonlyMap<string, string>,
): boolean {
  const type = types.get(path) ?? "";
  return (
    /(?:\+xml|\/xml)$/.test(type) ||
    type.endsWith(".vmlDrawing") ||
    path.endsWith(".rels")
  );
}

export function wordRelationshipOwner(path: string): string {
  if (path === "_rels/.rels") return "";
  const match = /^(.*\/)?_rels\/([^/]+)\.rels$/.exec(path);
  if (!match) throw new Error("Invalid relationship part path.");
  return `${match[1] ?? ""}${match[2]}`;
}

export function wordRelationshipTarget(owner: string, target: string): string {
  const result = target.startsWith("/") ? [] : owner.split("/").slice(0, -1);
  for (const segment of target.replace(/^\//, "").split("/")) {
    if (segment === "..") {
      if (!result.length) throw new Error("A relationship leaves the package.");
      result.pop();
    } else if (segment && segment !== ".") result.push(segment);
  }
  return result.join("/");
}

export function validateWordPackage(parts: WordDocumentParts): void {
  for (const path of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
  ])
    if (!parts.has(path))
      throw new Error(`Missing required DOCX part: ${path}`);
  const types = wordContentTypes(parts);
  const trees = new Map<string, Document>();
  let expanded = 0;
  for (const [path, data] of parts) {
    if (!wordPartPath(path)) throw new Error("Invalid DOCX part path.");
    expanded += data.length;
    if (isWordXmlPart(path, types))
      trees.set(path, parseWordXml(wordXmlText(data)));
  }
  if (expanded > MAX_EXPANDED_BYTES || parts.size > 2048)
    throw new Error("The expanded document is too large.");
  const main = trees.get("word/document.xml")?.documentElement;
  if (
    main?.namespaceURI !== WORD_XML_NS ||
    main.localName !== "document" ||
    Array.from(main.children).filter(
      (e) => e.namespaceURI === WORD_XML_NS && e.localName === "body",
    ).length !== 1
  )
    throw new Error("The main Word document must contain one body.");
  const relationships = new Map<string, Set<string>>();
  let hasMainRelationship = false;
  for (const [path, tree] of trees) {
    if (!path.endsWith(".rels")) continue;
    const owner = wordRelationshipOwner(path);
    if (owner && !parts.has(owner))
      throw new Error("Relationship owner is missing.");
    const ids = new Set<string>();
    relationships.set(owner, ids);
    if (
      tree.documentElement.namespaceURI !== PACKAGE_REL_NS ||
      tree.documentElement.localName !== "Relationships"
    )
      throw new Error("Invalid relationship document.");
    for (const rel of Array.from(tree.documentElement.children)) {
      const id = rel.getAttribute("Id"),
        target = rel.getAttribute("Target"),
        type = rel.getAttribute("Type");
      if (
        rel.namespaceURI !== PACKAGE_REL_NS ||
        rel.localName !== "Relationship" ||
        !id ||
        !target ||
        !type ||
        ids.has(id)
      )
        throw new Error("Invalid or duplicate relationship.");
      ids.add(id);
      if (rel.getAttribute("TargetMode") !== "External") {
        const resolved = wordRelationshipTarget(owner, target);
        if (!parts.has(resolved))
          throw new Error(`Missing relationship target: ${resolved}`);
        if (
          !owner &&
          type === `${WORD_REL_NS}/officeDocument` &&
          resolved === "word/document.xml"
        )
          hasMainRelationship = true;
      }
    }
  }
  if (!hasMainRelationship)
    throw new Error("The package does not identify its main document.");
  for (const [path, tree] of trees)
    for (const element of Array.from(tree.getElementsByTagName("*")))
      for (const attribute of Array.from(element.attributes))
        if (
          attribute.namespaceURI === WORD_REL_NS &&
          ["id", "embed", "link"].includes(attribute.localName) &&
          !relationships.get(path)?.has(attribute.value)
        )
          throw new Error(`Unresolved relationship in ${path}.`);
}

export function encodeWordXml(xml: string): Uint8Array {
  parseWordXml(xml);
  // Compiler strings are JavaScript Unicode. Do not retain a stale UTF-16 declaration.
  return encoder.encode(
    xml.replace(/(<\?xml[^?]*encoding\s*=\s*["'])[^"']+(["'])/i, "$1UTF-8$2"),
  );
}

export function wordDocxBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
