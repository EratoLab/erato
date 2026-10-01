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

import type { WordInPlaceOp } from "./wordInPlacePlan";

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

/** Use full-document import to restore out-of-body stories; body insertion cannot restore them. */
export const WORD_DOCUMENT_IMPORT_OPTIONS: Word.InsertFileOptions = {
  importStyles: true,
  importTheme: true,
  importParagraphSpacing: true,
  importPageColor: true,
  importDifferentOddEvenPages: true,
  // Word merges rather than replaces these into the same document, duplicating every customXml
  // item per write until the package exceeds the part limit. Plans never change them.
  importCustomProperties: false,
  importCustomXmlParts: false,
};

/** Office's documented maximum and default; one slice covers every supported DOCX. */
const WORD_FILE_SLICE_BYTES = 4 * 1024 * 1024;

/** Office keeps only two file handles; close ours on every slice/size failure. */
export async function readWordDocumentFile(): Promise<Uint8Array> {
  const document = globalThis.Office?.context?.document;
  if (!document?.getFileAsync)
    throw new Error("This Word host cannot capture the complete document.");
  const file = await new Promise<Office.File>((resolve, reject) => {
    document.getFileAsync(
      Office.FileType.Compressed,
      { sliceSize: WORD_FILE_SLICE_BYTES },
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
      // Bounded as for 64 KB slices, so a host that returns smaller slices is still accepted.
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
  let fingerprint: string | undefined;
  // A full parse and canonicalization; computed only by callers that compare it.
  return {
    bytes,
    ooxml,
    documentUrl,
    get fingerprint() {
      fingerprint ??= createWordXmlComparison(
        parseWordXml(ooxml),
      ).fingerprint();
      return fingerprint;
    },
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

/** An in-place write, recorded in pane memory next to the exact original file so it can be undone
 * paragraph by paragraph without touching later edits elsewhere. */
export type WordInPlaceBackupOp = WordInPlaceOp & {
  /** Session-scoped Paragraph.uniqueLocalId of the written paragraph. */
  id: string;
  originalSignature: string;
  afterSignature?: string;
};
export interface WordInPlaceBackup {
  v: 1;
  ops: WordInPlaceBackupOp[];
}

export function encodeWordDocumentBackup(
  snapshot: WordDocumentPackageSnapshot,
  inPlace?: WordInPlaceBackup,
): string {
  return (
    BACKUP_PREFIX +
    JSON.stringify({
      documentUrl: snapshot.documentUrl,
      base64: wordDocxBase64(snapshot.bytes),
      ...(inPlace ? { inPlace } : {}),
    })
  );
}

/** Same exact original with the in-place record replaced; the original bytes are never re-encoded. */
export function withWordInPlaceBackup(
  backup: string,
  inPlace: WordInPlaceBackup,
): string {
  const data = parseBackup(backup);
  return BACKUP_PREFIX + JSON.stringify({ ...data, inPlace });
}

export function isWordDocumentBackup(value: string): boolean {
  return value.startsWith(BACKUP_PREFIX);
}

function parseBackup(value: string): {
  documentUrl: string;
  base64: string;
  inPlace?: unknown;
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
  return data as { documentUrl: string; base64: string; inPlace?: unknown };
}

const isString = (v: unknown): v is string => typeof v === "string";
const isIndex = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isRuns = (v: unknown) =>
  Array.isArray(v) &&
  v.every(
    (run: Record<string, unknown>) =>
      !!run &&
      typeof run === "object" &&
      isString(run.text) &&
      ["bold", "italic", "underline"].every(
        (mark) => typeof run[mark] === "boolean",
      ),
  );

function parseInPlaceBackup(value: unknown): WordInPlaceBackup | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.v !== 1 || !Array.isArray(record.ops) || !record.ops.length)
    return undefined;
  const valid = record.ops.every((entry: Record<string, unknown>) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !isString(entry.ref) ||
      !isString(entry.id) ||
      !isIndex(entry.paragraph) ||
      !isString(entry.originalSignature) ||
      (entry.afterSignature !== undefined && !isString(entry.afterSignature))
    )
      return false;
    if (entry.kind === "text")
      return isRuns(entry.runs) && isRuns(entry.original);
    return (
      entry.kind === "cell" &&
      isIndex(entry.rowIndex) &&
      isIndex(entry.cellIndex) &&
      isString(entry.text) &&
      isString(entry.original)
    );
  });
  return valid ? (record as unknown as WordInPlaceBackup) : undefined;
}

/** The in-place record without decoding the original file. */
export function decodeWordInPlaceBackup(value: string): {
  documentUrl: string;
  inPlace?: WordInPlaceBackup;
} {
  const data = parseBackup(value);
  const inPlace = parseInPlaceBackup(data.inPlace);
  return { documentUrl: data.documentUrl, ...(inPlace ? { inPlace } : {}) };
}

export function decodeWordDocumentBackup(value: string): {
  documentUrl: string;
  bytes: Uint8Array;
  ooxml: string;
} {
  const data = parseBackup(value);
  const bytes = decodeWordBase64(data.base64);
  return {
    documentUrl: data.documentUrl,
    bytes,
    ooxml: wordDocumentFileToOoxml(bytes),
  };
}
