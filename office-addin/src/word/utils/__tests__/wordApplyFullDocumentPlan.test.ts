import { wordSourceReadRefs } from "@erato/frontend/word-review";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import nativeSource from "../../../test/fixtures/word-authoring-state/rewrite-source.xml?raw";
import {
  allowWordWebImport,
  setWordInPlace,
  setWordWebImport,
} from "../../../test/mocks/word/applyPolicy";
import { installWordOoxmlHost } from "../../../test/mocks/word/ooxmlHost";
import {
  captureRealisticSnapshot,
  realisticWordPackageXml,
  statusRewritePlan,
} from "../../../test/mocks/word/realisticWordFixtures";
import { renderWordDiagnosticReport } from "../wordApplyDiagnostics";
import {
  applyWordDocumentPlan,
  revertWordDocumentPlan,
} from "../wordApplyDocumentPlan";
import {
  captureWordDocumentPackage,
  decodeWordDocumentBackup,
  insertWordDocumentFile,
  wordDocumentFileToOoxml,
  wordDocumentOoxmlToFile,
  wordPackageFingerprint,
} from "../wordDocumentPackage";
import { wordDocxBase64 } from "../wordDocumentPackageCodec";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
} from "../wordDocumentXml";

import type { WordOoxmlHostOptions } from "../../../test/mocks/word/ooxmlHost";
import type * as wordDocumentPackageModule from "../wordDocumentPackage";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "@erato/frontend/word-review";

vi.mock("../wordDocumentPackage", async (importOriginal) => {
  const actual = await importOriginal<typeof wordDocumentPackageModule>();
  return {
    ...actual,
    insertWordDocumentFile: vi.fn(actual.insertWordDocumentFile),
  };
});

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
  beforeEach(allowWordWebImport);
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

  const closingTable = (id: string) => ({
    id,
    type: "table",
    text: "",
    columns: [110, 180, 110],
    format: {
      alignment: "center",
      cellMargins: { top: 3, left: 6, right: 6, bottom: 3 },
      borders: {
        insideH: { color: "FFFFFF", style: "single", width: 1 },
        insideV: { color: "FFFFFF", style: "single", width: 1 },
      },
    },
    rows: [
      ["Category", "Random example", "Sample value"],
      ["Nature", "Sunflower in a garden", "24 °C"],
    ].map((texts, r) => ({
      ...(r === 0 ? { format: { repeatHeader: true } } : {}),
      cells: texts.map((text, c) => ({
        format: { shading: r === 0 ? "245A81" : "DCEEFF" },
        blocks: [{ id: `${id}-${r}-${c}`, type: "paragraph", text }],
      })),
    })),
  });
  const tail = (root: Element | undefined) =>
    Array.from(root?.children ?? [])
      .map((e) => e.localName)
      .slice(-3);

  it("verifies a table that ends the document after Word adds the closing paragraph", async () => {
    const { host, source } = await sourceAndPlan();
    const plan = {
      version: 1,
      snapshot: source.token,
      readToken: "read-proof",
      scope: "document",
      entries: [
        { kind: "keep", source: source.blocks.map((b) => b.ref) },
        {
          kind: "insert",
          contextRefs: [source.blocks.at(-1)!.ref],
          blocks: [closingTable("examples")],
        },
      ],
      deleted: [],
    };
    const result = await applyWordDocumentPlan(
      JSON.stringify(plan),
      source,
      "message-A",
      vi.fn(),
    );
    expect(result.status, JSON.stringify(result.diagnostic)).toBe("applied");
    expect(host.insert).toHaveBeenCalledOnce();
    const written = new DOMParser().parseFromString(
      wordDocumentFileToOoxml(host.get()),
      "application/xml",
    );
    expect(tail(written.getElementsByTagNameNS(W, "body")[0])).toEqual([
      "tbl",
      "p",
      "sectPr",
    ]);
  });

  it("verifies a header that ends with a table after Word adds the closing paragraph", async () => {
    const { host, source } = await sourceAndPlan();
    const header = source.stories!.find((s) => s.type === "header")!;
    const plan = {
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
          blocks: [closingTable("header-table")],
        },
      ],
    };
    const result = await applyWordDocumentPlan(
      JSON.stringify(plan),
      source,
      "message-A",
      vi.fn(),
    );
    expect(result.status, JSON.stringify(result.diagnostic)).toBe("applied");
    const written = new DOMParser().parseFromString(
      wordDocumentFileToOoxml(host.get()),
      "application/xml",
    );
    const headerRoot = Array.from(
      written.getElementsByTagNameNS(W, "hdr"),
    ).find((root) => root.getElementsByTagNameNS(W, "tbl").length);
    expect(tail(headerRoot).slice(-2)).toEqual(["tbl", "p"]);
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
      wordPackageFingerprint(wordDocumentFileToOoxml(host.get())),
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

describe(
  "whole-document writes on Word for the web",
  { timeout: 30_000 },
  () => {
    beforeEach(() => setWordWebImport("confirm"));
    const context = {
      chatId: "chat-A",
      messageId: "message-A",
      toolCallId: "read",
    };
    const imports = vi.mocked(insertWordDocumentFile);
    const report = (
      result: Awaited<ReturnType<typeof applyWordDocumentPlan>>,
    ) => renderWordDiagnosticReport("apply", result.status, result.diagnostic);
    const mutations = (events: string[]) =>
      events.filter((e) => e.startsWith("mutation:"));
    const sectionChange = (snapshot: WordAuthoringSnapshot) =>
      JSON.stringify({
        ...statusRewritePlan(snapshot, "Status: revised."),
        sections: [
          {
            id: "final",
            source: "section-1",
            layout: { orientation: "landscape" },
          },
        ],
      } satisfies WordDocumentPlan);
    const confirmed = { importConfirmed: true };
    async function realistic(options: WordOoxmlHostOptions = {}) {
      const host = installWordOoxmlHost(realisticWordPackageXml(), options);
      const snapshot = await captureRealisticSnapshot();
      return { host, snapshot };
    }
    /** Reads `request` as a scoped read and submits `edit` under its token, as the model would. */
    async function scopedPlan(
      snapshot: WordAuthoringSnapshot,
      request: Record<string, unknown>,
      edit: (result: Record<string, unknown>) => Record<string, unknown>,
    ): Promise<string> {
      const session = new WordDocumentReadSession();
      session.activate(snapshot, context);
      const read = await session.execute(
        {
          snapshot: snapshot.token,
          documentIdentity: snapshot.identity,
          ...request,
        },
        context,
      );
      if (!read.ok) throw new Error(read.error);
      const result = read.result as Record<string, unknown>;
      const submitted = await createWordDocumentSubmissionExecutor(session)(
        {
          snapshot: snapshot.token,
          readToken: result.readToken,
          ...edit(result),
        },
        { ...context, toolCallId: "submit" },
      );
      if (!submitted.ok) throw new Error(JSON.stringify(submitted));
      return JSON.stringify((submitted.result as { plan: unknown }).plan);
    }
    /** A scoped_edit of the status paragraph alone. */
    function statusEdit(snapshot: WordAuthoringSnapshot): Promise<string> {
      const status = snapshot.blocks.find((b) => b.text.startsWith("Status"))!;
      return scopedPlan(snapshot, { target: { ref: status.ref } }, () => ({
        scoped_edit: {
          body: [
            {
              operation: "replace",
              source: [status.ref],
              blocks: [
                { id: "new", type: "paragraph", text: "Status: revised." },
              ],
            },
          ],
        },
      }));
    }

    beforeEach(() => {
      imports.mockClear();
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
      delete window.WORD_FORCE_IMPORT_APPLY;
      delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
      window.WORD_IN_PLACE_APPLY = true;
    });

    it("asks before a section change replaces the document, then imports the same plan once confirmed and reverts it", async () => {
      const { host, snapshot } = await realistic();
      const save = vi.fn();
      const plan = sectionChange(snapshot);
      const blocked = await applyWordDocumentPlan(
        plan,
        snapshot,
        "message-A",
        save,
      );
      expect(blocked).toEqual({
        status: "blocked",
        diagnostic: {
          stage: "validate",
          reason: "import-needs-confirmation",
          details: {
            route: "import",
            routeReason: "sections",
            fallbackReasons: ["sections"],
          },
        },
      });
      expect(report(blocked)).toContain("Reason: import-needs-confirmation");
      expect(report(blocked)).toContain("Route: import (sections)");
      expect(imports).not.toHaveBeenCalled();
      expect(host.insert).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(snapshot.used).toBe(false);

      const applied = await applyWordDocumentPlan(
        plan,
        snapshot,
        "message-A",
        save,
        undefined,
        confirmed,
      );
      expect(applied.status, report(applied)).toBe("applied");
      expect(applied.outcome?.route).toBe("import");
      expect(imports).toHaveBeenCalledOnce();
      expect(host.insert).toHaveBeenCalledOnce();
      expect(save).toHaveBeenCalledOnce();

      host.clearNativeUndo();
      const reverted = await revertWordDocumentPlan(
        applied.before!,
        applied.afterFingerprint!,
      );
      expect(reverted.status, JSON.stringify(reverted.diagnostic)).toBe(
        "reverted",
      );
      expect(host.insert).toHaveBeenCalledTimes(2);
    });

    it("refuses an import the deployment turned off for the web, confirmed or not", async () => {
      setWordWebImport("off");
      const { host, snapshot } = await realistic();
      const plan = sectionChange(snapshot);
      for (const options of [{}, confirmed]) {
        const result = await applyWordDocumentPlan(
          plan,
          snapshot,
          "message-A",
          undefined,
          undefined,
          options,
        );
        expect(result).toMatchObject({
          status: "blocked",
          diagnostic: {
            stage: "validate",
            reason: "import-disabled",
            details: { route: "import", routeReason: "sections" },
          },
        });
      }
      expect(imports).not.toHaveBeenCalled();
      expect(host.insert).not.toHaveBeenCalled();
      expect(snapshot.used).toBe(false);
    });

    it("never turns a scoped edit into an import, even once confirmed", async () => {
      const { host, snapshot } = await realistic();
      const plan = await statusEdit(snapshot);
      window.WORD_FORCE_IMPORT_APPLY = true;
      const result = await applyWordDocumentPlan(
        plan,
        snapshot,
        "message-A",
        undefined,
        undefined,
        confirmed,
      );
      expect(result).toEqual({
        status: "blocked",
        diagnostic: {
          stage: "validate",
          reason: "scoped-needs-in-place",
          details: {
            route: "import",
            routeReason: "disabled",
            fallbackReasons: ["disabled"],
            readScope: "objects",
          },
        },
      });
      expect(report(result)).toContain("Read scope: objects");
      expect(imports).not.toHaveBeenCalled();
      expect(host.insert).not.toHaveBeenCalled();
      expect(snapshot.used).toBe(false);
    });

    it("refuses a table-cell edit whose in-place write falls back live, even once confirmed", async () => {
      const { host, snapshot } = await realistic({
        cellParagraphTextSuffix: "\u0007",
      });
      const plan = await scopedPlan(
        snapshot,
        { table_cell: { header: "budget", rowLabel: "north" } },
        (result) => ({
          table_cell: {
            ...(result.target as Record<string, unknown>),
            text: "43",
          },
        }),
      );
      host.events.length = 0;
      const result = await applyWordDocumentPlan(
        plan,
        snapshot,
        "message-A",
        undefined,
        undefined,
        confirmed,
      );
      expect(result.diagnostic).toMatchObject({
        stage: "validate",
        reason: "scoped-needs-in-place",
        details: {
          route: "import",
          routeReason: "alignment",
          readScope: "table-cell",
        },
      });
      expect(imports).not.toHaveBeenCalled();
      expect(host.insert).not.toHaveBeenCalled();
      expect(mutations(host.events)).toEqual([]);
      expect(snapshot.used).toBe(false);
    });

    it("refuses a confirmed import Word rejects with NotAllowed, unchanged, and never retries it", async () => {
      const { host, snapshot } = await realistic();
      host.refuseImport();
      const save = vi.fn();
      const result = await applyWordDocumentPlan(
        sectionChange(snapshot),
        snapshot,
        "message-A",
        save,
        undefined,
        confirmed,
      );
      expect(result).toEqual({
        status: "blocked",
        diagnostic: {
          stage: "write",
          reason: "not-allowed",
          officeCode: "NotAllowed",
          officeLocation: "Document.insertFileFromBase64",
          details: {
            error: "Error",
            route: "import",
            routeReason: "sections",
          },
        },
      });
      expect(host.insert).toHaveBeenCalledOnce();
      expect(save).toHaveBeenCalledOnce();
      expect(snapshot.used).toBe(true);

      host.resume();
      const again = await applyWordDocumentPlan(
        sectionChange(snapshot),
        snapshot,
        "message-A",
        undefined,
        undefined,
        confirmed,
      );
      expect(again.diagnostic?.reason).toBe("expired");
      expect(host.insert).toHaveBeenCalledOnce();
    });

    it("keeps an import that changed the document before NotAllowed interrupted", async () => {
      const { host, snapshot } = await realistic();
      host.failAfterWrite("Word refused part of the write.", "NotAllowed");
      const result = await applyWordDocumentPlan(
        sectionChange(snapshot),
        snapshot,
        "message-A",
        undefined,
        undefined,
        confirmed,
      );
      expect(result.status).toBe("interrupted");
      expect(result.diagnostic).toMatchObject({
        stage: "write",
        reason: "host-error",
        officeCode: "NotAllowed",
      });
      expect(result.before).toBeDefined();
      expect(result.afterFingerprint).toBeDefined();
      expect(result.afterFingerprint).not.toBe(snapshot.fingerprint);
    });

    it("leaves Revert unretried when Word rejects the restore with NotAllowed", async () => {
      const { host, snapshot } = await realistic();
      const applied = await applyWordDocumentPlan(
        sectionChange(snapshot),
        snapshot,
        "message-A",
        undefined,
        undefined,
        confirmed,
      );
      expect(applied.status, report(applied)).toBe("applied");
      host.refuseImport();
      const reverted = await revertWordDocumentPlan(
        applied.before!,
        applied.afterFingerprint!,
      );
      expect(reverted).toMatchObject({
        status: "stale",
        diagnostic: {
          stage: "restore",
          reason: "not-allowed",
          officeCode: "NotAllowed",
        },
      });
      expect(host.insert).toHaveBeenCalledTimes(2);
    });

    it("imports the same plans on Word PC without asking", async () => {
      delete window.WORD_IN_PLACE_APPLY;
      const profile = { profile: "word-pc-16.0.20326" } as const;
      const first = await realistic(profile);
      const sections = await applyWordDocumentPlan(
        sectionChange(first.snapshot),
        first.snapshot,
        "message-A",
      );
      expect(sections.status, report(sections)).toBe("applied");
      expect(sections.outcome?.route).toBe("import");

      const second = await realistic(profile);
      const inPlace = await applyWordDocumentPlan(
        await statusEdit(second.snapshot),
        second.snapshot,
        "message-A",
      );
      expect(inPlace.status, report(inPlace)).toBe("applied");
      expect(inPlace.outcome?.route).toBe("in-place");

      const restore = setWordInPlace("pc", false);
      const third = await realistic(profile);
      const scoped = await applyWordDocumentPlan(
        await statusEdit(third.snapshot),
        third.snapshot,
        "message-A",
      ).finally(restore);
      expect(scoped.status, report(scoped)).toBe("applied");
      expect(scoped.outcome?.route).toBe("import");
      expect(imports).toHaveBeenCalledTimes(2);
    });
  },
);

describe(
  "proofing language Word re-detects after an import (ERMAIN-969)",
  { timeout: 30_000 },
  () => {
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const STATUS = "Status: revised in plain English.";
    const QUESTIONS = "Open questions follow.";
    /** Sets the proofing language of the body paragraph starting `prefix`, on its mark and runs,
     * as Word PC tags English text in a German document (ERMAIN-970 lang probe). */
    const tag = (xml: string, prefix: string, lang = "en-US") => {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const paragraph = Array.from(doc.getElementsByTagNameNS(W, "p")).find(
        (p) =>
          Array.from(p.getElementsByTagNameNS(W, "t"))
            .map((t) => t.textContent)
            .join("")
            .startsWith(prefix),
      );
      if (!paragraph) throw new Error(`No paragraph starting ${prefix}`);
      const own = (parent: Element, local: string, first: boolean) => {
        const existing = Array.from(parent.children).find(
          (e) => e.namespaceURI === W && e.localName === local,
        );
        if (existing) return existing;
        const created = doc.createElementNS(W, `w:${local}`);
        if (first) parent.insertBefore(created, parent.firstChild);
        else parent.append(created);
        return created;
      };
      const properties = own(paragraph, "pPr", true);
      const runs = Array.from(paragraph.children).filter(
        (e) => e.namespaceURI === W && e.localName === "r",
      );
      for (const rPr of [
        own(properties, "rPr", false),
        ...runs.map((r) => own(r, "rPr", true)),
      ]) {
        const language = own(rPr, "lang", false);
        language.setAttributeNS(W, "w:val", lang);
      }
      return new XMLSerializer().serializeToString(doc);
    };
    const original = () =>
      tag(tag(realisticWordPackageXml(), "Status"), QUESTIONS);
    async function applied(wordTagsBeforeVerify = false): Promise<{
      host: ReturnType<typeof installWordOoxmlHost>;
      result: Awaited<ReturnType<typeof applyWordDocumentPlan>>;
    }> {
      const host = installWordOoxmlHost(original(), {
        profile: "word-pc-16.0.20326",
      });
      const snapshot = await captureRealisticSnapshot();
      if (wordTagsBeforeVerify)
        host.userEdit((xml) => tag(xml, STATUS), "after-import");
      const result = await applyWordDocumentPlan(
        JSON.stringify(statusRewritePlan(snapshot, STATUS)),
        snapshot,
        "message-A",
      );
      expect(result).toMatchObject({
        status: "applied",
        outcome: { route: "import" },
      });
      return { host, result };
    }
    const revert = (
      result: Awaited<ReturnType<typeof applyWordDocumentPlan>>,
    ) => revertWordDocumentPlan(result.before!, result.afterFingerprint!);

    beforeEach(() => {
      delete window.WORD_IN_PLACE_APPLY;
      return setWordInPlace("pc", false);
    });
    afterEach(() => {
      window.WORD_IN_PLACE_APPLY = true;
    });

    it("reverts once Word has tagged the written paragraph with its source's language", async () => {
      const { host, result } = await applied();
      expect(result.outcome?.housekeeping).toBeUndefined();
      host.userEdit((xml) => tag(xml, STATUS));
      expect(await revert(result)).toMatchObject({
        status: "reverted",
        outcome: { route: "import", housekeeping: { "proofing-language": 2 } },
      });
      expect(host.ooxml()).not.toContain(STATUS);
    });

    it("verifies an import Word tagged before the verify read, and reverts it", async () => {
      const { result } = await applied(true);
      expect(result.outcome?.housekeeping).toEqual({ "proofing-language": 2 });
      expect((await revert(result)).status).toBe("reverted");
    });

    it("still refuses Revert after the user sets another language on the written paragraph", async () => {
      const { host, result } = await applied();
      host.userEdit((xml) => tag(tag(xml, STATUS), STATUS, "fr-FR"));
      expect(await revert(result)).toMatchObject({
        status: "stale",
        diagnostic: { stage: "preflight", reason: "source-changed" },
      });
      expect(host.insert).toHaveBeenCalledOnce();
    });

    it("still refuses Revert after the user sets a language on a paragraph the import kept", async () => {
      const { host, result } = await applied();
      host.userEdit((xml) => tag(tag(xml, STATUS), QUESTIONS, "fr-FR"));
      expect(await revert(result)).toMatchObject({
        status: "stale",
        diagnostic: {
          reason: "source-changed",
          details: { housekeeping: { "proofing-language": 2 } },
        },
      });
      expect(host.insert).toHaveBeenCalledOnce();
    });
  },
);

describe("whole-document writes on Word for the web by default", () => {
  const sections = (snapshot: WordAuthoringSnapshot) =>
    JSON.stringify({
      ...statusRewritePlan(snapshot, "Status: revised."),
      sections: [
        {
          id: "final",
          source: "section-1",
          layout: { orientation: "landscape" },
        },
      ],
    } satisfies WordDocumentPlan);

  it("refuses a plan that needs the import, even confirmed, before anything is saved", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = installWordOoxmlHost(realisticWordPackageXml());
    const snapshot = await captureRealisticSnapshot();
    const save = vi.fn();
    const result = await applyWordDocumentPlan(
      sections(snapshot),
      snapshot,
      "message-A",
      save,
      undefined,
      { importConfirmed: true },
    );
    expect(result).toMatchObject({
      status: "blocked",
      diagnostic: {
        stage: "validate",
        reason: "import-disabled",
        details: { route: "import", routeReason: "sections" },
      },
    });
    expect(host.insert).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(snapshot.used).toBe(false);
  });

  it("still writes a reword in place", async () => {
    const host = installWordOoxmlHost(realisticWordPackageXml());
    const snapshot = await captureRealisticSnapshot();
    const result = await applyWordDocumentPlan(
      JSON.stringify(statusRewritePlan(snapshot, "Status: reworded in place.")),
      snapshot,
      "message-A",
    );
    expect(result).toMatchObject({
      status: "applied",
      outcome: { route: "in-place" },
    });
    expect(host.insert).not.toHaveBeenCalled();
  });
});
