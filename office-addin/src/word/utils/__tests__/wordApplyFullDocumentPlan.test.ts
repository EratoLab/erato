import { afterEach, describe, expect, it, vi } from "vitest";

import nativeSource from "../../../test/fixtures/word-authoring-state/rewrite-source.xml?raw";
import {
  applyWordDocumentPlan,
  revertWordDocumentPlan,
} from "../wordApplyDocumentPlan";
import {
  captureWordDocumentPackage,
  decodeWordDocumentBackup,
  wordDocumentFileToOoxml,
  wordDocumentOoxmlToFile,
} from "../wordDocumentPackage";
import { wordDocxBase64 } from "../wordDocumentPackageCodec";
import { wordSourceReadRefs } from "../wordDocumentPlan";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
  wordDocumentFingerprint,
} from "../wordDocumentXml";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "../wordDocumentPlan";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const decode = (base64: string) =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
function changeStory(xml: string, kind: "hdr" | "ftr", text: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.getElementsByTagNameNS(W, kind)[0];
  if (!root) throw new Error("The native fixture has no matching story.");
  let textNode = root.getElementsByTagNameNS(W, "t")[0];
  if (!textNode) {
    const paragraph = doc.createElementNS(W, "w:p"),
      run = doc.createElementNS(W, "w:r");
    textNode = doc.createElementNS(W, "w:t");
    run.append(textNode);
    paragraph.append(run);
    root.append(paragraph);
  }
  textNode.textContent = text;
  return new XMLSerializer().serializeToString(doc);
}

function fullWord(original: Uint8Array) {
  let current: Uint8Array = new Uint8Array(original);
  let pending: Uint8Array | undefined;
  let faultAfterWrite = false;
  let faultBeforeWrite = false;
  let faultLockId: number | undefined;
  let changeUrlOnFailure: string | undefined;
  let cannotRead = false;
  let decorateWrite = (bytes: Uint8Array) => bytes;
  const events: string[] = [];
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
  const child = (parent: Element, name: string) =>
    Array.from(parent.children).find(
      (e) => e.namespaceURI === W && e.localName === name,
    );
  const controlId = (node: Element) => {
    const props = child(node, "sdtPr");
    const id = props && child(props, "id")?.getAttributeNS(W, "val");
    return id === null || id === undefined ? undefined : Number(id);
  };
  const loadControls = () => {
    const doc = new DOMParser().parseFromString(
      wordDocumentFileToOoxml(current),
      "application/xml",
    );
    controls = new Map(
      Array.from(doc.getElementsByTagNameNS(W, "sdt")).flatMap((node) => {
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
    const doc = new DOMParser().parseFromString(
      wordDocumentFileToOoxml(current),
      "application/xml",
    );
    for (const node of doc.getElementsByTagNameNS(W, "sdt")) {
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
    current = wordDocumentOoxmlToFile(
      new XMLSerializer().serializeToString(doc),
    );
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
  loadControls();
  const close = vi.fn((callback: () => void) => callback());
  const insert = vi.fn((base64: string) => {
    events.push("queue-import");
    pending = decode(base64);
  });
  const bodyInsert = vi.fn(() => {
    throw new Error("A complete document must not use a body-only mutation.");
  });
  const officeDocument = {
    url: "file:///disposable-rich-document.docx",
    getFileAsync: vi.fn(
      (
        _type: unknown,
        _options: unknown,
        callback: (result: unknown) => void,
      ) => {
        events.push("capture-file");
        if (cannotRead) {
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
      },
    ),
  };
  const document = {
    changeTrackingMode: "Off",
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
      current = decorateWrite(pending);
      pending = undefined;
      loadControls();
      events.push("native-import-completed");
      if (faultAfterWrite)
        throw Object.assign(new Error("private content must not escape"), {
          code: "GeneralException",
          debugInfo: {
            errorLocation: "Document.insertFileFromBase64",
            statement: "private content must not escape",
          },
        });
    }),
  };
  vi.stubGlobal("Office", {
    context: {
      document: officeDocument,
      requirements: { isSetSupported: () => true },
    },
    FileType: { Compressed: "compressed" },
    AsyncResultStatus: { Succeeded: "succeeded" },
  });
  vi.stubGlobal("Word", {
    run: async (callback: (context: Word.RequestContext) => Promise<unknown>) =>
      callback(context as unknown as Word.RequestContext),
  });
  return {
    insert,
    bodyInsert,
    close,
    document,
    officeDocument,
    context,
    events,
    get: () => current,
    set: (bytes: Uint8Array) => {
      current = new Uint8Array(bytes);
      loadControls();
    },
    controls: () => [...controls.values()].map((control) => ({ ...control })),
    failImport: (newUrl?: string) => {
      faultBeforeWrite = true;
      changeUrlOnFailure = newUrl;
    },
    failUnlock: (id: number) => {
      faultLockId = id;
    },
    failAfterWrite: () => {
      faultAfterWrite = true;
    },
    failRead: () => {
      cannotRead = true;
    },
    resume: () => {
      faultAfterWrite = false;
      faultBeforeWrite = false;
      faultLockId = undefined;
      changeUrlOnFailure = undefined;
      cannotRead = false;
    },
    transform: (value: (bytes: Uint8Array) => Uint8Array) => {
      decorateWrite = value;
    },
    clearNativeUndo: () => events.push("native-undo-cleared"),
  };
}

async function sourceAndPlan(options: { lockedControls?: boolean } = {}) {
  // jsdom reuses a w14 alias across sibling paragraphs without declaring it.
  // Bind it on each native part; namespace aliases do not change content identity.
  const fixture = new DOMParser().parseFromString(
    nativeSource,
    "application/xml",
  );
  if (options.lockedControls) {
    const body = fixture.getElementsByTagNameNS(W, "body")[0];
    const nativeControl = new DOMParser().parseFromString(
      `<w:sdt xmlns:w="${W}"><w:sdtPr><w:id w:val="30001"/><w:alias w:val="Locked parent"/><w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Outer retained text</w:t></w:r></w:p><w:sdt><w:sdtPr><w:id w:val="30002"/><w:alias w:val="Locked child"/><w:lock w:val="sdtLocked"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Inner retained text</w:t></w:r></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`,
      "application/xml",
    ).documentElement;
    body.insertBefore(
      fixture.importNode(nativeControl, true),
      Array.from(body.children).find((e) => e.localName === "sectPr") ?? null,
    );
  }
  for (const payload of fixture.getElementsByTagNameNS(
    "http://schemas.microsoft.com/office/2006/xmlPackage",
    "xmlData",
  ))
    payload.firstElementChild?.setAttributeNS(
      "http://www.w3.org/2000/xmlns/",
      "xmlns:ns1",
      "http://schemas.microsoft.com/office/word/2010/wordml",
    );
  const bytes = wordDocumentOoxmlToFile(
    new XMLSerializer().serializeToString(fixture),
  );
  const host = fullWord(bytes);
  const file = await captureWordDocumentPackage();
  const source: WordAuthoringSnapshot = captureWordAuthoringSnapshot(
    file.ooxml,
    "doc-A",
    "Off",
    true,
  );
  source.documentUrl = file.documentUrl;
  source.read = new Set(wordSourceReadRefs(source));
  source.readToken = "read-proof";
  source.ownerMessageId = "message-A";
  expect(source.issue).toBeUndefined();
  const header = source.stories!.find((s) => s.type === "header")!;
  const plan: WordDocumentPlan = {
    version: 1,
    snapshot: source.token,
    readToken: "read-proof",
    scope: "document",
    entries: [{ kind: "keep", source: source.blocks.map((b) => b.ref) }],
    deleted: [],
    stories: [
      {
        kind: "upsert",
        type: "header",
        id: header.id,
        blocks: [
          { id: "header-new", type: "paragraph", text: "Revised test header" },
        ],
      },
    ],
  };
  const compiled = compileWordDocumentPlan(plan, source);
  const prepared = captureWordAuthoringSnapshot(compiled, "doc-A", "Off", true);
  expect(prepared.issue).toBeUndefined();
  expect(verifyWordPlanOutput(plan, source, prepared)).toBe(true);
  return { bytes, host, source, plan: JSON.stringify(plan) };
}

afterEach(() => vi.unstubAllGlobals());

// Each integration case imports, verifies, and restores several real DOCX archives.
describe("complete-document writer", { timeout: 15_000 }, () => {
  it("retains the exact locked original before unlocking and preserves requested locks through Apply and Revert", async () => {
    const { bytes, host, source, plan } = await sourceAndPlan({
      lockedControls: true,
    });
    const originalLocks = host.controls();
    const save = vi.fn((backup: string) => {
      host.events.push("locked-backup-saved");
      expect(decodeWordDocumentBackup(backup).bytes).toEqual(bytes);
      expect(host.controls()).toEqual(originalLocks);
      expect(host.events.some((e) => e.startsWith("queue-lock:"))).toBe(false);
    });
    const result = await applyWordDocumentPlan(plan, source, "message-A", save);
    expect(result.status, JSON.stringify(result.diagnostic)).toBe("applied");
    expect(save).toHaveBeenCalledOnce();
    expect(host.events.indexOf("locked-backup-saved")).toBeLessThan(
      host.events.findIndex((e) => e.startsWith("queue-lock:")),
    );
    expect(host.controls()).toEqual(originalLocks);
    expect(host.events.filter((e) => e.startsWith("native-lock:"))).toEqual([
      "native-lock:30001:cannotEdit=false",
      "native-lock:30001:cannotDelete=false",
      "native-lock:30002:cannotDelete=false",
    ]);
    host.events.length = 0;
    host.clearNativeUndo();
    const reverted = await revertWordDocumentPlan(
      result.before!,
      result.afterFingerprint!,
    );
    expect(reverted.status, JSON.stringify(reverted.diagnostic)).toBe(
      "reverted",
    );
    expect(host.controls()).toEqual(originalLocks);
    expect(host.insert.mock.calls[1][0]).toBe(wordDocxBase64(bytes));
    expect(host.events.filter((e) => e.startsWith("native-lock:"))).toEqual([
      "native-lock:30001:cannotEdit=false",
      "native-lock:30001:cannotDelete=false",
      "native-lock:30002:cannotDelete=false",
    ]);
  });

  it("restores an already-unlocked outer control when unlocking a child fails before import", async () => {
    const { bytes, host, source, plan } = await sourceAndPlan({
      lockedControls: true,
    });
    const originalLocks = host.controls();
    host.failUnlock(30002);
    const result = await applyWordDocumentPlan(plan, source, "message-A");
    expect(result.status).toBe("interrupted");
    expect(decodeWordDocumentBackup(result.before!).bytes).toEqual(bytes);
    expect(host.insert).not.toHaveBeenCalled();
    expect(host.controls()).toEqual(originalLocks);
    expect(result.afterFingerprint).toBe(source.fingerprint);
    expect(host.events.filter((e) => e.startsWith("native-lock:"))).toEqual([
      "native-lock:30001:cannotEdit=false",
      "native-lock:30001:cannotDelete=false",
      "native-lock:30001:cannotDelete=true",
      "native-lock:30001:cannotEdit=true",
    ]);
  });

  it("relocks surviving nested IDs after a rejected document import and still retains the complete backup", async () => {
    const { bytes, host, source, plan } = await sourceAndPlan({
      lockedControls: true,
    });
    const originalLocks = host.controls();
    host.failImport();
    const result = await applyWordDocumentPlan(plan, source, "message-A");
    expect(result.status).toBe("interrupted");
    expect(result.diagnostic).toMatchObject({
      stage: "write",
      officeCode: "GeneralException",
    });
    expect(decodeWordDocumentBackup(result.before!).bytes).toEqual(bytes);
    expect(host.controls()).toEqual(originalLocks);
    expect(result.afterFingerprint).toBe(source.fingerprint);
    expect(host.insert).toHaveBeenCalledOnce();
    expect(
      host.events.filter((e) => e.startsWith("native-lock:")).slice(-3),
    ).toEqual([
      "native-lock:30002:cannotDelete=true",
      "native-lock:30001:cannotDelete=true",
      "native-lock:30001:cannotEdit=true",
    ]);
  });

  it("does not relock matching control IDs in a different document after an import error", async () => {
    const { bytes, host, source, plan } = await sourceAndPlan({
      lockedControls: true,
    });
    host.failImport("file:///different-document.docx");
    const result = await applyWordDocumentPlan(plan, source, "message-A");
    expect(result.status).toBe("interrupted");
    expect(decodeWordDocumentBackup(result.before!).bytes).toEqual(bytes);
    expect(result.afterFingerprint).toBeUndefined();
    expect(
      host.events.some(
        (e) => e.startsWith("queue-lock:") && e.endsWith("=true"),
      ),
    ).toBe(false);
  });

  it("does not put old locks back after a completed import that fails output verification", async () => {
    const { bytes, host, source, plan } = await sourceAndPlan({
      lockedControls: true,
    });
    host.transform((value) => {
      const doc = new DOMParser().parseFromString(
        wordDocumentFileToOoxml(value),
        "application/xml",
      );
      for (const lock of Array.from(doc.getElementsByTagNameNS(W, "lock")))
        lock.remove();
      return wordDocumentOoxmlToFile(
        new XMLSerializer().serializeToString(doc),
      );
    });
    const result = await applyWordDocumentPlan(plan, source, "message-A");
    expect(result.status).toBe("interrupted");
    expect(result.diagnostic).toMatchObject({
      stage: "verify",
      reason: "output-mismatch",
    });
    expect(decodeWordDocumentBackup(result.before!).bytes).toEqual(bytes);
    expect(
      host
        .controls()
        .every((control) => !control.cannotEdit && !control.cannotDelete),
    ).toBe(true);
    expect(
      host.events.some(
        (e) => e.startsWith("queue-lock:") && e.endsWith("=true"),
      ),
    ).toBe(false);
  });

  it("does not unlock anything when the caller cannot retain the original backup", async () => {
    const { host, source, plan } = await sourceAndPlan({
      lockedControls: true,
    });
    const originalLocks = host.controls();
    const result = await applyWordDocumentPlan(
      plan,
      source,
      "message-A",
      () => {
        throw new Error("Cannot retain backup");
      },
    );
    expect(result.status).toBe("blocked");
    expect(host.controls()).toEqual(originalLocks);
    expect(host.events.some((e) => e.startsWith("queue-lock:"))).toBe(false);
    expect(host.insert).not.toHaveBeenCalled();
  });

  it("saves the complete original before one document import and never calls Body.insertOoxml", async () => {
    const { bytes, host, source, plan } = await sourceAndPlan();
    const backup = vi.fn((value: string) => {
      host.events.push("backup-saved");
      expect(host.insert).not.toHaveBeenCalled();
      expect(decodeWordDocumentBackup(value).bytes).toEqual(bytes);
    });
    const result = await applyWordDocumentPlan(
      plan,
      source,
      "message-A",
      backup,
    );
    expect(result.status, JSON.stringify(result.diagnostic)).toBe("applied");
    expect(backup).toHaveBeenCalledOnce();
    expect(host.events.indexOf("backup-saved")).toBeLessThan(
      host.events.indexOf("queue-import"),
    );
    expect(host.insert).toHaveBeenCalledOnce();
    expect(host.bodyInsert).not.toHaveBeenCalled();
    expect(result.afterFingerprint).toBeTruthy();
    expect(wordDocumentFileToOoxml(host.get())).toContain(
      "Revised test header",
    );
    expect(
      (await applyWordDocumentPlan(plan, source, "message-A")).status,
    ).toBe("blocked");
    expect(host.insert).toHaveBeenCalledOnce();
  });

  it.each(["hdr", "ftr"] as const)(
    "detects a %s-only change before Apply and performs zero writes",
    async (kind) => {
      const { host, source, plan } = await sourceAndPlan();
      host.set(
        wordDocumentOoxmlToFile(
          changeStory(source.ooxml, kind, "User changed this story"),
        ),
      );
      const result = await applyWordDocumentPlan(plan, source, "message-A");
      expect(result.status).toBe("stale");
      expect(host.insert).not.toHaveBeenCalled();
      expect(host.bodyInsert).not.toHaveBeenCalled();
      expect(source.used).toBe(false);
    },
  );

  it.each(["hdr", "ftr"] as const)(
    "preserves a later %s-only edit when Revert is requested",
    async (kind) => {
      const { host, source, plan } = await sourceAndPlan();
      const applied = await applyWordDocumentPlan(plan, source, "message-A");
      expect(applied.status).toBe("applied");
      host.set(
        wordDocumentOoxmlToFile(
          changeStory(
            wordDocumentFileToOoxml(host.get()),
            kind,
            "Keep this later edit",
          ),
        ),
      );
      const writes = host.insert.mock.calls.length;
      expect(
        (
          await revertWordDocumentPlan(
            applied.before!,
            applied.afterFingerprint!,
          )
        ).status,
      ).toBe("stale");
      expect(host.insert).toHaveBeenCalledTimes(writes);
    },
  );

  it("refuses an identical document at a different source URL", async () => {
    const { host, source, plan } = await sourceAndPlan();
    host.officeDocument.url = "file:///another-document.docx";
    expect(
      (await applyWordDocumentPlan(plan, source, "message-A")).status,
    ).toBe("stale");
    expect(host.insert).not.toHaveBeenCalled();
  });

  it("refuses a changed URL immediately before the mutation", async () => {
    const { host, source, plan } = await sourceAndPlan();
    const sync = host.context.sync.getMockImplementation()!;
    host.context.sync.mockImplementationOnce(async () => {
      await sync();
      host.officeDocument.url = "file:///another-document.docx";
    });
    expect(
      (await applyWordDocumentPlan(plan, source, "message-A")).status,
    ).toBe("stale");
    expect(host.insert).not.toHaveBeenCalled();
  });

  it("binds Revert to the source document URL even if another file has identical content", async () => {
    const { host, source, plan } = await sourceAndPlan();
    const applied = await applyWordDocumentPlan(plan, source, "message-A");
    expect(applied.status).toBe("applied");
    host.officeDocument.url = "file:///identical-other-document.docx";
    expect(
      (await revertWordDocumentPlan(applied.before!, applied.afterFingerprint!))
        .status,
    ).toBe("stale");
    expect(host.insert).toHaveBeenCalledOnce();
  });

  it("does not certify a post-write capture from a different document URL", async () => {
    const { host, source, plan } = await sourceAndPlan();
    host.transform((bytes) => {
      host.officeDocument.url = "file:///another-document.docx";
      return bytes;
    });
    const result = await applyWordDocumentPlan(plan, source, "message-A");
    expect(result.status).toBe("interrupted");
    expect(result.before).toBeTruthy();
    expect(host.insert).toHaveBeenCalledOnce();
  });

  it("keeps the complete backup when post-write capture is unavailable", async () => {
    const { bytes, host, source, plan } = await sourceAndPlan();
    host.transform((value) => {
      host.failRead();
      return value;
    });
    const result = await applyWordDocumentPlan(plan, source, "message-A");
    expect(result.status).toBe("interrupted");
    expect(decodeWordDocumentBackup(result.before!).bytes).toEqual(bytes);
    expect(result.afterFingerprint).toBeUndefined();
    expect(host.insert).toHaveBeenCalledOnce();
  });

  it("keeps the original after an exception reported following native import, then restores without Undo", async () => {
    const { bytes, host, source, plan } = await sourceAndPlan();
    host.failAfterWrite();
    const backup = vi.fn();
    const result = await applyWordDocumentPlan(
      plan,
      source,
      "message-A",
      backup,
    );
    expect(result.status).toBe("interrupted");
    expect(result.diagnostic).toMatchObject({
      stage: "write",
      reason: "host-error",
      officeCode: "GeneralException",
      officeLocation: "Document.insertFileFromBase64",
    });
    expect(JSON.stringify(result)).not.toContain(
      "private content must not escape",
    );
    expect(result.before).toBe(backup.mock.calls[0][0]);
    expect(decodeWordDocumentBackup(result.before!).bytes).toEqual(bytes);
    expect(result.afterFingerprint).toBe(
      wordDocumentFingerprint(wordDocumentFileToOoxml(host.get())),
    );
    expect(host.insert).toHaveBeenCalledOnce();
    host.resume();
    host.clearNativeUndo();
    expect(
      (await revertWordDocumentPlan(result.before!, result.afterFingerprint!))
        .status,
    ).toBe("reverted");
    expect(host.insert).toHaveBeenCalledTimes(2);
    expect(host.insert.mock.calls[1][0]).toBe(wordDocxBase64(bytes));
    expect(host.bodyInsert).not.toHaveBeenCalled();
  });

  it("accepts native revision-session metadata normalization without losing recovery", async () => {
    const { bytes, host, source, plan } = await sourceAndPlan();
    host.transform((value) =>
      wordDocumentOoxmlToFile(
        wordDocumentFileToOoxml(value).replaceAll(
          /w:rsidR="[0-9A-F]+"/g,
          'w:rsidR="ABCDEF01"',
        ),
      ),
    );
    const result = await applyWordDocumentPlan(plan, source, "message-A");
    expect(result.status).toBe("applied");
    host.clearNativeUndo();
    expect(
      (await revertWordDocumentPlan(result.before!, result.afterFingerprint!))
        .status,
    ).toBe("reverted");
    expect(decodeWordDocumentBackup(result.before!).bytes).toEqual(bytes);
  });

  it("never changes Track Changes to make an import pass", async () => {
    const { host, source, plan } = await sourceAndPlan();
    host.document.changeTrackingMode = "TrackAll";
    expect(
      (await applyWordDocumentPlan(plan, source, "message-A")).status,
    ).toBe("stale");
    expect(host.document.changeTrackingMode).toBe("TrackAll");
    expect(host.insert).not.toHaveBeenCalled();
  });
});
