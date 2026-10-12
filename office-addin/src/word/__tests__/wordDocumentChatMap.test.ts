import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WORD_DOCUMENT_CHATS_KEY,
  WORD_DOCUMENT_CHATS_MAX_AGE_MS,
  WORD_DOCUMENT_CHATS_MAX_ENTRIES,
  forgetWordDocumentChat,
  normalizeWordDocumentUrl,
  readWordDocumentChat,
  recordWordDocumentChat,
  wordDocumentChatKey,
} from "../wordDocumentChatMap";

const REPORT_URL =
  "https://contoso.sharepoint.com/Shared%20Documents/report.docx";
const NOW = Date.UTC(2026, 9, 11);

const keyFor = (index: number) => index.toString(16).padStart(64, "0");

const storedKeys = () =>
  Object.keys(
    JSON.parse(localStorage.getItem(WORD_DOCUMENT_CHATS_KEY) ?? "{}") as object,
  );

describe("word document chat map", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe("normalization", () => {
    it("drops query and fragment, lowercases and decodes a URL", () => {
      expect(
        normalizeWordDocumentUrl(
          "https://Contoso.SharePoint.com/Shared%20Documents/Report.docx?web=1#top",
        ),
      ).toBe("https://contoso.sharepoint.com/shared documents/report.docx");
    });

    it("unifies Windows separators and keeps a '#' that is part of a local file name", () => {
      expect(normalizeWordDocumentUrl("C:\\Users\\Erato\\Issue #5.docx")).toBe(
        "c:/users/erato/issue #5.docx",
      );
    });

    it("keeps a segment that does not decode", () => {
      expect(normalizeWordDocumentUrl("C:\\temp\\100% Final.docx")).toBe(
        "c:/temp/100% final.docx",
      );
    });
  });

  describe("document key", () => {
    it("hashes every spelling of one document to the same SHA-256 hex key", async () => {
      const key = await wordDocumentChatKey(REPORT_URL);

      expect(key).toMatch(/^[0-9a-f]{64}$/);
      await expect(
        wordDocumentChatKey(
          "https://contoso.sharepoint.com/shared documents/REPORT.docx?web=1",
        ),
      ).resolves.toBe(key);
      await expect(
        wordDocumentChatKey(
          "https://contoso.sharepoint.com/Shared%20Documents/other.docx",
        ),
      ).resolves.not.toBe(key);
    });

    it("gives an unsaved document no key", async () => {
      await expect(
        wordDocumentChatKey(`pane-session:${globalThis.crypto.randomUUID()}`),
      ).resolves.toBeNull();
      await expect(wordDocumentChatKey("")).resolves.toBeNull();
    });

    it("gives no key when hashing is unavailable", async () => {
      vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValue(
        new Error("insecure context"),
      );

      await expect(wordDocumentChatKey(REPORT_URL)).resolves.toBeNull();
    });
  });

  it("stores the chat under the hash, never the document URL", async () => {
    const key = (await wordDocumentChatKey(REPORT_URL))!;

    recordWordDocumentChat(key, "chat-1", NOW);

    expect(readWordDocumentChat(key, NOW)).toBe("chat-1");
    const raw = localStorage.getItem(WORD_DOCUMENT_CHATS_KEY) ?? "";
    expect(raw).not.toMatch(/contoso|report|sharepoint/i);
    expect(JSON.parse(raw)).toEqual({
      [key]: { chatId: "chat-1", usedAt: NOW },
    });
  });

  it("evicts the least recently used document beyond the cap", () => {
    for (let index = 0; index <= WORD_DOCUMENT_CHATS_MAX_ENTRIES; index += 1) {
      recordWordDocumentChat(keyFor(index), `chat-${index}`, NOW + index);
    }

    expect(storedKeys()).toHaveLength(WORD_DOCUMENT_CHATS_MAX_ENTRIES);
    expect(readWordDocumentChat(keyFor(0), NOW + 1000)).toBeNull();
    expect(readWordDocumentChat(keyFor(1), NOW + 1000)).toBe("chat-1");
  });

  it("refreshes recency when a document records again", () => {
    for (let index = 0; index < WORD_DOCUMENT_CHATS_MAX_ENTRIES; index += 1) {
      recordWordDocumentChat(keyFor(index), `chat-${index}`, NOW + index);
    }
    recordWordDocumentChat(keyFor(0), "chat-0", NOW + 1000);
    recordWordDocumentChat(keyFor(9999), "chat-new", NOW + 1001);

    expect(readWordDocumentChat(keyFor(0), NOW + 1002)).toBe("chat-0");
    expect(readWordDocumentChat(keyFor(1), NOW + 1002)).toBeNull();
  });

  it("forgets documents unused for 60 days, on read and on write", () => {
    recordWordDocumentChat(keyFor(1), "chat-old", NOW);

    expect(
      readWordDocumentChat(keyFor(1), NOW + WORD_DOCUMENT_CHATS_MAX_AGE_MS),
    ).toBe("chat-old");
    expect(
      readWordDocumentChat(keyFor(1), NOW + WORD_DOCUMENT_CHATS_MAX_AGE_MS + 1),
    ).toBeNull();

    recordWordDocumentChat(
      keyFor(2),
      "chat-new",
      NOW + WORD_DOCUMENT_CHATS_MAX_AGE_MS + 1,
    );
    expect(storedKeys()).toEqual([keyFor(2)]);
  });

  it.each([
    ["not JSON", "{oops"],
    ["an array", "[]"],
    ["null", "null"],
    ["a string", '"chat-1"'],
  ])("treats %s in storage as empty", (_label, raw) => {
    localStorage.setItem(WORD_DOCUMENT_CHATS_KEY, raw);

    expect(readWordDocumentChat(keyFor(1), NOW)).toBeNull();
    recordWordDocumentChat(keyFor(1), "chat-1", NOW);
    expect(readWordDocumentChat(keyFor(1), NOW)).toBe("chat-1");
  });

  it("drops malformed entries and keeps the valid ones", () => {
    localStorage.setItem(
      WORD_DOCUMENT_CHATS_KEY,
      JSON.stringify({
        [keyFor(1)]: { chatId: "chat-1", usedAt: NOW },
        [keyFor(2)]: { chatId: 7, usedAt: NOW },
        [keyFor(3)]: { chatId: "chat-3", usedAt: "yesterday" },
        [keyFor(4)]: { chatId: "", usedAt: NOW },
        "https://contoso.sharepoint.com/report.docx": {
          chatId: "chat-raw",
          usedAt: NOW,
        },
      }),
    );

    recordWordDocumentChat(keyFor(5), "chat-5", NOW);

    expect(storedKeys().sort()).toEqual([keyFor(1), keyFor(5)]);
  });

  it("keeps working when storage throws", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() =>
      recordWordDocumentChat(keyFor(1), "chat-1", NOW),
    ).not.toThrow();
    expect(readWordDocumentChat(keyFor(1), NOW)).toBeNull();
    expect(() =>
      forgetWordDocumentChat(keyFor(1), "chat-1", NOW),
    ).not.toThrow();
  });

  it("forgets an entry only while it still names that chat", () => {
    recordWordDocumentChat(keyFor(1), "chat-2", NOW);

    forgetWordDocumentChat(keyFor(1), "chat-1", NOW);
    expect(readWordDocumentChat(keyFor(1), NOW)).toBe("chat-2");

    forgetWordDocumentChat(keyFor(1), "chat-2", NOW);
    expect(readWordDocumentChat(keyFor(1), NOW)).toBeNull();
  });
});
