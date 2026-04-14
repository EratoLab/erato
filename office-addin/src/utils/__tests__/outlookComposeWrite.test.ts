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

    it("infers 'html' when getTypeAsync is unavailable", async () => {
      const getAsync = vi.fn((coercionType, callback) => {
        if (coercionType === Office.CoercionType.Html) {
          callback(createMockAsyncResult("<div>Hello</div>"));
          return;
        }

        callback(createMockAsyncResult("Hello"));
      });
      const item = createMockMessageCompose({
        body: {
          getAsync,
          setSelectedDataAsync: vi.fn(),
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      const result = await getComposeBodyType();
      expect(result).toBe("html");
      expect(getAsync).toHaveBeenCalledWith(
        Office.CoercionType.Html,
        expect.any(Function),
      );
      expect(getAsync).toHaveBeenCalledWith(
        Office.CoercionType.Text,
        expect.any(Function),
      );
    });

    it("falls back to 'text' when html body reads are unavailable", async () => {
      const getAsync = vi.fn((coercionType, callback) => {
        if (coercionType === Office.CoercionType.Html) {
          callback(
            createMockAsyncResult("", "failed", {
              message: "HTML body unsupported",
              code: "UnsupportedDataObject",
            }),
          );
          return;
        }

        callback(createMockAsyncResult("Hello"));
      });
      const item = createMockMessageCompose({
        body: {
          getAsync,
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
    it("converts plain text to HTML with line breaks for html body", async () => {
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

      await replaceComposeSelection("line one\nline two");
      expect(setSelectedDataAsync).toHaveBeenCalledWith(
        "line one<br>\nline two",
        { coercionType: Office.CoercionType.Html },
        expect.any(Function),
      );
    });

    it("uses Html coercion for html content into html body", async () => {
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

      await replaceComposeSelection("<b>bold</b>", true);
      expect(setSelectedDataAsync).toHaveBeenCalledWith(
        "<b>bold</b>",
        { coercionType: Office.CoercionType.Html },
        expect.any(Function),
      );
    });

    it("uses Text coercion for plain content into text body", async () => {
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

    it("strips HTML tags when inserting html content into text body", async () => {
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

      await replaceComposeSelection("<b>bold</b> text", true);
      expect(setSelectedDataAsync).toHaveBeenCalledWith(
        "bold text",
        { coercionType: Office.CoercionType.Text },
        expect.any(Function),
      );
    });

    it("falls back to text insertion when html insertion is rejected", async () => {
      const setSelectedDataAsync = vi.fn((data, options, callback) => {
        if (options.coercionType === Office.CoercionType.Html) {
          callback(
            createMockAsyncResult(undefined, "failed", {
              message: "HTML insertion unsupported",
              code: "InvalidFormatError",
            }),
          );
          return;
        }

        callback(createMockAsyncResult(undefined));
      });
      const item = createMockMessageCompose({
        body: {
          getAsync: vi.fn((coercionType, callback) => {
            if (coercionType === Office.CoercionType.Html) {
              callback(createMockAsyncResult("plain text"));
              return;
            }

            callback(createMockAsyncResult("plain text"));
          }),
          setSelectedDataAsync,
          prependAsync: vi.fn(),
        },
      });
      mailbox.item = item;

      await replaceComposeSelection("<b>bold</b>", true);
      expect(setSelectedDataAsync).toHaveBeenNthCalledWith(
        1,
        "<b>bold</b>",
        { coercionType: Office.CoercionType.Html },
        expect.any(Function),
      );
      expect(setSelectedDataAsync).toHaveBeenNthCalledWith(
        2,
        "bold",
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
