import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createMockAsyncResult } from "../helpers/asyncResult";
import { createMockMessageCompose } from "../mocks/outlook/composeMail";
import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../mocks/outlook/mailbox";
import { createMockMessageRead } from "../mocks/outlook/readMail";
import {
  MOCK_WORD_READY_INFO,
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../mocks/word/document";

describe("Office.js test setup", () => {
  it("exposes the Office global with shared enums", () => {
    expect(Office).toBeDefined();
    expect(Office.CoercionType.Text).toBeDefined();
    expect(Office.AsyncResultStatus.Succeeded).toBeDefined();
    expect(Office.EventType.ItemChanged).toBeDefined();
  });

  it("starts with a bare context (no host-specific properties)", () => {
    expect(Office.context).toBeDefined();
    expect(
      (Office.context as unknown as Record<string, unknown>).mailbox,
    ).toBeUndefined();
  });

  describe("with Outlook mailbox installed", () => {
    beforeEach(() => {
      installMockMailbox();
    });

    afterEach(() => {
      uninstallMockMailbox();
    });

    it("provides a mailbox context with null item", () => {
      expect(Office.context.mailbox).toBeDefined();
      expect(Office.context.mailbox.item).toBeNull();
    });

    it("can distinguish read vs compose mocks via subject type", () => {
      const readItem = createMockMessageRead();
      const composeItem = createMockMessageCompose();

      // Read mode: subject is a plain string
      expect(typeof readItem.subject).toBe("string");

      // Compose mode: subject is an object with getAsync
      expect(typeof composeItem.subject).toBe("object");
      expect(composeItem.subject.getAsync).toBeDefined();
    });
  });

  describe("with the Word document host installed", () => {
    it("attaches the document, the requirement probe and Office.onReady", async () => {
      const word = installMockWordDocument();
      try {
        expect(
          (Office.context as unknown as Record<string, unknown>).document,
        ).toBe(word.document);
        expect(
          Office.context.requirements.isSetSupported("WordApi", "1.7"),
        ).toBe(true);
        expect(
          Office.context.requirements.isSetSupported("NestedAppAuth", "1.1"),
        ).toBe(true);
        // Without Office.onReady, loadOfficeJs waits for a CDN script that never loads in jsdom.
        expect(typeof Office.onReady).toBe("function");
        await expect(Office.onReady()).resolves.toEqual(MOCK_WORD_READY_INFO);
      } finally {
        uninstallMockWordDocument();
      }
    });

    it("restores the bare shared context on uninstall", () => {
      installMockWordDocument();
      uninstallMockWordDocument();

      const context = Office.context as unknown as Record<string, unknown>;
      expect(context.document).toBeUndefined();
      expect(context.requirements).toBeUndefined();
      expect(
        (Office as unknown as Record<string, unknown>).onReady,
      ).toBeUndefined();
    });
  });

  it("createMockAsyncResult produces a succeeded result", () => {
    const result = createMockAsyncResult("test-value");

    expect(result.status).toBe(Office.AsyncResultStatus.Succeeded);
    expect(result.value).toBe("test-value");
  });

  it("createMockAsyncResult produces a failed result", () => {
    const result = createMockAsyncResult(null, "failed", {
      message: "Something went wrong",
      code: "5001",
    });

    expect(result.status).toBe(Office.AsyncResultStatus.Failed);
    expect(result.error).toEqual({
      message: "Something went wrong",
      code: "5001",
    });
  });
});
