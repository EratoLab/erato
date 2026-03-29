import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { createMockAsyncResult } from "../../test/helpers/asyncResult";
import { createMockMessageCompose } from "../../test/mocks/outlook/composeMail";
import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import {
  getComposeBodyType,
  replaceComposeSelection,
  prependComposeBody,
} from "../outlookComposeWrite";

describe("outlookComposeWrite", () => {
  let mailbox: ReturnType<typeof installMockMailbox>;

  beforeEach(() => {
    mailbox = installMockMailbox();
  });

  afterEach(() => {
    uninstallMockMailbox();
  });

  describe("getComposeBodyType", () => {
    it("returns 'html' when body type is Html", async () => {
      const item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(Office.CoercionType.Html)),
          ),
          setSelectedDataAsync: vi.fn(),
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      const result = await getComposeBodyType();
      expect(result).toBe("html");
    });

    it("returns 'text' when body type is Text", async () => {
      const item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(Office.CoercionType.Text)),
          ),
          setSelectedDataAsync: vi.fn(),
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      const result = await getComposeBodyType();
      expect(result).toBe("text");
    });

    it("throws when no compose item is available", async () => {
      mailbox.item = null;
      await expect(getComposeBodyType()).rejects.toThrow(
        "No compose item available",
      );
    });
  });

  describe("replaceComposeSelection", () => {
    it("calls setSelectedDataAsync with Html coercion for html body", async () => {
      const setSelectedDataAsync = vi.fn((_data, _options, callback) =>
        callback(createMockAsyncResult(undefined)),
      );
      const item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(Office.CoercionType.Html)),
          ),
          setSelectedDataAsync,
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      await replaceComposeSelection("<b>bold</b>");
      expect(setSelectedDataAsync).toHaveBeenCalledWith(
        "<b>bold</b>",
        { coercionType: Office.CoercionType.Html },
        expect.any(Function),
      );
    });

    it("calls setSelectedDataAsync with Text coercion for text body", async () => {
      const setSelectedDataAsync = vi.fn((_data, _options, callback) =>
        callback(createMockAsyncResult(undefined)),
      );
      const item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(Office.CoercionType.Text)),
          ),
          setSelectedDataAsync,
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      await replaceComposeSelection("plain text");
      expect(setSelectedDataAsync).toHaveBeenCalledWith(
        "plain text",
        { coercionType: Office.CoercionType.Text },
        expect.any(Function),
      );
    });
  });

  describe("prependComposeBody", () => {
    it("calls prependAsync with matching coercion type", async () => {
      const prependAsync = vi.fn((_data, _options, callback) =>
        callback(createMockAsyncResult(undefined)),
      );
      const item = createMockMessageCompose({
        body: {
          getAsync: vi.fn(),
          getTypeAsync: vi.fn((callback) =>
            callback(createMockAsyncResult(Office.CoercionType.Html)),
          ),
          setSelectedDataAsync: vi.fn(),
          prependAsync,
        },
      });
      mailbox.item = item;

      await prependComposeBody("<p>header</p>");
      expect(prependAsync).toHaveBeenCalledWith(
        "<p>header</p>",
        { coercionType: Office.CoercionType.Html },
        expect.any(Function),
      );
    });
  });
});
