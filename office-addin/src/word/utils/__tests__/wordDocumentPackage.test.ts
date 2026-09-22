import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureWordDocumentPackage,
  decodeWordDocumentBackup,
  encodeWordDocumentBackup,
  insertWordDocumentFile,
  isWordDocumentBackup,
  readWordDocumentFile,
  wordDocumentFileToOoxml,
  wordDocumentOoxmlToFile,
  WORD_DOCUMENT_IMPORT_OPTIONS,
} from "../wordDocumentPackage";
import { readWordPackage, wordXmlText } from "../wordDocumentPackageCodec";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
function fixture(footer = "Original footer") {
  const part = (name: string, type: string, body: string, binary = false) =>
    `<pkg:part pkg:name="${name}" pkg:contentType="${type}"><pkg:${binary ? "binaryData" : "xmlData"}>${body}</pkg:${binary ? "binaryData" : "xmlData"}></pkg:part>`;
  return `<pkg:package xmlns:pkg="${PKG}">${[
    part(
      "/_rels/.rels",
      "application/vnd.openxmlformats-package.relationships+xml",
      `<Relationships xmlns="${REL}"><Relationship Id="root" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    part(
      "/word/document.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>Native document</w:t></w:r></w:p><w:sectPr><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
    ),
    part(
      "/word/_rels/document.xml.rels",
      "application/vnd.openxmlformats-package.relationships+xml",
      `<Relationships xmlns="${REL}"><Relationship Id="footer" Type="${R}/footer" Target="footer1.xml"/><Relationship Id="asset" Type="${R}/image" Target="media/image1.png"/></Relationships>`,
    ),
    part(
      "/word/footer1.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
      `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>${footer}</w:t></w:r></w:p></w:ftr>`,
    ),
    part("/word/media/image1.png", "image/png", "AQIDBA==", true),
  ].join("")}</pkg:package>`;
}

afterEach(() => vi.unstubAllGlobals());

describe("complete Word document package transport", () => {
  it("roundtrips native stories, relationships, section geometry and binary assets", () => {
    const original = wordDocumentOoxmlToFile(fixture());
    const flat = wordDocumentFileToOoxml(original);
    const restored = readWordPackage(wordDocumentOoxmlToFile(flat));
    const before = readWordPackage(original);
    expect([...restored.keys()].sort()).toEqual([...before.keys()].sort());
    expect(restored.get("word/media/image1.png")).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(wordXmlText(restored.get("word/footer1.xml")!)).toContain(
      "Original footer",
    );
    expect(wordXmlText(restored.get("word/document.xml")!)).toContain(
      'w:w="11906"',
    );
  });

  it("rejects a dangling relationship before the native import boundary", () => {
    const bad = fixture().replace(
      'Target="footer1.xml"',
      'Target="missing.xml"',
    );
    expect(() => wordDocumentOoxmlToFile(bad)).toThrow(
      /Missing relationship target/,
    );
  });

  it("rejects duplicate package names and XML entity expansion", () => {
    const bad = fixture().replace(
      'pkg:name="/word/footer1.xml"',
      'pkg:name="/word/document.xml"',
    );
    expect(() => wordDocumentOoxmlToFile(bad)).toThrow(
      /Invalid document package part/,
    );
    expect(() =>
      wordDocumentOoxmlToFile(`<!DOCTYPE foo [<!ENTITY x "bad">]>${fixture()}`),
    ).toThrow(/entities/);
  });

  it("queues the document import with complete story/section preservation options", () => {
    const insert = vi.fn();
    const context = {
      document: { insertFileFromBase64: insert },
    } as unknown as Word.RequestContext;
    const bytes = wordDocumentOoxmlToFile(fixture());
    insertWordDocumentFile(context, bytes);
    expect(insert).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      "Replace",
      WORD_DOCUMENT_IMPORT_OPTIONS,
    );
  });

  it("keeps the exact original DOCX bytes in the string recovery envelope", () => {
    const bytes = wordDocumentOoxmlToFile(fixture());
    const value = encodeWordDocumentBackup({
      bytes,
      ooxml: fixture(),
      documentUrl: "file:///fixture.docx",
      fingerprint: "source",
    });
    expect(isWordDocumentBackup(value)).toBe(true);
    const decoded = decodeWordDocumentBackup(value);
    expect(decoded.bytes).toEqual(bytes);
    expect(decoded.documentUrl).toBe("file:///fixture.docx");
    expect(decoded.ooxml).toContain("Original footer");
    expect(isWordDocumentBackup(fixture())).toBe(false);
  });
});

function officeFile(
  bytes: Uint8Array,
  failure?: "slice" | "wrong-size" | "oversize",
) {
  const close = vi.fn((callback: () => void) => callback());
  const value = {
    size: failure === "oversize" ? 4 * 1024 * 1024 + 1 : bytes.length,
    sliceCount: 1,
    closeAsync: close,
    getSliceAsync: vi.fn((index: number, callback: (result: unknown) => void) =>
      callback(
        failure === "slice"
          ? { status: "failed" }
          : {
              status: "succeeded",
              value: {
                index,
                size:
                  failure === "wrong-size" ? bytes.length + 1 : bytes.length,
                data: Array.from(bytes),
              },
            },
      ),
    ),
  };
  const document = {
    url: "file:///fixture.docx",
    getFileAsync: vi.fn(
      (
        _type: unknown,
        _options: unknown,
        callback: (result: unknown) => void,
      ) => callback({ status: "succeeded", value }),
    ),
  };
  vi.stubGlobal("Office", {
    context: { document },
    FileType: { Compressed: "compressed" },
    AsyncResultStatus: { Succeeded: "succeeded" },
  });
  return { close, document };
}

describe("native complete-document capture", () => {
  it("closes the native file handle after reading all bytes", async () => {
    const bytes = wordDocumentOoxmlToFile(fixture());
    const host = officeFile(bytes);
    expect(await readWordDocumentFile()).toEqual(bytes);
    expect(host.close).toHaveBeenCalledOnce();
  });

  it.each(["slice", "wrong-size", "oversize"] as const)(
    "closes the native file handle after %s failure",
    async (failure) => {
      const host = officeFile(wordDocumentOoxmlToFile(fixture()), failure);
      await expect(readWordDocumentFile()).rejects.toThrow();
      expect(host.close).toHaveBeenCalledOnce();
    },
  );

  it("includes changes outside the body in the stale-state fingerprint", async () => {
    officeFile(wordDocumentOoxmlToFile(fixture()));
    const before = await captureWordDocumentPackage();
    officeFile(wordDocumentOoxmlToFile(fixture("Later footer")));
    const after = await captureWordDocumentPackage();
    expect(before.fingerprint).not.toBe(after.fingerprint);
  });
});
