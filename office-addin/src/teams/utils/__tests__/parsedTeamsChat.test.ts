import { describe, expect, it } from "vitest";

import {
  MOCK_CHAT_ID,
  mockGraphChat,
  mockGraphChatMessage,
} from "../../../test/mocks/teams/graph";
import {
  chatDisplayTitle,
  isRenderableChatMessage,
  messageSenderName,
  parseTeamsChat,
  parseTeamsMessage,
} from "../parsedTeamsChat";

const me = { userId: "me-1", userPrincipalName: "me@erato.example" };

describe("chatDisplayTitle", () => {
  it("prefers the topic", () => {
    expect(chatDisplayTitle(mockGraphChat({ topic: "Product sync" }), me)).toBe(
      "Product sync",
    );
  });

  it("names a oneOnOne chat after the other member", () => {
    const chat = mockGraphChat({
      topic: null,
      chatType: "oneOnOne",
      members: [
        { id: "m0", displayName: "Me", userId: "me-1" },
        { id: "m1", displayName: "Ada Lovelace", userId: "u1" },
      ],
    });
    expect(chatDisplayTitle(chat, me)).toBe("Ada Lovelace");
  });

  it("excludes the signed-in user by upn as well as id", () => {
    const chat = mockGraphChat({
      topic: null,
      chatType: "oneOnOne",
      members: [
        { id: "m0", displayName: "Me", email: "ME@erato.example" },
        { id: "m1", displayName: "Grace Hopper", userId: "u2" },
      ],
    });
    expect(chatDisplayTitle(chat, me)).toBe("Grace Hopper");
  });

  it("joins group member names and counts the overflow", () => {
    const chat = mockGraphChat({
      topic: null,
      chatType: "group",
      members: [
        { id: "m0", displayName: "Me", userId: "me-1" },
        { id: "m1", displayName: "A", userId: "u1" },
        { id: "m2", displayName: "B", userId: "u2" },
        { id: "m3", displayName: "C", userId: "u3" },
        { id: "m4", displayName: "D", userId: "u4" },
        { id: "m5", displayName: "E", userId: "u5" },
      ],
    });
    expect(chatDisplayTitle(chat, me)).toBe("A, B, C +2 more");
  });

  it("falls back to a generic title with no members to name", () => {
    expect(
      chatDisplayTitle(mockGraphChat({ topic: null, members: [] }), me),
    ).toBe("Chat");
  });
});

describe("parseTeamsChat", () => {
  it("flags a roster that may have hit the members expand cap", () => {
    const members = Array.from({ length: 25 }, (_, index) => ({
      id: `m${index}`,
      displayName: `Member ${index}`,
      userId: `u${index}`,
    }));
    const parsed = parseTeamsChat(mockGraphChat({ members }), me);
    expect(parsed?.participantsTruncated).toBe(true);
    expect(parseTeamsChat(mockGraphChat(), me)?.participantsTruncated).toBe(
      false,
    );
  });

  it("keeps the signed-in user's own roster name", () => {
    const chat = mockGraphChat({
      chatType: "oneOnOne",
      members: [
        { id: "m0", displayName: "Grace Hopper", userId: "me-1" },
        { id: "m1", displayName: "Ada Lovelace", userId: "u1" },
      ],
    });
    const parsed = parseTeamsChat(chat, me);
    expect(parsed?.selfDisplayName).toBe("Grace Hopper");
    expect(parsed?.participants).toEqual(["Ada Lovelace"]);
  });

  it("leaves the self name null when no member matches", () => {
    expect(parseTeamsChat(mockGraphChat(), me)?.selfDisplayName).toBeNull();
    expect(parseTeamsChat(mockGraphChat())?.selfDisplayName).toBeNull();
  });

  it("returns null for a chat with no id", () => {
    expect(parseTeamsChat(mockGraphChat({ id: undefined }))).toBeNull();
  });
});

describe("parseTeamsMessage deep links", () => {
  it("prefers the link Graph supplies, which is the only correct one for a channel", () => {
    const parsed = parseTeamsMessage(
      mockGraphChatMessage({
        id: "m1",
        webUrl: "https://teams.microsoft.com/l/message/19%3Achan/1?groupId=g",
      }),
      "team-1/chan-1",
    );

    expect(parsed?.deepLink).toBe(
      "https://teams.microsoft.com/l/message/19%3Achan/1?groupId=g",
    );
  });

  it("falls back to the constructed chat link when Graph gives none", () => {
    const parsed = parseTeamsMessage(
      mockGraphChatMessage({ id: "m1", webUrl: null }),
      MOCK_CHAT_ID,
    );

    expect(parsed?.deepLink).toContain(encodeURIComponent(MOCK_CHAT_ID));
  });
});

describe("messageSenderName", () => {
  it("prefers the user, then the application, then a placeholder", () => {
    expect(messageSenderName(mockGraphChatMessage())).toBe("Ada Lovelace");
    expect(
      messageSenderName(
        mockGraphChatMessage({
          from: { application: { displayName: "Workflows" } },
        }),
      ),
    ).toBe("Workflows");
    expect(messageSenderName(mockGraphChatMessage({ from: null }))).toBe(
      "Unknown",
    );
  });
});

describe("isRenderableChatMessage", () => {
  it("drops deleted messages and system events", () => {
    expect(
      isRenderableChatMessage(
        mockGraphChatMessage({ deletedDateTime: "2026-03-04T00:00:00Z" }),
      ),
    ).toBe(false);
    expect(
      isRenderableChatMessage(
        mockGraphChatMessage({ messageType: "systemEventMessage" }),
      ),
    ).toBe(false);
    expect(isRenderableChatMessage(mockGraphChatMessage())).toBe(true);
  });
});

describe("parseTeamsMessage", () => {
  it("carries the deep link, the edit marker and the body text", () => {
    const parsed = parseTeamsMessage(
      mockGraphChatMessage({
        lastEditedDateTime: "2026-03-03T09:20:00Z",
        body: { contentType: "html", content: "<p>Works for me.</p>" },
      }),
      MOCK_CHAT_ID,
    );
    expect(parsed).toMatchObject({
      chatId: MOCK_CHAT_ID,
      messageId: "1741000000000",
      senderName: "Ada Lovelace",
      editedAt: "2026-03-03T09:20:00Z",
      text: "Works for me.",
    });
    expect(parsed?.deepLink).toContain("19%3Aabc123%40thread.v2/1741000000000");
  });

  it("trims the subject Graph supplies", () => {
    const parsed = parseTeamsMessage(
      mockGraphChatMessage({ subject: "  Release checklist  " }),
      MOCK_CHAT_ID,
    );
    expect(parsed?.subject).toBe("Release checklist");
  });

  it("treats an absent, null or blank subject as none", () => {
    for (const subject of [undefined, null, "", "   "]) {
      const parsed = parseTeamsMessage(
        mockGraphChatMessage({ subject }),
        MOCK_CHAT_ID,
      );
      expect(parsed?.subject).toBeNull();
    }
  });

  it("discloses an attachment the body never referenced", () => {
    const parsed = parseTeamsMessage(
      mockGraphChatMessage({
        body: { contentType: "text", content: "" },
        attachments: [{ id: "att-1", name: "agenda.docx" }],
      }),
      MOCK_CHAT_ID,
    );
    expect(parsed?.markers).toEqual(["[attachment: agenda.docx]"]);
  });

  it("does not double-disclose an attachment the body already names", () => {
    const parsed = parseTeamsMessage(
      mockGraphChatMessage({
        body: {
          contentType: "html",
          content: '<attachment id="att-1"></attachment>',
        },
        attachments: [{ id: "att-1", name: "agenda.docx" }],
      }),
      MOCK_CHAT_ID,
    );
    expect(parsed?.markers).toEqual([]);
    expect(parsed?.text).toBe("[attachment: agenda.docx]");
  });

  it("returns null for a message with nothing to say", () => {
    expect(
      parseTeamsMessage(
        mockGraphChatMessage({ body: { contentType: "text", content: "  " } }),
        MOCK_CHAT_ID,
      ),
    ).toBeNull();
  });

  it("keeps a shared file as a structured ref, not only a marker", () => {
    const parsed = parseTeamsMessage(
      mockGraphChatMessage({
        body: { contentType: "text", content: "see the plan" },
        attachments: [
          {
            id: "att-1",
            contentType: "reference",
            name: "Q3 Plan.docx",
            contentUrl: "https://contoso.sharepoint.com/sites/x/Q3%20Plan.docx",
          },
          // A card has no file behind it and must not become a ref.
          {
            id: "att-2",
            contentType: "application/vnd.microsoft.card.adaptive",
            name: null,
          },
        ],
      }),
      MOCK_CHAT_ID,
    );
    expect(parsed?.sharedFiles).toEqual([
      {
        attachmentId: "att-1",
        name: "Q3 Plan.docx",
        contentUrl: "https://contoso.sharepoint.com/sites/x/Q3%20Plan.docx",
      },
    ]);
  });

  it("keeps hosted image urls aligned with their [image] markers", () => {
    const hosted = `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(
      MOCK_CHAT_ID,
    )}/messages/1741000000000/hostedContents/aWQ9/$value`;
    const parsed = parseTeamsMessage(
      mockGraphChatMessage({
        body: {
          contentType: "html",
          content: `<img src="https://media.example/sticker.gif"><img src="${hosted}">`,
        },
      }),
      MOCK_CHAT_ID,
    );
    expect(parsed?.text).toBe("[image][image]");
    expect(parsed?.imageUrls).toEqual([null, hosted]);
  });
});
