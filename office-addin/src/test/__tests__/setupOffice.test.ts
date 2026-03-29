import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createMockMessageCompose } from "../mocks/outlook/composeMail";
import { createMockMessageRead } from "../mocks/outlook/readMail";
import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../mocks/outlook/mailbox";
import { createMockAsyncResult } from "../helpers/asyncResult";

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
