import { afterEach, describe, expect, it, vi } from "vitest";

import nativeSource from "../../../test/fixtures/word-authoring-state/rewrite-source.xml?raw";
import { installWordOoxmlHost } from "../../../test/mocks/word/ooxmlHost";
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
  const host = installWordOoxmlHost(bytes);
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

  it("reports each stage and guards Revert with the fingerprint of the written package", async () => {
    const { host, source, plan } = await sourceAndPlan();
    const stages: string[] = [];
    const result = await applyWordDocumentPlan(
      plan,
      source,
      "message-A",
      undefined,
      (stage) => stages.push(stage),
    );
    expect(result.status, JSON.stringify(result.diagnostic)).toBe("applied");
    expect(stages).toEqual(["checking", "backup", "writing", "verifying"]);
    expect(result.afterFingerprint).toBe(
      (await captureWordDocumentPackage()).fingerprint,
    );
    expect(
      (await revertWordDocumentPlan(result.before!, result.afterFingerprint!))
        .status,
    ).toBe("reverted");
    expect(wordDocumentFileToOoxml(host.get())).not.toContain(
      "Revised test header",
    );
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

  it("names the parts and package counts when Word adds customXml during import", async () => {
    const { host, source, plan } = await sourceAndPlan();
    host.transform((value) => {
      const doc = new DOMParser().parseFromString(
        wordDocumentFileToOoxml(value),
        "application/xml",
      );
      const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
      const part = doc.createElementNS(PKG, "pkg:part");
      part.setAttributeNS(PKG, "pkg:name", "/customXml/item1.xml");
      part.setAttributeNS(PKG, "pkg:contentType", "application/xml");
      const data = doc.createElementNS(PKG, "pkg:xmlData");
      data.append(doc.createElementNS("urn:test", "t:secret-metadata"));
      part.append(data);
      doc.documentElement.append(part);
      return wordDocumentOoxmlToFile(
        new XMLSerializer().serializeToString(doc),
      );
    });
    const result = await applyWordDocumentPlan(plan, source, "message-A");
    expect(result.status).toBe("interrupted");
    const details = result.diagnostic?.details;
    expect(details?.parts).toEqual(["/customXml/item1.xml"]);
    const items = Object.fromEntries(
      details!.packages!.map((p) => [p.label, p.customXmlItems]),
    );
    expect(items).toEqual({ live: 0, expected: 0, actual: 1 });
    expect(JSON.stringify(result.diagnostic)).not.toContain("secret-metadata");
  });

  it("names the changed part when the document changed before Apply", async () => {
    const { bytes, host, source, plan } = await sourceAndPlan();
    host.set(
      wordDocumentOoxmlToFile(
        changeStory(wordDocumentFileToOoxml(bytes), "hdr", "Private header"),
      ),
    );
    const result = await applyWordDocumentPlan(plan, source, "message-A");
    expect(result.status).toBe("stale");
    expect(result.diagnostic?.details?.parts).toEqual([
      expect.stringMatching(/^\/word\/header\d*\.xml$/),
    ]);
    expect(JSON.stringify(result.diagnostic)).not.toContain("Private header");
    expect(host.insert).not.toHaveBeenCalled();
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
    host.setTrackingMode("TrackAll");
    expect(
      (await applyWordDocumentPlan(plan, source, "message-A")).status,
    ).toBe("stale");
    expect(host.document.changeTrackingMode).toBe("TrackAll");
    expect(host.insert).not.toHaveBeenCalled();
  });
});
