import { vi } from "vitest";

import {
  wordDocumentFileToOoxml,
  wordDocumentOoxmlToFile,
} from "../../../word/utils/wordDocumentPackage";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
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
}

type When = "now" | "after-capture" | "after-import";

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
    current = wordDocumentOoxmlToFile(serialize(doc));
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
    current = new Uint8Array(bytes);
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
    },
  };
  const context = {
    document,
    sync: vi.fn(async () => {
      events.push("sync");
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
      current = decorateWrite(
        merged(pending.bytes, current, pending.options, settings, nsid),
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
    run: async (callback: (context: Word.RequestContext) => Promise<unknown>) =>
      callback(context as unknown as Word.RequestContext),
  });
  const at = (when: When, apply: () => void) => {
    if (when === "now") apply();
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
    resume: () => {
      faultAfterWrite = undefined;
      faultBeforeWrite = false;
      faultLockId = undefined;
      changeUrlOnFailure = undefined;
      cannotRead = false;
      failingReads.clear();
    },
    transform: (value: (bytes: Uint8Array) => Uint8Array) => {
      decorateWrite = value;
    },
    clearNativeUndo: () => events.push("native-undo-cleared"),
  };
}

export type WordOoxmlHost = ReturnType<typeof installWordOoxmlHost>;
