import { describe, expect, it, vi } from "vitest";

import { MOCK_CHAT_ID } from "../../../test/mocks/teams/graph";
import {
  MAX_IMAGE_BYTES,
  MAX_TRANSCRIPT_IMAGES,
  collectTeamsImageAssets,
  planTeamsImageFetches,
  stampImageMarkers,
} from "../teamsTranscriptAssets";

import type { TeamsTranscriptSection } from "../buildTeamsTranscriptFile";
import type { ParsedTeamsChat, ParsedTeamsMessage } from "../parsedTeamsChat";

const chat: ParsedTeamsChat = {
  chatId: MOCK_CHAT_ID,
  title: "Product sync",
  participants: [],
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
    ).toBe("a [image] b [image: attached as teams-img-1.png] c");
  });

  it("returns the text unchanged with nothing to stamp", () => {
    expect(stampImageMarkers("[image]", [null])).toBe("[image]");
  });
});

describe("planTeamsImageFetches", () => {
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
    expect(planTeamsImageFetches(sections)).toBe(MAX_TRANSCRIPT_IMAGES);
  });
});

describe("collectTeamsImageAssets", () => {
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

    const result = await collectTeamsImageAssets({ sections, fetchImage });

    expect(fetchImage).toHaveBeenCalledTimes(2);
    expect(result.files).toHaveLength(1);
    const name = result.files[0].name;
    expect(name).toMatch(/^teams-img-[0-9a-f]{16}\.jpg$/);
    for (const stamped of result.sections[0].messages) {
      expect(stamped.text).toBe(`[image: attached as ${name}]`);
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

    const result = await collectTeamsImageAssets({
      sections,
      fetchImage,
      onFetched,
    });

    expect(result.files).toEqual([]);
    expect(result.sections[0].messages[0].text).toBe("[image] [image]");
    // Progress accounting: exactly once per planned fetch, success or not.
    expect(onFetched).toHaveBeenCalledTimes(2);
  });
});
