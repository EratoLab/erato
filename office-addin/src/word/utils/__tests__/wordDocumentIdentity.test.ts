import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import {
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
});
