import { parseTeamsTranscriptIndex } from "@erato/frontend/library";
import { describe, expect, it } from "vitest";

import { MOCK_CHAT_ID } from "../../../test/mocks/teams/graph";
import {
  buildTeamsTranscriptDocument,
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
  selfDisplayName: null,
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

const ordinalsOf = (markdown: string): number[] =>
  [...markdown.matchAll(/^\[(\d+)\] /gm)].map((match) => Number(match[1]));

/** The transcript minus its index block — what the backend leaves for the model. */
const proseOf = (markdown: string): string =>
  markdown.slice(0, markdown.lastIndexOf("<!--"));

/** What the model reads carries no way to address a message but its ordinal. */
function expectNoIdentifiers(markdown: string, messageIds: string[]): void {
  const prose = proseOf(markdown);
  expect(prose).not.toContain("teams.microsoft.com");
  expect(prose).not.toContain(MOCK_CHAT_ID);
  expect(prose).not.toContain(encodeURIComponent(MOCK_CHAT_ID));
  for (const messageId of messageIds) {
    expect(prose).not.toContain(messageId);
  }
}

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

  it("cites messages by ordinal in a whole-chat ingest, never by id or link", () => {
    const markdown = render([
      section({
        messages: [
          message({ messageId: "1754983230123" }),
          message({ messageId: "1754983321123" }),
        ],
      }),
    ]);
    expect(markdown).toContain("[1] Ada Lovelace (09:14):");
    expect(markdown).toContain("[2] Ada Lovelace (09:14):");
    expectNoIdentifiers(markdown, ["1754983230123", "1754983321123"]);
  });

  it("cites hand-picked messages by ordinal, never by deep link", () => {
    const markdown = render([
      section({
        selection: "messages",
        messages: [message({ messageId: "1754983230123" })],
      }),
    ]);
    expect(markdown).toContain("[1] Ada Lovelace (09:14):");
    expect(markdown).toContain("Included: 1 selected message.");
    expectNoIdentifiers(markdown, ["1754983230123"]);
  });

  it("numbers messages contiguously from 1 across every section", () => {
    const markdown = render([
      section({
        messages: [message({ messageId: "b" }), message({ messageId: "a" })],
      }),
      section({
        selection: "messages",
        chat: { ...chat, chatId: "19:other@thread.v2", title: "Other" },
        messages: [message({ messageId: "c" })],
      }),
    ]);
    expect(ordinalsOf(markdown)).toEqual([1, 2, 3]);
  });

  it("assigns the same ordinals when the same input is rendered again", () => {
    const sections = () => [
      section({
        messages: [
          message({ messageId: "b", createdAt: "2026-03-04T10:00:00Z" }),
          message({ messageId: "a", createdAt: "2026-03-03T09:14:00Z" }),
        ],
      }),
    ];
    expect(render(sections())).toBe(render(sections()));
    expect(ordinalsOf(render(sections()))).toEqual([1, 2]);
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
    expect(markdown).toContain("[1] Ada Lovelace (09:14, edited):");
  });

  it("carries a chat message's subject in its heading", () => {
    const markdown = render([
      section({ messages: [message({ subject: "Thursday sync" })] }),
    ]);
    expect(markdown).toContain(
      "[1] Ada Lovelace (09:14, Subject: Thursday sync):",
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

  it("names the viewer beside the participants of a 1:1", () => {
    const markdown = render([
      section({
        chat: {
          ...chat,
          chatType: "oneOnOne",
          title: "Ada Lovelace",
          participants: ["Ada Lovelace"],
          selfDisplayName: "Grace Hopper",
        },
      }),
    ]);
    expect(markdown).toContain("Participants: Ada Lovelace");
    expect(markdown).toContain("Viewer: Grace Hopper (the signed-in user).");
  });

  it("omits the viewer legend when the roster never matched the signed-in user", () => {
    expect(render([section()])).not.toContain("Viewer:");
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

describe("transcript index block", () => {
  const build = (sections: TeamsTranscriptSection[]) => {
    const document = buildTeamsTranscriptDocument({
      sections,
      exportedAt,
      timeZone: "UTC",
    });
    if (!document) throw new Error("expected a transcript");
    return document;
  };

  it("recovers the index it serialized", () => {
    const { markdown, index } = build([
      section({
        messages: [
          message({ messageId: "b", createdAt: "2026-03-04T10:00:00Z" }),
          message({ messageId: "a", subject: "Thursday sync" }),
        ],
      }),
      channelSection([message({ messageId: "c", chatId: "team-1/chan-1" })], {
        selection: "messages",
        limit: undefined,
        skippedCount: 1,
      }),
    ]);
    expect(parseTeamsTranscriptIndex(markdown)).toEqual(index);
  });

  it("sits at the end of the file, on one line", () => {
    const { markdown } = build([section()]);
    const block = markdown.slice(markdown.lastIndexOf("<!--")).trimEnd();
    expect(block.startsWith("<!-- erato:teams-transcript v1 ")).toBe(true);
    expect(block.endsWith("-->")).toBe(true);
    expect(block).not.toContain("\n");
  });

  it("carries the identifiers the prose drops", () => {
    const { index } = build([
      section({
        messages: [message({ messageId: "1754983230123" })],
      }),
    ]);
    expect(index.sections[0].ref).toEqual({
      kind: "chat",
      chatId: MOCK_CHAT_ID,
    });
    expect(index.messages[0].ref).toEqual({
      conversation: { kind: "chat", chatId: MOCK_CHAT_ID },
      messageId: "1754983230123",
      parentMessageId: null,
    });
    expect(index.messages[0].deepLink).toContain("teams.microsoft.com");
  });

  it("addresses a channel reply by team, channel and its root", () => {
    const { index } = build([
      channelSection([
        message({ messageId: "root-a", createdAt: "2026-08-01T09:00:00Z" }),
        message({
          messageId: "reply-a1",
          createdAt: "2026-08-01T09:05:00Z",
          replyToId: "root-a",
        }),
      ]),
    ]);
    expect(index.messages[1].ref).toEqual({
      conversation: { kind: "channel", teamId: "team-1", channelId: "chan-1" },
      messageId: "reply-a1",
      parentMessageId: "root-a",
    });
  });

  it("numbers the index entries as the prose cites them", () => {
    const { markdown, index } = build([
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
      ]),
    ]);
    // Threads are rendered oldest-opener-first, so the index must agree.
    expect(index.messages.map((entry) => entry.ordinal)).toEqual([1, 2]);
    expect(index.messages.map((entry) => entry.text)).toEqual([
      "older opener",
      "newer opener",
    ]);
    expect(ordinalsOf(proseOf(markdown))).toEqual([1, 2]);
  });

  it("names the uploads a message carries", () => {
    const { index } = build([
      section({
        messages: [
          message({
            text: "see [image: teams-img-0123456789abcdef.png]",
            markers: ["[attachment: teams-file-0123abcd-agenda.docx]"],
            sharedFiles: [
              {
                attachmentId: "a1",
                name: "agenda.docx",
                contentUrl: "https://contoso.sharepoint.com/agenda.docx",
              },
            ],
          }),
        ],
      }),
    ]);
    // The minted name is the join key; the name Teams gave the file rides
    // beside it so no reader has to show a content hash. A pasted image never
    // had a name of its own.
    expect(index.messages[0].assets).toEqual([
      {
        name: "teams-img-0123456789abcdef.png",
        displayName: null,
        kind: "image",
      },
      {
        name: "teams-file-0123abcd-agenda.docx",
        displayName: "agenda.docx",
        kind: "file",
      },
    ]);
    expect(index.messages[0].text).toContain("[attachment: teams-file-");
  });

  it("describes what each section contributed", () => {
    const { index } = build([
      section({
        truncated: true,
        messages: [
          message({ messageId: "b", createdAt: "2026-08-10T08:00:00Z" }),
          message({ messageId: "a", createdAt: "2026-03-03T09:14:00Z" }),
        ],
      }),
      channelSection([message({ messageId: "c" })]),
    ]);
    expect(index.sections[0]).toMatchObject({
      kind: "chat",
      title: "Product sync",
      selection: "whole-chat",
      limit: 200,
      truncated: true,
      skippedCount: 0,
      window: { from: "2026-03-03T09:14:00Z", to: "2026-08-10T08:00:00Z" },
      participants: ["Ada Lovelace", "Grace Hopper"],
      viewer: null,
    });
    expect(index.sections[1]).toMatchObject({
      kind: "channel",
      title: "Test Channel 1",
      teamName: "Contoso",
    });
    expect(index.messages.map((entry) => entry.section)).toEqual([0, 0, 1]);
  });

  it("survives a message whose text would close the comment", () => {
    const text = "cases: a --> b, c --- d, and <!-- not a block -->";
    const { markdown, index } = build([
      section({ messages: [message({ text })] }),
    ]);
    expect(parseTeamsTranscriptIndex(markdown)).toEqual(index);
    expect(parseTeamsTranscriptIndex(markdown)?.messages[0].text).toBe(text);
  });

  it("reads no index out of a file that has none, and never throws", () => {
    expect(
      parseTeamsTranscriptIndex("# Teams chat: Product sync\n"),
    ).toBeNull();
    expect(parseTeamsTranscriptIndex("")).toBeNull();
  });

  it("refuses a malformed or unknown-version block", () => {
    const { markdown } = build([section()]);
    const payload = markdown.slice(markdown.lastIndexOf("<!--"));
    expect(
      parseTeamsTranscriptIndex("<!-- erato:teams-transcript v1 {oops -->"),
    ).toBeNull();
    expect(
      parseTeamsTranscriptIndex('<!-- erato:teams-transcript v1 "text" -->'),
    ).toBeNull();
    expect(
      parseTeamsTranscriptIndex(payload.replace('"version":1', '"version":2')),
    ).toBeNull();
    expect(
      parseTeamsTranscriptIndex(
        payload.replace('"ordinal":1', '"ordinal":"1"'),
      ),
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
    expect(markdown).toContain("[2] Ada Lovelace (10 August 2026, 10:30):");
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

  it("names no viewer, a channel having no member roster to match against", () => {
    expect(render([channelSection([message()])])).not.toContain("Viewer:");
  });

  it("cites a picked channel message by ordinal, dropping Graph's own url", () => {
    const markdown = render([
      channelSection(
        [
          message({
            chatId: "team-1/chan-1",
            messageId: "1741000000000",
            deepLink:
              "https://teams.microsoft.com/l/message/19%3Achan%40thread.tacv2/1741000000000" +
              "?tenantId=t1&groupId=g1&parentMessageId=1741000000000",
          }),
        ],
        { selection: "messages", limit: undefined },
      ),
    ]);
    expect(markdown).toContain("[1] Ada Lovelace (09:14):");
    expectNoIdentifiers(markdown, ["1741000000000"]);
    expect(proseOf(markdown)).not.toContain("team-1");
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
      "[1] Ada Lovelace (09:00, Subject: Release checklist):",
    );
    expect(markdown).toContain("[2] Ada Lovelace (09:05):");
    expect(markdown.match(/Subject:/g)).toHaveLength(1);
  });

  it("shows no id and no link when the whole channel is ingested", () => {
    const markdown = render([
      channelSection([message({ messageId: "1741000000000" })]),
    ]);
    expect(markdown).toContain("[1] Ada Lovelace (09:14):");
    expect(markdown).not.toContain("Message links");
    expectNoIdentifiers(markdown, ["1741000000000"]);
  });
});
