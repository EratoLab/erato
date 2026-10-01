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

import type { WordInPlaceOp, WordInPlaceStoryTarget } from "./wordInPlacePlan";

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

/** One change of an in-place write, recorded in pane memory next to the exact original file so it
 * can be undone without touching later edits elsewhere. */
export type WordInPlaceBackupOp = WordInPlaceOp & {
  /** Session-scoped Paragraph.uniqueLocalId of the written or deleted paragraph, or of the inserted
   * one once Word created it. */
  id?: string;
  /** Paragraph.getOoxml signature before the write; none for an inserted paragraph. */
  originalSignature?: string;
  /** Signature after the write; none for a deleted paragraph. */
  afterSignature?: string;
  /** ID of a paragraph that stays in the list this one leaves, so Restore can rejoin it. */
  listAnchor?: string;
};
/** Touched paragraphs between two untouched ones (null at the start or end of the body). Restore
 * puts the region back exactly as `before` was, whatever the write left inside it. */
export interface WordInPlaceRegion {
  /** A header or footer paragraph: start and end are null and `before` holds that one op. */
  story?: WordInPlaceStoryTarget;
  start: string | null;
  end: string | null;
  /** Ops whose paragraphs filled the region before the write, in document order. */
  before: number[];
  /** IDs of the paragraphs inside the region after the write, in document order, once known. */
  after?: string[];
}
export interface WordInPlaceBackup {
  v: 1;
  ops: WordInPlaceBackupOp[];
  regions: WordInPlaceRegion[];
  /** The write did not verify, but every difference lies in the rewritten paragraphs: when later
   * edits keep the exact restore from running, undoing those paragraphs is still complete. */
  scopedFallback?: true;
  /** Written as tracked revisions: Restore rejects them instead of rewriting the paragraphs. */
  tracked?: true;
  /** Per paragraph ID inside a touched region, its tracked changes as [type, text] after the write.
   * Restore rejects only while they are exactly these, so it never undoes a reviewer's decision. */
  revisions?: Record<string, [string, string][]>;
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

const isMarks = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  ["bold", "italic", "underline"].every(
    (mark) => typeof (v as Record<string, unknown>)[mark] === "boolean",
  );
const isRuns = (v: unknown) =>
  Array.isArray(v) &&
  v.every((run: unknown) => isMarks(run) && isString(run.text));
const isState = (v: unknown) => {
  if (!v || typeof v !== "object") return false;
  const state = v as Record<string, unknown>;
  const style = state.style as Record<string, unknown> | undefined;
  return (
    ["paragraph", "heading", "list-item"].includes(String(state.type)) &&
    (state.level === undefined || isIndex(state.level)) &&
    [state.styleRef, state.list, state.listRef].every(
      (value) => value === undefined || isString(value),
    ) &&
    (state.ordered === undefined || typeof state.ordered === "boolean") &&
    !!style &&
    typeof style === "object" &&
    (isString(style.builtIn) || isString(style.name))
  );
};
const isOptional = (v: unknown) => v === undefined || isString(v);
const isStory = (v: unknown) => {
  if (v === undefined) return true;
  if (!v || typeof v !== "object") return false;
  const story = v as Record<string, unknown>;
  return (
    ["header", "footer"].includes(String(story.kind)) &&
    isString(story.part) &&
    isIndex(story.section) &&
    ["Primary", "FirstPage", "EvenPages"].includes(String(story.type))
  );
};

function parseInPlaceOp(entry: Record<string, unknown>): boolean {
  if (
    !entry ||
    typeof entry !== "object" ||
    !isString(entry.ref) ||
    !isIndex(entry.paragraph) ||
    !isOptional(entry.id) ||
    !isOptional(entry.originalSignature) ||
    !isOptional(entry.afterSignature) ||
    !isOptional(entry.listAnchor)
  )
    return false;
  switch (entry.kind) {
    case "text":
      return (
        isRuns(entry.runs) &&
        isRuns(entry.original) &&
        isString(entry.id) &&
        isString(entry.originalSignature) &&
        isStory(entry.story) &&
        (entry.story === undefined || entry.restyle === undefined) &&
        (entry.restyle === undefined ||
          (!!entry.restyle &&
            typeof entry.restyle === "object" &&
            isState((entry.restyle as Record<string, unknown>).from) &&
            isState((entry.restyle as Record<string, unknown>).to)))
      );
    case "cell":
      return (
        isString(entry.id) &&
        isString(entry.originalSignature) &&
        isIndex(entry.rowIndex) &&
        isIndex(entry.cellIndex) &&
        isString(entry.text) &&
        isString(entry.original)
      );
    case "insert":
      return (
        ["After", "Before"].includes(String(entry.location)) &&
        isString(entry.block) &&
        isRuns(entry.runs) &&
        isState(entry.state) &&
        entry.originalSignature === undefined
      );
    case "delete":
      return (
        ["After", "Before"].includes(String(entry.recreate)) &&
        isRuns(entry.original) &&
        isState(entry.state) &&
        isString(entry.id) &&
        isString(entry.originalSignature)
      );
    default:
      return false;
  }
}

function parseInPlaceBackup(value: unknown): WordInPlaceBackup | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.v !== 1 ||
    !Array.isArray(record.ops) ||
    !record.ops.length ||
    !Array.isArray(record.regions) ||
    !record.regions.length ||
    (record.scopedFallback !== undefined && record.scopedFallback !== true) ||
    (record.tracked !== undefined && record.tracked !== true) ||
    (record.revisions !== undefined &&
      (!record.revisions ||
        typeof record.revisions !== "object" ||
        Array.isArray(record.revisions) ||
        !Object.values(record.revisions as Record<string, unknown>).every(
          (list) =>
            Array.isArray(list) &&
            list.every(
              (entry: unknown) =>
                Array.isArray(entry) &&
                entry.length === 2 &&
                entry.every(isString),
            ),
        )))
  )
    return undefined;
  const ops = record.ops as Record<string, unknown>[];
  const valid =
    ops.every(parseInPlaceOp) &&
    (record.regions as Record<string, unknown>[]).every(
      (region) =>
        !!region &&
        typeof region === "object" &&
        [region.start, region.end].every((id) => id === null || isString(id)) &&
        isStory(region.story) &&
        (region.story === undefined ||
          (region.start === null &&
            region.end === null &&
            Array.isArray(region.before) &&
            region.before.length === 1)) &&
        Array.isArray(region.before) &&
        region.before.every(
          (index: unknown) => isIndex(index) && index < ops.length,
        ) &&
        (region.after === undefined ||
          (Array.isArray(region.after) && region.after.every(isString))),
    );
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
