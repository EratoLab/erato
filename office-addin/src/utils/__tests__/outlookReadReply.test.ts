import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REPLY_FORM_BODY_LIMIT_BYTES,
  ReplyBodyTooLargeError,
  buildReplyFormBody,
  escapeTextAsHtml,
  getReadModeRecipientSummary,
  isReadReplySupported,
  isReplyFormBodyTooLarge,
  openReplyForm,
} from "../outlookReadReply";

type OfficeGlobal = { Office?: unknown };

function installOffice({
  item,
  supportedSets = ["Mailbox 1.1", "Mailbox 1.9"],
}: {
  item: Record<string, unknown> | null;
  supportedSets?: string[];
}) {
  (globalThis as OfficeGlobal).Office = {
    AsyncResultStatus: { Succeeded: "succeeded", Failed: "failed" },
    context: {
      mailbox: { item },
      requirements: {
        isSetSupported: (name: string, version: string) =>
          supportedSets.includes(`${name} ${version}`),
      },
    },
  };
}

function readModeItem(overrides: Record<string, unknown> = {}) {
  return {
    // isMessageRead type-guards on a string subject.
    subject: "Quarterly numbers",
    from: { displayName: "Alice", emailAddress: "alice@example.com" },
    to: [{ displayName: "Me", emailAddress: "me@example.com" }],
    cc: [{ displayName: "", emailAddress: "bob@example.com" }],
    displayReplyFormAsync: vi.fn(
      (_body: string, cb: (r: { status: string; value: undefined }) => void) =>
        cb({ status: "succeeded", value: undefined }),
    ),
    displayReplyAllFormAsync: vi.fn(
      (_body: string, cb: (r: { status: string; value: undefined }) => void) =>
        cb({ status: "succeeded", value: undefined }),
    ),
    displayReplyForm: vi.fn(),
    displayReplyAllForm: vi.fn(),
    ...overrides,
  };
}

function composeModeItem() {
  // Compose items expose subject as an object (Office.SubjectCompose).
  return { subject: { getAsync: vi.fn() } };
}

afterEach(() => {
  delete (globalThis as OfficeGlobal).Office;
  vi.restoreAllMocks();
});

describe("escapeTextAsHtml", () => {
  it("escapes HTML entities and converts newlines", () => {
    expect(escapeTextAsHtml('Hi <b>"you"</b> & co\r\nBye\nNow')).toBe(
      "Hi &lt;b&gt;&quot;you&quot;&lt;/b&gt; &amp; co<br>Bye<br>Now",
    );
  });
});

describe("buildReplyFormBody", () => {
  it("sanitizes HTML content with the outbound config", () => {
    expect(buildReplyFormBody("<p>hello</p>", true)).toBe("<p>hello</p>");
    expect(
      buildReplyFormBody('<p onclick="x()">hi<script>x()</script></p>', true),
    ).toBe("<p>hi</p>");
  });

  it("escapes plain text content", () => {
    expect(buildReplyFormBody("a < b\nc", false)).toBe("a &lt; b<br>c");
  });
});

describe("isReplyFormBodyTooLarge", () => {
  it("enforces the 32 KB UTF-8 limit", () => {
    expect(
      isReplyFormBodyTooLarge("x".repeat(REPLY_FORM_BODY_LIMIT_BYTES)),
    ).toBe(false);
    expect(
      isReplyFormBodyTooLarge("x".repeat(REPLY_FORM_BODY_LIMIT_BYTES + 1)),
    ).toBe(true);
    // Multi-byte characters count in bytes, not chars.
    expect(
      isReplyFormBodyTooLarge("ü".repeat(REPLY_FORM_BODY_LIMIT_BYTES / 2 + 1)),
    ).toBe(true);
  });
});

describe("isReadReplySupported", () => {
  it("is true for a read-mode item on a supporting host", () => {
    installOffice({ item: readModeItem() });
    expect(isReadReplySupported()).toBe(true);
  });

  it("is false in compose mode", () => {
    installOffice({ item: composeModeItem() });
    expect(isReadReplySupported()).toBe(false);
  });

  it("is false without an item or without Mailbox 1.1", () => {
    installOffice({ item: null });
    expect(isReadReplySupported()).toBe(false);
    installOffice({ item: readModeItem(), supportedSets: [] });
    expect(isReadReplySupported()).toBe(false);
  });
});

describe("getReadModeRecipientSummary", () => {
  it("summarizes sender and recipients, preferring display names", () => {
    installOffice({ item: readModeItem() });
    expect(getReadModeRecipientSummary()).toEqual({
      sender: "Alice",
      recipients: ["Me", "bob@example.com"],
    });
  });

  it("returns null outside read mode", () => {
    installOffice({ item: composeModeItem() });
    expect(getReadModeRecipientSummary()).toBeNull();
  });
});

describe("openReplyForm", () => {
  it("opens the async reply form with the escaped text body", async () => {
    const item = readModeItem();
    installOffice({ item });
    await openReplyForm("outlook.reply", "Hello\nWorld", false);
    expect(item.displayReplyFormAsync).toHaveBeenCalledWith(
      "Hello<br>World",
      expect.any(Function),
    );
    expect(item.displayReplyAllFormAsync).not.toHaveBeenCalled();
  });

  it("opens the reply-all form with the sanitized HTML body", async () => {
    const item = readModeItem();
    installOffice({ item });
    await openReplyForm(
      "outlook.reply_all",
      "<p>Hi<script>x()</script></p>",
      true,
    );
    expect(item.displayReplyAllFormAsync).toHaveBeenCalledWith(
      "<p>Hi</p>",
      expect.any(Function),
    );
  });

  it("falls back to the sync API when Mailbox 1.9 is unsupported", async () => {
    const item = readModeItem();
    installOffice({ item, supportedSets: ["Mailbox 1.1"] });
    await openReplyForm("outlook.reply", "Hi", false);
    expect(item.displayReplyForm).toHaveBeenCalledWith("Hi");
    expect(item.displayReplyFormAsync).not.toHaveBeenCalled();
  });

  it("throws ReplyBodyTooLargeError for oversized drafts without calling Office", async () => {
    const item = readModeItem();
    installOffice({ item });
    await expect(
      openReplyForm(
        "outlook.reply",
        "x".repeat(REPLY_FORM_BODY_LIMIT_BYTES + 1),
        false,
      ),
    ).rejects.toBeInstanceOf(ReplyBodyTooLargeError);
    expect(item.displayReplyFormAsync).not.toHaveBeenCalled();
    expect(item.displayReplyForm).not.toHaveBeenCalled();
  });

  it("throws when the current item is not a read-mode message", async () => {
    installOffice({ item: composeModeItem() });
    await expect(openReplyForm("outlook.reply", "Hi", false)).rejects.toThrow(
      /not an open received email/,
    );
  });

  it("propagates Office async failures", async () => {
    const item = readModeItem({
      displayReplyFormAsync: vi.fn(
        (
          _body: string,
          cb: (r: { status: string; error: { message: string } }) => void,
        ) => cb({ status: "failed", error: { message: "nope" } }),
      ),
    });
    installOffice({ item });
    await expect(openReplyForm("outlook.reply", "Hi", false)).rejects.toThrow(
      "nope",
    );
  });
});
