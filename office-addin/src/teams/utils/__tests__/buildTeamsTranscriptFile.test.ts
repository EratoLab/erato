import { describe, expect, it } from "vitest";

import { MOCK_CHAT_ID } from "../../../test/mocks/teams/graph";
import {
  buildTeamsTranscriptFile,
  buildTeamsTranscriptMarkdown,
} from "../buildTeamsTranscriptFile";
import { buildTeamsMessageDeepLink } from "../teamsDeepLink";

import type { TeamsTranscriptSection } from "../buildTeamsTranscriptFile";
import type { ParsedTeamsChannel } from "../parsedTeamsChannel";
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
    subject: null,
    text: "Can we move the sync to Thursday?",
    markers: [],
    sharedFiles: [],
    imageUrls: [],
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

const channel: ParsedTeamsChannel = {
  ref: { kind: "channel", teamId: "team-1", channelId: "chan-1" },
  teamId: "team-1",
  channelId: "chan-1",
  name: "Test Channel 1",
  teamName: "Contoso",
  membershipType: "standard",
  isThreaded: true,
};

function channelSection(
  messages: ParsedTeamsMessage[],
  overrides: Partial<Extract<TeamsTranscriptSection, { kind: "channel" }>> = {},
): TeamsTranscriptSection {
  return {
    kind: "channel",
    channel,
    messages,
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
    await expect(file?.text()).resolves.toContain("# Teams chat: Product sync");
  });

  it("keeps the .md name but uploads as plain text", () => {
    const file = buildTeamsTranscriptFile({
      sections: [section()],
      exportedAt,
      timeZone: "UTC",
    });
    expect(file?.name.endsWith(".md")).toBe(true);
    expect(file?.type).toBe("text/plain");
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

  it("carries a chat message's subject in its heading", () => {
    const markdown = render([
      section({ messages: [message({ subject: "Thursday sync" })] }),
    ]);
    expect(markdown).toContain(
      "**Ada Lovelace** — 09:14 · Subject: Thursday sync · id 1741000000000",
    );
  });

  it("emits nothing at all when a message has no subject", () => {
    expect(render([section()])).not.toContain("Subject");
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

describe("channel sections", () => {
  // Wire order: newest root first, each root followed by its replies
  // oldest-first — the flattened shape the channel pager returns.
  const channelWireOrder = [
    message({
      messageId: "root-b",
      createdAt: "2026-08-10T17:51:00Z",
      text: "second thread opener",
    }),
    message({
      messageId: "reply-b1",
      createdAt: "2026-08-10T18:00:00Z",
      replyToId: "root-b",
      text: "answer on b",
    }),
    message({
      messageId: "root-a",
      createdAt: "2026-08-01T09:00:00Z",
      text: "first thread opener",
    }),
    message({
      messageId: "reply-a1",
      createdAt: "2026-08-01T09:05:00Z",
      replyToId: "root-a",
      text: "first answer on a",
    }),
    message({
      messageId: "reply-a2",
      createdAt: "2026-08-01T09:10:00Z",
      replyToId: "root-a",
      text: "second answer on a",
    }),
  ];

  it("renders threads oldest-opener-first, each root before its replies", () => {
    const markdown = render([channelSection(channelWireOrder)]);
    const order = [
      "first thread opener",
      "first answer on a",
      "second answer on a",
      "second thread opener",
      "answer on b",
    ].map((text) => markdown.indexOf(text));
    expect(Math.min(...order)).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("keeps day headings chronological when an old thread has fresh replies", () => {
    const markdown = render([
      channelSection([
        message({
          messageId: "root-new",
          createdAt: "2026-08-09T08:00:00Z",
          text: "newer opener",
        }),
        message({
          messageId: "root-old",
          createdAt: "2026-08-01T09:00:00Z",
          text: "older opener",
        }),
        message({
          messageId: "late-reply",
          createdAt: "2026-08-10T10:30:00Z",
          replyToId: "root-old",
          text: "late reply",
        }),
      ]),
    ]);
    // Headings follow the openers; the late reply never forces "10 August"
    // in front of the 9 August thread.
    expect(markdown.indexOf("## 1 August 2026")).toBeLessThan(
      markdown.indexOf("## 9 August 2026"),
    );
    expect(markdown).not.toContain("## 10 August 2026");
    // The reply's own day is disclosed inline instead.
    expect(markdown).toContain("**Ada Lovelace** — 10 August 2026, 10:30");
  });

  it("anchors a reply whose root is absent at its own timestamp", () => {
    const markdown = render([
      channelSection(
        [
          message({
            messageId: "lone-reply",
            createdAt: "2026-08-05T12:00:00Z",
            replyToId: "missing-root",
            text: "orphan reply",
          }),
          message({
            messageId: "root-x",
            createdAt: "2026-08-06T12:00:00Z",
            text: "later opener",
          }),
        ],
        { selection: "messages", limit: undefined },
      ),
    ]);
    expect(markdown.indexOf("orphan reply")).toBeLessThan(
      markdown.indexOf("later opener"),
    );
  });

  it("titles the section with the channel and its team", () => {
    const markdown = render([channelSection([message()])]);
    expect(markdown).toContain("# Teams channel: Test Channel 1 · Contoso");
  });

  it("links a picked channel message by Graph's own url", () => {
    const webUrl =
      "https://teams.microsoft.com/l/message/19%3Achan%40thread.tacv2/1741000000000" +
      "?tenantId=t1&groupId=g1&parentMessageId=1741000000000";
    const markdown = render([
      channelSection(
        [
          message({
            chatId: "team-1/chan-1",
            deepLink: webUrl,
          }),
        ],
        { selection: "messages", limit: undefined },
      ),
    ]);
    expect(markdown).toContain(`· ${webUrl}`);
    // The team/channel pair is not a chat id, so nothing may address it as one.
    expect(markdown).not.toContain("team-1%2Fchan-1");
  });

  it("carries a channel post's subject and leaves its subjectless replies bare", () => {
    const markdown = render([
      channelSection([
        message({
          messageId: "root-a",
          createdAt: "2026-08-01T09:00:00Z",
          subject: "Release checklist",
          text: "opener",
        }),
        message({
          messageId: "reply-a1",
          createdAt: "2026-08-01T09:05:00Z",
          replyToId: "root-a",
          text: "answer",
        }),
      ]),
    ]);
    expect(markdown).toContain(
      "**Ada Lovelace** — 09:00 · Subject: Release checklist · id root-a",
    );
    expect(markdown).toContain("**Ada Lovelace** — 09:05 · id reply-a1");
    expect(markdown.match(/Subject:/g)).toHaveLength(1);
  });

  it("says the ids are not links when the whole channel is ingested", () => {
    const markdown = render([channelSection([message({ messageId: "a" })])]);
    expect(markdown).toContain(
      "Message links: not reconstructible for a whole channel — each message shows its Teams message id instead.",
    );
    expect(markdown).toContain("· id a");
  });
});
