import { describe, expect, it, vi } from "vitest";

import {
  MOCK_CHAT_ID,
  mockGraphChat,
  mockGraphChatMessage,
} from "../../../test/mocks/teams/graph";
import { collectTeamsTranscript } from "../collectTeamsTranscript";
import { parseTeamsChat } from "../parsedTeamsChat";
import { channelRef, chatRef } from "../teamsConversationRef";

import type { ParsedTeamsChat } from "../parsedTeamsChat";
import type {
  TeamsChannelFetcher,
  TeamsChatFetcher,
} from "../teamsChatFetcher";
import type { TeamsMessageSelection } from "../teamsChatSelection";

const OTHER_CHAT_ID = "19:def456@thread.v2";

const knownChats = new Map<string, ParsedTeamsChat>([
  [MOCK_CHAT_ID, parseTeamsChat(mockGraphChat())!],
]);

function fakeChannelFetcher(overrides: Partial<TeamsChannelFetcher> = {}) {
  const fetcher: TeamsChannelFetcher = {
    listJoinedTeams: vi.fn(() =>
      Promise.resolve({ teams: [], state: "ok" as const }),
    ),
    listChannels: vi.fn(() =>
      Promise.resolve({ channels: [], state: "ok" as const }),
    ),
    listMessagesPage: vi.fn(() =>
      Promise.resolve({ messages: [], nextLink: null, status: 200, ok: true }),
    ),
    probeMessage: vi.fn(() => Promise.resolve({ message: null, status: 404 })),
    getHostedContent: vi.fn(() => Promise.resolve(null)),
    getReply: vi.fn(() => Promise.resolve(null)),
    pageChannelBackwards: vi.fn(() =>
      Promise.resolve({
        messages: [],
        nextLink: null,
        truncated: false,
        oldestCreatedDateTime: null,
        state: "ok" as const,
      }),
    ),
    ...overrides,
  };
  return fetcher;
}

function fakeFetcher(overrides: Partial<TeamsChatFetcher> = {}) {
  const fetcher: TeamsChatFetcher = {
    listChats: vi.fn(() =>
      Promise.resolve({ chats: [], nextLink: null, state: "ok" as const }),
    ),
    getChat: vi.fn(() => Promise.resolve(null)),
    listMessagesPage: vi.fn(() =>
      Promise.resolve({ messages: [], nextLink: null, status: 200, ok: true }),
    ),
    searchMessages: vi.fn(() =>
      Promise.resolve({
        hits: [],
        moreResultsAvailable: false,
        nextFrom: 0,
        state: "ok" as const,
      }),
    ),
    pageChatBackwards: vi.fn(() =>
      Promise.resolve({
        messages: [],
        nextLink: null,
        truncated: false,
        oldestCreatedDateTime: null,
        state: "ok" as const,
      }),
    ),
    getMessage: vi.fn(() => Promise.resolve(null)),
    getHostedContent: vi.fn(() => Promise.resolve(null)),
    ...overrides,
  };
  return fetcher;
}

const messageSelection = (
  messageId: string,
  chatId = MOCK_CHAT_ID,
): TeamsMessageSelection => ({
  kind: "message",
  ref: chatRef(chatId),
  messageId,
  conversationTitle: "Product sync",
  senderName: "Ada Lovelace",
  createdAt: "2026-03-03T09:14:00Z",
});

describe("collectTeamsTranscript", () => {
  it("hydrates a selected search hit by (chatId, messageId) — the hit carried no body", async () => {
    const getMessage = vi.fn((chatId: string, messageId: string) =>
      Promise.resolve(
        mockGraphChatMessage({
          id: messageId,
          chatId,
          body: { contentType: "text", content: "the real body" },
        }),
      ),
    );

    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher({ getMessage }),
      selections: [messageSelection("1741000000000")],
      knownChats,
    });

    expect(getMessage).toHaveBeenCalledTimes(1);
    expect(getMessage).toHaveBeenCalledWith(
      MOCK_CHAT_ID,
      "1741000000000",
      expect.anything(),
    );
    expect(result.sections[0].messages[0].text).toBe("the real body");
    expect(result.sections[0].selection).toBe("messages");
    expect(result.state).toBe("ok");
  });

  it("attaches a cached body without spending a request on it", async () => {
    const getMessage = vi.fn(() => Promise.resolve(null));
    const totals: number[] = [];

    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher({ getMessage }),
      selections: [
        {
          ...messageSelection("a"),
          message: {
            chatId: MOCK_CHAT_ID,
            messageId: "a",
            senderName: "Ada Lovelace",
            createdAt: "2026-03-03T09:14:00Z",
            editedAt: null,
            text: "the body the picker already showed",
            markers: [],
            sharedFiles: [],
            imageUrls: [],
            replyToId: null,
            deepLink: "https://example.invalid/a",
          },
        },
      ],
      knownChats,
      onProgress: (progress) => totals.push(progress.requestsTotal),
    });

    expect(getMessage).not.toHaveBeenCalled();
    expect(result.messageCount).toBe(1);
    expect(result.sections[0].messages[0].text).toBe(
      "the body the picker already showed",
    );
    // The denominator never promised a request that was not going to happen.
    expect(Math.max(...totals)).toBe(0);
  });

  it("skips and counts a message that vanished between search and attach", async () => {
    const getMessage = vi.fn((chatId: string, messageId: string) =>
      Promise.resolve(
        messageId === "gone"
          ? null
          : mockGraphChatMessage({ id: messageId, chatId }),
      ),
    );

    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher({ getMessage }),
      selections: [messageSelection("alive"), messageSelection("gone")],
      knownChats,
    });

    expect(result.skippedCount).toBe(1);
    expect(result.messageCount).toBe(1);
    expect(result.state).toBe("partial");
    expect(result.sections[0].skippedCount).toBe(1);
  });

  it("pages a whole-chat selection instead of hydrating message by message", async () => {
    const pageChatBackwards = vi.fn(() =>
      Promise.resolve({
        messages: [
          mockGraphChatMessage({ id: "a" }),
          mockGraphChatMessage({ id: "b" }),
        ],
        nextLink: "https://graph.microsoft.com/v1.0/next",
        truncated: true,
        oldestCreatedDateTime: "2026-03-03T09:14:00Z",
        state: "ok" as const,
      }),
    );
    const getMessage = vi.fn(() => Promise.resolve(null));

    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher({ pageChatBackwards, getMessage }),
      selections: [
        {
          kind: "conversation",
          ref: chatRef(MOCK_CHAT_ID),
          title: "Product sync",
        },
      ],
      knownChats,
      limit: 200,
    });

    expect(getMessage).not.toHaveBeenCalled();
    expect(pageChatBackwards).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: MOCK_CHAT_ID, limit: 200 }),
    );
    expect(result.sections[0].selection).toBe("whole-chat");
    // A surviving nextLink is the only signal the window was truncated.
    expect(result.sections[0].truncated).toBe(true);
  });

  it("folds individual ticks into the whole-chat ingest of the same chat", async () => {
    const pageChatBackwards = vi.fn(() =>
      Promise.resolve({
        messages: [mockGraphChatMessage({ id: "a" })],
        nextLink: null,
        truncated: false,
        oldestCreatedDateTime: "2026-03-03T09:14:00Z",
        state: "ok" as const,
      }),
    );
    const getMessage = vi.fn(() => Promise.resolve(null));

    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher({ pageChatBackwards, getMessage }),
      selections: [
        {
          kind: "conversation",
          ref: chatRef(MOCK_CHAT_ID),
          title: "Product sync",
        },
        messageSelection("a"),
      ],
      knownChats,
    });

    expect(getMessage).not.toHaveBeenCalled();
    expect(result.sections).toHaveLength(1);
  });

  it("resolves a chat outside the browse cache rather than labelling it generically", async () => {
    const getChat = vi.fn(() =>
      Promise.resolve(
        mockGraphChat({ id: OTHER_CHAT_ID, topic: "Release train" }),
      ),
    );
    const getMessage = vi.fn((chatId: string, messageId: string) =>
      Promise.resolve(mockGraphChatMessage({ id: messageId, chatId })),
    );

    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher({ getChat, getMessage }),
      selections: [messageSelection("x", OTHER_CHAT_ID)],
      knownChats,
    });

    expect(getChat).toHaveBeenCalledWith(OTHER_CHAT_ID, expect.anything());
    const first = result.sections[0];
    expect(first?.kind === "chat" && first.chat.title).toBe("Release train");
  });

  it("reports progress against a request denominator known before fetching", async () => {
    const getMessage = vi.fn((chatId: string, messageId: string) =>
      Promise.resolve(mockGraphChatMessage({ id: messageId, chatId })),
    );
    const seen: Array<{ completed: number; total: number }> = [];

    await collectTeamsTranscript({
      fetcher: fakeFetcher({ getMessage }),
      selections: [messageSelection("a"), messageSelection("b")],
      knownChats,
      onProgress: (progress) =>
        seen.push({
          completed: progress.requestsCompleted,
          total: progress.requestsTotal,
        }),
    });

    expect(seen[0]).toEqual({ completed: 0, total: 2 });
    expect(seen[seen.length - 1]).toEqual({ completed: 2, total: 2 });
    expect(seen.map((entry) => entry.completed)).toEqual(
      [...seen.map((entry) => entry.completed)].sort((a, b) => a - b),
    );
  });

  it("fetches pasted images and stamps their markers with the upload name", async () => {
    const hosted = `https://graph.microsoft.com/v1.0/chats/x/messages/1/hostedContents/aWQ9/$value`;
    const pageChatBackwards = vi.fn(() =>
      Promise.resolve({
        messages: [
          mockGraphChatMessage({
            id: "a",
            body: {
              contentType: "html" as const,
              content: `<p>see this</p><img src="${hosted}">`,
            },
          }),
        ],
        nextLink: null,
        truncated: false,
        oldestCreatedDateTime: "2026-03-03T09:14:00Z",
        state: "ok" as const,
      }),
    );
    const getHostedContent = vi.fn(() =>
      Promise.resolve({
        bytes: new TextEncoder().encode("png-bytes").buffer,
        contentType: "image/png",
      }),
    );
    const totals: number[] = [];

    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher({ pageChatBackwards, getHostedContent }),
      selections: [
        {
          kind: "conversation",
          ref: chatRef(MOCK_CHAT_ID),
          title: "Product sync",
        },
      ],
      knownChats,
      onProgress: (progress) => totals.push(progress.requestsTotal),
    });

    expect(getHostedContent).toHaveBeenCalledWith(
      MOCK_CHAT_ID,
      hosted,
      expect.anything(),
    );
    expect(result.assetFiles).toHaveLength(1);
    const name = result.assetFiles[0].name;
    expect(name).toMatch(/^teams-img-[0-9a-f]{16}\.png$/);
    expect(result.sections[0].messages[0].text).toContain(
      `[image: attached as ${name}]`,
    );
    // The denominator grows by the image fetch once its count is known.
    expect(Math.max(...totals)).toBe(Math.min(...totals) + 1);
  });

  it("downloads shared files when the grant exists and stamps their markers", async () => {
    const pageChatBackwards = vi.fn(() =>
      Promise.resolve({
        messages: [
          mockGraphChatMessage({
            id: "a",
            body: { contentType: "text" as const, content: "see the plan" },
            attachments: [
              {
                id: "att-1",
                contentType: "reference",
                name: "Q3 Plan.docx",
                contentUrl: "https://contoso.sharepoint.com/q3",
              },
            ],
          }),
        ],
        nextLink: null,
        truncated: false,
        oldestCreatedDateTime: "2026-03-03T09:14:00Z",
        state: "ok" as const,
      }),
    );
    const downloadSharedFile = vi.fn(() =>
      Promise.resolve({
        state: "ok" as const,
        content: {
          bytes: new TextEncoder().encode("docx-bytes").buffer,
          contentType: "application/vnd.openxmlformats",
        },
      }),
    );

    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher({ pageChatBackwards }),
      fileFetcher: { downloadSharedFile },
      selections: [
        {
          kind: "conversation",
          ref: chatRef(MOCK_CHAT_ID),
          title: "Product sync",
        },
      ],
      knownChats,
    });

    expect(downloadSharedFile).toHaveBeenCalledWith(
      "https://contoso.sharepoint.com/q3",
      expect.any(Number),
      expect.anything(),
    );
    expect(result.assetFiles).toHaveLength(1);
    const name = result.assetFiles[0].name;
    expect(name).toMatch(/^teams-file-[0-9a-f]{8}-Q3_Plan\.docx$/);
    expect(result.sections[0].messages[0].markers).toEqual([
      `[attachment: Q3 Plan.docx — attached as ${name}]`,
    ]);
  });

  it("leaves file markers bare without the file grant", async () => {
    const pageChatBackwards = vi.fn(() =>
      Promise.resolve({
        messages: [
          mockGraphChatMessage({
            id: "a",
            body: { contentType: "text" as const, content: "see the plan" },
            attachments: [
              {
                id: "att-1",
                contentType: "reference",
                name: "Q3 Plan.docx",
                contentUrl: "https://contoso.sharepoint.com/q3",
              },
            ],
          }),
        ],
        nextLink: null,
        truncated: false,
        oldestCreatedDateTime: "2026-03-03T09:14:00Z",
        state: "ok" as const,
      }),
    );

    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher({ pageChatBackwards }),
      selections: [
        {
          kind: "conversation",
          ref: chatRef(MOCK_CHAT_ID),
          title: "Product sync",
        },
      ],
      knownChats,
    });

    expect(result.assetFiles).toEqual([]);
    expect(result.sections[0].messages[0].markers).toEqual([
      "[attachment: Q3 Plan.docx]",
    ]);
  });

  it("names a conversation while it is being fetched and clears it after", async () => {
    const getMessage = vi.fn((chatId: string, messageId: string) =>
      Promise.resolve(mockGraphChatMessage({ id: messageId, chatId })),
    );
    const seen: string[][] = [];

    await collectTeamsTranscript({
      fetcher: fakeFetcher({ getMessage }),
      selections: [messageSelection("a")],
      knownChats,
      onProgress: (progress) => seen.push(progress.inFlightTitles),
    });

    expect(seen.some((titles) => titles.includes("Product sync"))).toBe(true);
    expect(seen[seen.length - 1]).toEqual([]);
  });

  it("counts messages as the whole-chat walk reports them", async () => {
    const pageChatBackwards = vi.fn(
      (args: Parameters<TeamsChatFetcher["pageChatBackwards"]>[0]) => {
        args.onProgress?.({
          conversationKey: args.chatId,
          fetched: 1,
          limit: 200,
          oldestCreatedDateTime: "2026-03-03T09:14:00Z",
        });
        args.onProgress?.({
          conversationKey: args.chatId,
          fetched: 2,
          limit: 200,
          oldestCreatedDateTime: "2026-03-01T09:14:00Z",
        });
        return Promise.resolve({
          messages: [
            mockGraphChatMessage({ id: "a" }),
            mockGraphChatMessage({ id: "b" }),
          ],
          nextLink: null,
          truncated: false,
          oldestCreatedDateTime: "2026-03-01T09:14:00Z",
          state: "ok" as const,
        });
      },
    ) as TeamsChatFetcher["pageChatBackwards"];
    const seen: number[] = [];

    await collectTeamsTranscript({
      fetcher: fakeFetcher({ pageChatBackwards }),
      selections: [
        {
          kind: "conversation",
          ref: chatRef(MOCK_CHAT_ID),
          title: "Product sync",
        },
      ],
      knownChats,
      onProgress: (progress) => seen.push(progress.messagesFetched),
    });

    // The second 0 is the task-start emit that begins naming the conversation.
    expect(seen).toEqual([0, 0, 1, 2, 2]);
  });

  it("keeps the chats that landed when one fails", async () => {
    const pageChatBackwards = vi.fn((args: { chatId: string }) =>
      args.chatId === MOCK_CHAT_ID
        ? Promise.resolve({
            messages: [mockGraphChatMessage({ id: "a" })],
            nextLink: null,
            truncated: false,
            oldestCreatedDateTime: "2026-03-03T09:14:00Z",
            state: "ok" as const,
          })
        : Promise.reject(new Error("throttled out")),
    ) as TeamsChatFetcher["pageChatBackwards"];

    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher({ pageChatBackwards }),
      selections: [
        {
          kind: "conversation",
          ref: chatRef(MOCK_CHAT_ID),
          title: "Product sync",
        },
        {
          kind: "conversation",
          ref: chatRef(OTHER_CHAT_ID),
          title: "Release train",
        },
      ],
      knownChats,
    });

    expect(result.sections).toHaveLength(1);
    expect(result.state).toBe("partial");
    expect(result.chatsTotal).toBe(2);
  });

  it("reports an error state when nothing renderable survived", async () => {
    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher(),
      selections: [messageSelection("gone")],
      knownChats,
    });

    expect(result.sections).toEqual([]);
    expect(result.state).toBe("error");
  });
});

describe("channels", () => {
  const channelSelection = {
    kind: "conversation" as const,
    ref: channelRef("team-1", "chan-1"),
    title: "Test Channel 1",
  };

  it("pages a whole channel under the same recency limit as a chat", async () => {
    const pageChannelBackwards = vi.fn(() =>
      Promise.resolve({
        messages: [mockGraphChatMessage({ id: "chan-msg-1" })],
        nextLink: "more",
        truncated: true,
        oldestCreatedDateTime: "2026-08-10T09:15:00Z",
        state: "ok" as const,
      }),
    );

    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher(),
      channelFetcher: fakeChannelFetcher({ pageChannelBackwards }),
      selections: [channelSelection],
      limit: 200,
    });

    expect(pageChannelBackwards).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-1",
        channelId: "chan-1",
        limit: 200,
      }),
    );
    const section = result.sections[0];
    expect(section?.kind).toBe("channel");
    // nextLink present means older history was left behind, not lost silently.
    expect(section?.truncated).toBe(true);
    expect(result.messageCount).toBe(1);
  });

  it("fetches a ticked reply under its parent, which is the only way it resolves", async () => {
    // Proven against a live tenant: GET .../messages/{replyId} is a 404, while
    // the same id under .../messages/{parentId}/replies/{replyId} resolves.
    const probeMessage = vi.fn(() =>
      Promise.resolve({ message: null, status: 404 }),
    );
    const getReply = vi.fn(() =>
      Promise.resolve(mockGraphChatMessage({ id: "reply-1" })),
    );

    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher(),
      channelFetcher: fakeChannelFetcher({ probeMessage, getReply }),
      selections: [
        {
          kind: "message",
          ref: channelRef("team-1", "chan-1"),
          messageId: "reply-1",
          parentMessageId: "root-1",
          conversationTitle: "Test Channel 1",
          senderName: "Max Token",
          createdAt: "2026-08-11T10:00:00Z",
        },
      ],
    });

    expect(getReply).toHaveBeenCalledWith(
      "team-1",
      "chan-1",
      "root-1",
      "reply-1",
      expect.anything(),
    );
    expect(probeMessage).not.toHaveBeenCalled();
    expect(result.messageCount).toBe(1);
  });

  it("fetches a ticked root at the top-level path", async () => {
    const probeMessage = vi.fn(() =>
      Promise.resolve({
        message: mockGraphChatMessage({ id: "root-1" }),
        status: 200,
      }),
    );
    const getReply = vi.fn(() => Promise.resolve(null));

    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher(),
      channelFetcher: fakeChannelFetcher({ probeMessage, getReply }),
      selections: [
        {
          kind: "message",
          ref: channelRef("team-1", "chan-1"),
          messageId: "root-1",
          parentMessageId: null,
          conversationTitle: "Test Channel 1",
          senderName: "Max Token",
          createdAt: "2026-08-11T10:00:00Z",
        },
      ],
    });

    expect(probeMessage).toHaveBeenCalledWith(
      "team-1",
      "chan-1",
      "root-1",
      expect.anything(),
    );
    expect(getReply).not.toHaveBeenCalled();
    expect(result.messageCount).toBe(1);
  });

  it("reports an error instead of an empty channel when consent is missing", async () => {
    const result = await collectTeamsTranscript({
      fetcher: fakeFetcher(),
      channelFetcher: null,
      selections: [channelSelection],
    });

    expect(result.sections).toEqual([]);
    expect(result.state).toBe("error");
  });
});
