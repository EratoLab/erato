import { describe, expect, it, vi } from "vitest";

import { MOCK_CHAT_ID } from "../../../test/mocks/teams/graph";
import {
  MAX_IMAGE_BYTES,
  MAX_TRANSCRIPT_FILES,
  MAX_TRANSCRIPT_IMAGES,
  collectTeamsMessageAssets,
  planTeamsAssetFetches,
  stampImageMarkers,
} from "../teamsTranscriptAssets";

import type { TeamsTranscriptSection } from "../buildTeamsTranscriptFile";
import type { ParsedTeamsChat, ParsedTeamsMessage } from "../parsedTeamsChat";

const chat: ParsedTeamsChat = {
  chatId: MOCK_CHAT_ID,
  title: "Product sync",
  participants: [],
  selfDisplayName: null,
  participantsTruncated: false,
  chatType: "group",
  lastActivityAt: null,
  previewText: "",
};

function message(
  overrides: Partial<ParsedTeamsMessage> = {},
): ParsedTeamsMessage {
  return {
    chatId: MOCK_CHAT_ID,
    messageId: "m1",
    senderName: "Ada Lovelace",
    createdAt: "2026-03-03T09:14:00Z",
    editedAt: null,
    subject: null,
    text: "[image]",
    markers: [],
    replyToId: null,
    deepLink: "https://example.invalid/m1",
    sharedFiles: [],
    imageUrls: [],
    ...overrides,
  };
}

function section(messages: ParsedTeamsMessage[]): TeamsTranscriptSection {
  return { kind: "chat", chat, messages, selection: "messages" };
}

const url = (id: string) =>
  `https://graph.microsoft.com/v1.0/chats/x/messages/1/hostedContents/${id}/$value`;

const bytesOf = (text: string) => new TextEncoder().encode(text).buffer;

describe("stampImageMarkers", () => {
  it("replaces markers by occurrence index and leaves unfetched ones", () => {
    expect(
      stampImageMarkers("a [image] b [image] c", [null, "teams-img-1.png"]),
    ).toBe("a [image] b [image: teams-img-1.png] c");
  });

  it("returns the text unchanged with nothing to stamp", () => {
    expect(stampImageMarkers("[image]", [null])).toBe("[image]");
  });
});

describe("planTeamsAssetFetches", () => {
  it("counts unique fetchable urls up to the cap", () => {
    const many = Array.from({ length: MAX_TRANSCRIPT_IMAGES + 5 }, (_, i) =>
      url(`u${i}`),
    );
    const sections = [
      section([
        message({ imageUrls: [url("a"), null, url("a")] }),
        message({ messageId: "m2", imageUrls: many }),
      ]),
    ];
    expect(planTeamsAssetFetches(sections, false)).toBe(MAX_TRANSCRIPT_IMAGES);
  });
});

describe("collectTeamsMessageAssets", () => {
  it("uploads one file per distinct image and stamps every marker", async () => {
    // The same bytes behind two urls — one upload, two stamps.
    const fetchImage = vi.fn((_section, requested: string) =>
      Promise.resolve({
        bytes: bytesOf(requested.includes("dup") ? "same" : "same"),
        contentType: "image/jpeg",
      }),
    );
    const sections = [
      section([
        message({ text: "[image]", imageUrls: [url("a")] }),
        message({
          messageId: "m2",
          text: "[image]",
          imageUrls: [url("dup")],
        }),
      ]),
    ];

    const result = await collectTeamsMessageAssets({
      sections,
      fetchImage,
      downloadFile: null,
    });

    expect(fetchImage).toHaveBeenCalledTimes(2);
    expect(result.files).toHaveLength(1);
    const name = result.files[0].name;
    expect(name).toMatch(/^teams-img-[0-9a-f]{16}\.jpg$/);
    for (const stamped of result.sections[0].messages) {
      expect(stamped.text).toBe(`[image: ${name}]`);
    }
  });

  it("leaves the marker alone when the fetch fails or the image is oversized", async () => {
    const fetchImage = vi.fn((_section, requested: string) =>
      requested.includes("big")
        ? Promise.resolve({
            bytes: new ArrayBuffer(MAX_IMAGE_BYTES + 1),
            contentType: "image/png",
          })
        : Promise.resolve(null),
    );
    const onFetched = vi.fn();
    const sections = [
      section([
        message({
          text: "[image] [image]",
          imageUrls: [url("gone"), url("big")],
        }),
      ]),
    ];

    const result = await collectTeamsMessageAssets({
      sections,
      fetchImage,
      downloadFile: null,
      onFetched,
    });

    expect(result.files).toEqual([]);
    expect(result.sections[0].messages[0].text).toBe("[image] [image]");
    // Progress accounting: exactly once per planned fetch, success or not.
    expect(onFetched).toHaveBeenCalledTimes(2);
  });
});

describe("shared files", () => {
  const fileRef = (name: string, contentUrl: string) => ({
    attachmentId: `att-${name}`,
    name,
    contentUrl,
  });
  const okDownload = (text: string, contentType = "application/pdf") =>
    Promise.resolve({
      state: "ok" as const,
      content: { bytes: bytesOf(text), contentType },
    });

  it("counts files in the plan only when the grant exists", () => {
    const sections = [
      section([
        message({
          imageUrls: [url("a")],
          sharedFiles: [fileRef("plan.pdf", "https://c.sharepoint.com/p")],
        }),
      ]),
    ];
    expect(planTeamsAssetFetches(sections, false)).toBe(1);
    expect(planTeamsAssetFetches(sections, true)).toBe(2);
  });

  it("stamps the inline marker and the appended marker with the upload name", async () => {
    const downloadFile = vi.fn(() => okDownload("pdf-bytes"));
    const sections = [
      section([
        message({
          // Referenced in the body: the marker sits inline.
          text: "see [attachment: Q3 Plan.docx]",
          sharedFiles: [fileRef("Q3 Plan.docx", "https://c.sharepoint.com/q3")],
        }),
        message({
          messageId: "m2",
          // Never referenced: the marker was appended after the text.
          text: "and this",
          markers: ["[attachment: notes.pdf]"],
          sharedFiles: [fileRef("notes.pdf", "https://c.sharepoint.com/notes")],
        }),
      ]),
    ];

    const result = await collectTeamsMessageAssets({
      sections,
      fetchImage: () => Promise.resolve(null),
      downloadFile,
    });

    // Identical bytes behind both urls dedupe to one upload.
    expect(result.files).toHaveLength(1);
    const name = result.files[0].name;
    expect(name).toMatch(/^teams-file-[0-9a-f]{8}-Q3_Plan\.docx$/);
    // The uploaded name replaces the Teams-side one: it ends with the same
    // filename, and the backend joins the parsed upload by it.
    expect(result.sections[0].messages[0].text).toBe(
      `see [attachment: ${name}]`,
    );
    expect(result.sections[0].messages[1].markers).toEqual([
      `[attachment: ${name}]`,
    ]);
  });

  it("discloses a file refused for size instead of staying silent", async () => {
    const downloadFile = vi.fn(() =>
      Promise.resolve({ state: "too-large" as const }),
    );
    const sections = [
      section([
        message({
          text: "see [attachment: video.mp4]",
          sharedFiles: [fileRef("video.mp4", "https://c.sharepoint.com/v")],
        }),
      ]),
    ];

    const result = await collectTeamsMessageAssets({
      sections,
      fetchImage: () => Promise.resolve(null),
      downloadFile,
    });

    expect(result.files).toEqual([]);
    expect(result.sections[0].messages[0].text).toBe(
      "see [attachment: video.mp4 — too large to attach]",
    );
  });

  it("leaves markers untouched without the file grant", async () => {
    const sections = [
      section([
        message({
          text: "see [attachment: plan.pdf]",
          sharedFiles: [fileRef("plan.pdf", "https://c.sharepoint.com/p")],
        }),
      ]),
    ];

    const result = await collectTeamsMessageAssets({
      sections,
      fetchImage: () => Promise.resolve(null),
      downloadFile: null,
    });

    expect(result.files).toEqual([]);
    expect(result.sections[0].messages[0].text).toBe(
      "see [attachment: plan.pdf]",
    );
  });

  it("hands the deployment's upload limit to the download as the per-file cap", async () => {
    const downloadFile = vi.fn(() => okDownload("x"));
    const sections = [
      section([
        message({
          sharedFiles: [fileRef("big.pdf", "https://c.sharepoint.com/big")],
        }),
      ]),
    ];

    await collectTeamsMessageAssets({
      sections,
      fetchImage: () => Promise.resolve(null),
      downloadFile,
      maxFileBytes: 50 * 1024 * 1024,
    });

    expect(downloadFile).toHaveBeenCalledWith(
      expect.anything(),
      50 * 1024 * 1024,
    );
  });

  it("caps the number of files it will download", async () => {
    const downloadFile = vi.fn(() => okDownload("x"));
    const refs = Array.from({ length: MAX_TRANSCRIPT_FILES + 3 }, (_, i) =>
      fileRef(`f${i}.pdf`, `https://c.sharepoint.com/f${i}`),
    );
    const sections = [section([message({ sharedFiles: refs })])];

    await collectTeamsMessageAssets({
      sections,
      fetchImage: () => Promise.resolve(null),
      downloadFile,
    });

    expect(downloadFile).toHaveBeenCalledTimes(MAX_TRANSCRIPT_FILES);
  });
});
