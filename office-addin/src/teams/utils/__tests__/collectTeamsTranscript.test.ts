import { describe, expect, it, vi } from "vitest";

import {
  MOCK_CHAT_ID,
  mockGraphChat,
  mockGraphChatMessage,
} from "../../../test/mocks/teams/graph";
import { collectTeamsTranscript } from "../collectTeamsTranscript";
import { parseTeamsChat } from "../parsedTeamsChat";
import { chatRef } from "../teamsConversationRef";

import type { ParsedTeamsChat } from "../parsedTeamsChat";
import type { TeamsChatFetcher } from "../teamsChatFetcher";
import type { TeamsChatSelection } from "../teamsChatSelection";

const OTHER_CHAT_ID = "19:def456@thread.v2";

const knownChats = new Map<string, ParsedTeamsChat>([
  [MOCK_CHAT_ID, parseTeamsChat(mockGraphChat())!],
]);

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
        oldestCreatedDateTime: null,
        state: "ok" as const,
      }),
    ),
    getMessage: vi.fn(() => Promise.resolve(null)),
    ...overrides,
  };
  return fetcher;
}

const messageSelection = (
  messageId: string,
  chatId = MOCK_CHAT_ID,
): TeamsChatSelection => ({
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
    expect(result.sections[0].chat.title).toBe("Release train");
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

  it("counts messages as the whole-chat walk reports them", async () => {
    const pageChatBackwards = vi.fn(
      (args: Parameters<TeamsChatFetcher["pageChatBackwards"]>[0]) => {
        args.onProgress?.({
          chatId: args.chatId,
          fetched: 1,
          limit: 200,
          oldestCreatedDateTime: "2026-03-03T09:14:00Z",
        });
        args.onProgress?.({
          chatId: args.chatId,
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

    expect(seen).toEqual([0, 1, 2, 2]);
  });

  it("keeps the chats that landed when one fails", async () => {
    const pageChatBackwards = vi.fn((args: { chatId: string }) =>
      args.chatId === MOCK_CHAT_ID
        ? Promise.resolve({
            messages: [mockGraphChatMessage({ id: "a" })],
            nextLink: null,
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
