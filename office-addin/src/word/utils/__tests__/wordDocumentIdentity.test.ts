import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import {
  getWordDocumentIdentity,
  readLiveWordDocumentUrl,
  resetWordDocumentIdentityForTests,
  resolveWordDocumentIdentity,
  resolveWordDocumentName,
} from "../wordDocumentIdentity";

import type { MockWordHost } from "../../../test/mocks/word/document";

describe("word document identity", () => {
  let word: MockWordHost;

  beforeEach(() => {
    word = installMockWordDocument();
  });

  afterEach(() => {
    uninstallMockWordDocument();
  });

  it("uses the document URL when the document is saved", () => {
    expect(resolveWordDocumentIdentity()).toBe(
      "https://contoso.sharepoint.com/Shared%20Documents/report.docx",
    );
  });

  it("mints a per-pane session token when the document is unsaved", () => {
    word.document.url = null;

    const identity = resolveWordDocumentIdentity();

    expect(identity).toMatch(/^pane-session:[0-9a-f-]{36}$/);
    expect(resolveWordDocumentIdentity()).not.toBe(identity);
  });

  it("derives the name from the URL, percent-decoded", () => {
    expect(resolveWordDocumentName()).toBe("report.docx");
  });

  it("derives the name from a Windows local path", () => {
    word.document.url = "C:\\Users\\erato\\Documents\\Quarterly Review.docx";
    expect(resolveWordDocumentName()).toBe("Quarterly Review.docx");
  });

  it("drops a query string and survives an undecodable name", () => {
    word.document.url = "https://contoso.sharepoint.com/a/b.docx?web=1";
    expect(resolveWordDocumentName()).toBe("b.docx");

    word.document.url = "C:\\temp\\100% final.docx";
    expect(resolveWordDocumentName()).toBe("100% final.docx");
  });

  it("returns an empty name for an unsaved document rather than inventing one", () => {
    word.document.url = null;
    expect(resolveWordDocumentName()).toBe("");
  });

  describe("pane identity", () => {
    it("keeps the URL seen at first use for the rest of the pane load", () => {
      const identity = getWordDocumentIdentity();
      word.document.url = "https://contoso.sharepoint.com/renamed.docx";

      expect(getWordDocumentIdentity()).toBe(identity);
      expect(identity).toBe(
        "https://contoso.sharepoint.com/Shared%20Documents/report.docx",
      );
    });

    it("keeps one session token for an unsaved document, even after a save", () => {
      word.document.url = null;
      const identity = getWordDocumentIdentity();
      word.document.url = "https://contoso.sharepoint.com/saved.docx";

      expect(identity).toMatch(/^pane-session:/);
      expect(getWordDocumentIdentity()).toBe(identity);
    });

    it("mints a new identity after a reset", () => {
      word.document.url = null;
      const identity = getWordDocumentIdentity();

      resetWordDocumentIdentityForTests();

      expect(getWordDocumentIdentity()).not.toBe(identity);
    });
  });

  describe("live document URL", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("reads the URL from the file properties, which see a save after load", async () => {
      word.document.url = null;
      word.document.getFilePropertiesAsync.mockImplementation((callback) =>
        callback({
          status: Office.AsyncResultStatus.Succeeded,
          value: { url: "https://contoso.sharepoint.com/saved.docx" },
        } as Office.AsyncResult<Office.FileProperties>),
      );

      await expect(readLiveWordDocumentUrl()).resolves.toBe(
        "https://contoso.sharepoint.com/saved.docx",
      );
    });

    it("falls back to the document URL when the file properties fail", async () => {
      word.document.getFilePropertiesAsync.mockImplementation((callback) =>
        callback({
          status: Office.AsyncResultStatus.Failed,
          error: { message: "not supported" },
        } as Office.AsyncResult<Office.FileProperties>),
      );

      await expect(readLiveWordDocumentUrl()).resolves.toBe(
        "https://contoso.sharepoint.com/Shared%20Documents/report.docx",
      );
    });

    it("falls back to the document URL when the host lacks file properties", async () => {
      delete (word.document as Partial<typeof word.document>)
        .getFilePropertiesAsync;

      await expect(readLiveWordDocumentUrl()).resolves.toBe(
        "https://contoso.sharepoint.com/Shared%20Documents/report.docx",
      );
    });

    it("resolves null for an unsaved document", async () => {
      word.document.url = null;

      await expect(readLiveWordDocumentUrl()).resolves.toBeNull();
    });

    it("gives up on a host that never answers", async () => {
      vi.useFakeTimers();
      word.document.url = null;
      word.document.getFilePropertiesAsync.mockImplementation(() => {});

      const read = readLiveWordDocumentUrl();
      await vi.advanceTimersByTimeAsync(2000);

      await expect(read).resolves.toBeNull();
    });
  });
});
