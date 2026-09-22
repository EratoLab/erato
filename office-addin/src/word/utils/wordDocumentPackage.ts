import {
  MAX_WORD_DOCX_BYTES,
  encodeWordXml,
  isWordXmlPart,
  parseWordXml,
  readWordPackage,
  validateWordPackage,
  wordContentTypes,
  wordDocxBase64,
  wordPartPath,
  wordXmlText,
  writeWordPackage,
} from "./wordDocumentPackageCodec";
import { createWordXmlComparison } from "./wordXmlComparison";

const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const BACKUP_PREFIX = "erato-word-document-backup-v1:";

export interface WordDocumentPackageSnapshot {
  /** Host-only original file, retained independently of the native Undo stack. */
  bytes: Uint8Array;
  ooxml: string;
  documentUrl: string;
  fingerprint: string;
}

export function currentWordDocumentUrl(): string {
  return globalThis.Office?.context?.document?.url ?? "";
}

export function supportsWordDocumentPackage(): boolean {
  const office = globalThis.Office;
  return !!(
    typeof office?.context?.document?.getFileAsync === "function" &&
    office.context.requirements?.isSetSupported("WordApi", "1.7")
  );
}

/**
 * Document-level import includes headers, footers and section properties. The
 * Body import API does not. WordApi 1.7 also preserves odd/even header settings.
 */
export const WORD_DOCUMENT_IMPORT_OPTIONS: Word.InsertFileOptions = {
  importStyles: true,
  importTheme: true,
  importParagraphSpacing: true,
  importPageColor: true,
  importDifferentOddEvenPages: true,
  importCustomProperties: true,
  importCustomXmlParts: true,
};

/** Office keeps only two file handles; close ours on every slice/size failure. */
export async function readWordDocumentFile(): Promise<Uint8Array> {
  const document = globalThis.Office?.context?.document;
  if (!document?.getFileAsync)
    throw new Error("This Word host cannot capture the complete document.");
  const file = await new Promise<Office.File>((resolve, reject) => {
    document.getFileAsync(
      Office.FileType.Compressed,
      { sliceSize: 64 * 1024 },
      (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded)
          resolve(result.value);
        else
          reject(
            new Error(
              "Word could not capture the document. Check any Grant Access prompt in Word.",
            ),
          );
      },
    );
  });
  try {
    if (
      !Number.isSafeInteger(file.size) ||
      file.size <= 0 ||
      file.size > MAX_WORD_DOCX_BYTES ||
      !Number.isSafeInteger(file.sliceCount) ||
      file.sliceCount <= 0 ||
      file.sliceCount > Math.ceil(MAX_WORD_DOCX_BYTES / 65536)
    )
      throw new Error("Full-document editing supports DOCX files up to 4 MB.");
    const output = new Uint8Array(file.size);
    let offset = 0;
    for (let i = 0; i < file.sliceCount; i++) {
      const slice = await new Promise<Office.Slice>((resolve, reject) => {
        file.getSliceAsync(i, (result) => {
          if (result.status === Office.AsyncResultStatus.Succeeded)
            resolve(result.value);
          else reject(new Error("Word could not read a document slice."));
        });
      });
      const data = new Uint8Array(slice.data as number[]);
      if (
        slice.index !== i ||
        data.length !== slice.size ||
        offset + data.length > output.length
      )
        throw new Error("Word returned an incomplete document snapshot.");
      output.set(data, offset);
      offset += data.length;
    }
    if (offset !== output.length)
      throw new Error("Word returned an incomplete document snapshot.");
    return output;
  } finally {
    await new Promise<void>((resolve) => file.closeAsync(() => resolve()));
  }
}

/** Flat OPC is an internal compiler representation, never a model contract. */
export function wordDocumentFileToOoxml(bytes: Uint8Array): string {
  const parts = readWordPackage(bytes);
  const types = wordContentTypes(parts);
  const document = documentWithRoot(PKG, "pkg:package");
  const root = document.documentElement;
  for (const [path, data] of parts) {
    if (path === "[Content_Types].xml") continue;
    const part = document.createElementNS(PKG, "pkg:part");
    part.setAttributeNS(PKG, "pkg:name", `/${path}`);
    part.setAttributeNS(PKG, "pkg:contentType", types.get(path)!);
    const isXml = isWordXmlPart(path, types);
    const payload = document.createElementNS(
      PKG,
      isXml ? "pkg:xmlData" : "pkg:binaryData",
    );
    if (isXml)
      payload.append(
        document.importNode(
          parseWordXml(wordXmlText(data)).documentElement,
          true,
        ),
      );
    else payload.textContent = wordDocxBase64(data);
    part.append(payload);
    root.append(part);
  }
  return new XMLSerializer().serializeToString(document);
}

export function wordDocumentOoxmlToFile(ooxml: string): Uint8Array {
  const document = parseWordXml(ooxml);
  if (
    document.documentElement.namespaceURI !== PKG ||
    document.documentElement.localName !== "package"
  )
    throw new Error("A complete document package is required.");
  const parts = new Map<string, Uint8Array>();
  const types = documentWithRoot(CT, "Types");
  for (const part of Array.from(document.documentElement.children)) {
    const path = part.getAttributeNS(PKG, "name")?.replace(/^\//, "");
    const contentType = part.getAttributeNS(PKG, "contentType");
    if (
      part.namespaceURI !== PKG ||
      part.localName !== "part" ||
      !wordPartPath(path) ||
      parts.has(path) ||
      path === "[Content_Types].xml" ||
      !contentType ||
      part.children.length !== 1
    )
      throw new Error("Invalid document package part.");
    const payload = part.firstElementChild!;
    if (payload.namespaceURI !== PKG)
      throw new Error("Invalid document package payload.");
    let data: Uint8Array;
    if (payload.localName === "xmlData" && payload.children.length === 1)
      data = encodeWordXml(
        new XMLSerializer().serializeToString(payload.firstElementChild!),
      );
    else if (payload.localName === "binaryData" && !payload.children.length)
      data = decodeWordBase64(payload.textContent ?? "");
    else throw new Error("Invalid document package payload.");
    parts.set(path, data);
    const override = types.createElementNS(CT, "Override");
    override.setAttribute("PartName", `/${path}`);
    override.setAttribute("ContentType", contentType);
    types.documentElement.append(override);
  }
  parts.set(
    "[Content_Types].xml",
    encodeWordXml(new XMLSerializer().serializeToString(types)),
  );
  validateWordPackage(parts);
  return writeWordPackage(parts);
}

function documentWithRoot(namespace: string, name: string): Document {
  return globalThis.document.implementation.createDocument(namespace, name);
}

function decodeWordBase64(value: string): Uint8Array {
  const source = value.replace(/\s/g, "");
  if (
    source.length > 90 * 1024 * 1024 ||
    source.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(source)
  )
    throw new Error("Invalid document binary content.");
  const decoded = atob(source);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export async function captureWordDocumentPackage(): Promise<WordDocumentPackageSnapshot> {
  const documentUrl = currentWordDocumentUrl();
  const bytes = await readWordDocumentFile();
  if (currentWordDocumentUrl() !== documentUrl)
    throw new Error("The open document changed during capture.");
  const ooxml = wordDocumentFileToOoxml(bytes);
  return {
    bytes,
    ooxml,
    documentUrl,
    fingerprint: createWordXmlComparison(parseWordXml(ooxml)).fingerprint(),
  };
}

/** Queue once; callers own preflight, backup, sync, and semantic verification. */
export function insertWordDocumentFile(
  context: Word.RequestContext,
  bytes: Uint8Array,
): void {
  readWordPackage(bytes);
  context.document.insertFileFromBase64(
    wordDocxBase64(bytes),
    "Replace",
    WORD_DOCUMENT_IMPORT_OPTIONS,
  );
}

/** Keep the existing string backup API without losing the complete original. */
export function encodeWordDocumentBackup(
  snapshot: WordDocumentPackageSnapshot,
): string {
  return (
    BACKUP_PREFIX +
    JSON.stringify({
      documentUrl: snapshot.documentUrl,
      base64: wordDocxBase64(snapshot.bytes),
    })
  );
}

export function isWordDocumentBackup(value: string): boolean {
  return value.startsWith(BACKUP_PREFIX);
}

export function decodeWordDocumentBackup(value: string): {
  documentUrl: string;
  bytes: Uint8Array;
  ooxml: string;
} {
  if (!isWordDocumentBackup(value))
    throw new Error("Invalid complete-document backup.");
  const data: unknown = JSON.parse(value.slice(BACKUP_PREFIX.length));
  if (
    !data ||
    typeof data !== "object" ||
    !("documentUrl" in data) ||
    typeof data.documentUrl !== "string" ||
    !("base64" in data) ||
    typeof data.base64 !== "string"
  )
    throw new Error("Invalid complete-document backup.");
  const bytes = decodeWordBase64(data.base64);
  return {
    documentUrl: data.documentUrl,
    bytes,
    ooxml: wordDocumentFileToOoxml(bytes),
  };
}
