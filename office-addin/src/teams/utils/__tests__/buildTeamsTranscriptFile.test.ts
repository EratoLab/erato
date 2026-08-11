import { describe, expect, it } from "vitest";

import { MOCK_CHAT_ID } from "../../../test/mocks/teams/graph";
import {
  buildTeamsTranscriptFile,
  buildTeamsTranscriptMarkdown,
} from "../buildTeamsTranscriptFile";
import { buildTeamsMessageDeepLink } from "../teamsDeepLink";

import type { TeamsTranscriptSection } from "../buildTeamsTranscriptFile";
import type { ParsedTeamsChat, ParsedTeamsMessage } from "../parsedTeamsChat";

const chat: ParsedTeamsChat = {
  chatId: MOCK_CHAT_ID,
  title: "Product sync",
  participants: ["Ada Lovelace", "Grace Hopper"],
  participantsTruncated: false,
  chatType: "group",
  lastActivityAt: "2026-08-10T09:15:00Z",
  previewText: "",
};

function message(
  overrides: Partial<ParsedTeamsMessage> = {},
): ParsedTeamsMessage {
  const messageId = overrides.messageId ?? "1741000000000";
  return {
    chatId: MOCK_CHAT_ID,
    messageId,
    senderName: "Ada Lovelace",
    createdAt: "2026-03-03T09:14:00Z",
    editedAt: null,
    text: "Can we move the sync to Thursday?",
    markers: [],
    replyToId: null,
    deepLink: buildTeamsMessageDeepLink(MOCK_CHAT_ID, messageId),
    ...overrides,
  };
}

function section(
  overrides: Partial<Extract<TeamsTranscriptSection, { kind: "chat" }>> = {},
): TeamsTranscriptSection {
  return {
    kind: "chat",
    chat,
    messages: [message()],
    selection: "whole-chat",
    limit: 200,
    ...overrides,
  };
}

const exportedAt = new Date("2026-08-10T14:03:00Z");

const render = (sections: TeamsTranscriptSection[]) =>
  buildTeamsTranscriptMarkdown({ sections, exportedAt, timeZone: "UTC" }) ?? "";

describe("buildTeamsTranscriptFile", () => {
  it("builds a slugged markdown file", async () => {
    const file = buildTeamsTranscriptFile({
      sections: [section()],
      exportedAt,
      timeZone: "UTC",
    });
    expect(file?.name).toBe("teams-Product_sync.md");
    expect(file?.type).toBe("text/markdown");
    await expect(file?.text()).resolves.toContain("# Teams chat: Product sync");
  });

  it("names a multi-chat export by its chat count", () => {
    const file = buildTeamsTranscriptFile({
      sections: [section(), section({ chat: { ...chat, title: "Other" } })],
      exportedAt,
      timeZone: "UTC",
    });
    expect(file?.name).toBe("teams-chats-2.md");
  });

  it("returns null rather than uploading an empty transcript", () => {
    expect(
      buildTeamsTranscriptFile({ sections: [section({ messages: [] })] }),
    ).toBeNull();
  });
});

describe("buildTeamsTranscriptMarkdown", () => {
  it("discloses the window that was actually taken", () => {
    const markdown = render([
      section({
        truncated: true,
        messages: [
          message({ messageId: "b", createdAt: "2026-08-10T08:00:00Z" }),
          message({ messageId: "a", createdAt: "2026-03-03T09:14:00Z" }),
        ],
      }),
    ]);
    expect(markdown).toContain(
      "Included: last 2 messages, 3 March 2026 – 10 August 2026. Older messages were not included.",
    );
  });

  it("says so when the whole chat fit in the window", () => {
    expect(render([section()])).toContain(
      "Included: all 1 messages, 3 March 2026.",
    );
  });

  it("emits the chat-invariant link base once for a whole-chat ingest", () => {
    const markdown = render([
      section({
        messages: [message({ messageId: "a" }), message({ messageId: "b" })],
      }),
    ]);
    expect(markdown).toContain(
      "Message links: https://teams.microsoft.com/l/message/19%3Aabc123%40thread.v2/{id}" +
        "?context=%7B%22contextType%22%3A%22chat%22%7D",
    );
    expect(markdown).toContain("· id a");
    expect(markdown).toContain("· id b");
    // The encoded chat id repeated per message is the transcript's biggest
    // avoidable token cost.
    expect(markdown.match(/19%3Aabc123%40thread\.v2/g)).toHaveLength(1);
  });

  it("emits a full deep link per explicitly selected message", () => {
    const markdown = render([
      section({
        selection: "messages",
        messages: [message({ messageId: "z" })],
      }),
    ]);
    expect(markdown).toContain(buildTeamsMessageDeepLink(MOCK_CHAT_ID, "z"));
    expect(markdown).toContain("Included: 1 selected message.");
  });

  it("groups messages under day headings, oldest first", () => {
    const markdown = render([
      section({
        messages: [
          message({
            messageId: "b",
            createdAt: "2026-03-04T10:00:00Z",
            text: "later",
          }),
          message({
            messageId: "a",
            createdAt: "2026-03-03T09:14:00Z",
            text: "earlier",
          }),
        ],
      }),
    ]);
    expect(markdown.indexOf("## 3 March 2026")).toBeLessThan(
      markdown.indexOf("## 4 March 2026"),
    );
    expect(markdown.indexOf("earlier")).toBeLessThan(markdown.indexOf("later"));
  });

  it("marks an edited message and renders its local time", () => {
    const markdown = render([
      section({ messages: [message({ editedAt: "2026-03-03T09:20:00Z" })] }),
    ]);
    expect(markdown).toContain("**Ada Lovelace** — 09:14 (edited) ·");
  });

  it("keeps attachment markers on their own line", () => {
    const markdown = render([
      section({
        messages: [message({ markers: ["[attachment: agenda.docx]"] })],
      }),
    ]);
    expect(markdown).toContain("\n[attachment: agenda.docx]");
  });

  it("discloses messages that could not be loaded", () => {
    const markdown = render([
      section({ selection: "messages", skippedCount: 2 }),
    ]);
    expect(markdown).toContain("2 messages could not be loaded.");
  });

  it("notes a possibly truncated participant roster", () => {
    const markdown = render([
      section({ chat: { ...chat, participantsTruncated: true } }),
    ]);
    expect(markdown).toContain(
      "Participants: Ada Lovelace, Grace Hopper (and possibly others)",
    );
  });

  it("repeats a full section per chat", () => {
    const markdown = render([
      section(),
      section({
        chat: { ...chat, chatId: "19:other@thread.v2", title: "Other" },
      }),
    ]);
    expect(markdown).toContain("# Teams chat: Product sync");
    expect(markdown).toContain("# Teams chat: Other");
  });

  it("skips sections with no messages and returns null when none remain", () => {
    expect(
      buildTeamsTranscriptMarkdown({ sections: [section({ messages: [] })] }),
    ).toBeNull();
  });
});
