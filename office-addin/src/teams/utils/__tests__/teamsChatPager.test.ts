import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MOCK_CHAT_ID,
  jsonResponse,
  mockGraphChatMessage,
  throttledResponse,
} from "../../../test/mocks/teams/graph";
import { makeGraphTokenSource } from "../../../utils/graph/graphClient";
import { listChatMessagesPage } from "../teamsChatGraph";
import { MAX_CHAT_PAGES, pageChatMessagesBackwards } from "../teamsChatPager";
import { resetTeamsChatRateGates } from "../teamsChatRateGate";

import type { GraphTransport } from "../../../utils/graph/graphClient";

const tokenSource = () => makeGraphTokenSource(async () => "token");

const OTHER_CHAT_ID = "19:def456@thread.v2";

interface PagingTransport {
  transport: GraphTransport & ReturnType<typeof vi.fn>;
  /** Fake-clock timestamp of each request, in call order. */
  calledAt: number[];
  calls: number;
}

/**
 * Serves `pages` pages of `perPage` messages, then stops offering a nextLink.
 * Every page carries distinct ids so a repeated page would be detectable.
 */
function pagingTransport(pages: number, perPage: number): PagingTransport {
  const calledAt: number[] = [];
  const state = { calls: 0 };
  const transport = vi.fn(() => {
    calledAt.push(Date.now());
    state.calls += 1;
    const index = state.calls;
    const messages = Array.from({ length: perPage }, (_unused, offset) =>
      mockGraphChatMessage({
        id: `p${index}-m${offset}`,
        createdDateTime: new Date(
          Date.UTC(2026, 2, 3, 9, 0) - (index * perPage + offset) * 60_000,
        ).toISOString(),
      }),
    );
    return Promise.resolve(
      jsonResponse({
        value: messages,
        ...(index < pages
          ? {
              "@odata.nextLink": `https://graph.microsoft.com/v1.0/next/${index}`,
            }
          : {}),
      }),
    );
  }) as PagingTransport["transport"];

  return {
    transport,
    calledAt,
    get calls() {
      return state.calls;
    },
  };
}

beforeEach(() => {
  resetTeamsChatRateGates();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("pageChatMessagesBackwards", () => {
  it("walks the nextLink chain and returns the messages newest-first", async () => {
    const served = pagingTransport(3, 2);
    const pending = pageChatMessagesBackwards({
      chatId: MOCK_CHAT_ID,
      tokenSource: tokenSource(),
      limit: 200,
      transport: served.transport,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(served.calls).toBe(3);
    expect(result.messages).toHaveLength(6);
    expect(result.messages[0].id).toBe("p1-m0");
    expect(result.nextLink).toBeNull();
    expect(result.state).toBe("ok");
    // The oldest message is the last one served, and it is what the transcript
    // header reports as the back edge of the window.
    expect(result.oldestCreatedDateTime).toBe(
      result.messages[result.messages.length - 1].createdDateTime,
    );
  });

  it("leaves at least a second between two requests against the same chat", async () => {
    const served = pagingTransport(2, 2);
    const pending = pageChatMessagesBackwards({
      chatId: MOCK_CHAT_ID,
      tokenSource: tokenSource(),
      limit: 200,
      transport: served.transport,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    expect(served.calledAt).toHaveLength(2);
    expect(served.calledAt[1] - served.calledAt[0]).toBeGreaterThanOrEqual(
      1000,
    );
  });

  it("does not serialize requests against different chats", async () => {
    const calledAt = new Map<string, number>();
    const transport: GraphTransport = vi.fn((url: string) => {
      calledAt.set(
        url.includes("def456") ? OTHER_CHAT_ID : MOCK_CHAT_ID,
        Date.now(),
      );
      return Promise.resolve(jsonResponse({ value: [] }));
    });

    await Promise.all([
      listChatMessagesPage(MOCK_CHAT_ID, tokenSource(), { transport }),
      listChatMessagesPage(OTHER_CHAT_ID, tokenSource(), { transport }),
    ]);

    expect(calledAt.get(MOCK_CHAT_ID)).toBe(calledAt.get(OTHER_CHAT_ID));
  });

  it("honours a Retry-After once and then succeeds", async () => {
    const calledAt: number[] = [];
    const transport: GraphTransport = vi.fn(() => {
      calledAt.push(Date.now());
      return Promise.resolve(
        calledAt.length === 1
          ? throttledResponse(2)
          : jsonResponse({ value: [mockGraphChatMessage()] }),
      );
    });

    const pending = pageChatMessagesBackwards({
      chatId: MOCK_CHAT_ID,
      tokenSource: tokenSource(),
      limit: 50,
      transport,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(transport).toHaveBeenCalledTimes(2);
    expect(calledAt[1] - calledAt[0]).toBeGreaterThanOrEqual(2000);
    expect(result.state).toBe("ok");
    expect(result.messages).toHaveLength(1);
  });

  it("stops after a second throttle instead of retrying forever", async () => {
    const transport: GraphTransport = vi.fn(() =>
      Promise.resolve(throttledResponse(1)),
    );

    const pending = pageChatMessagesBackwards({
      chatId: MOCK_CHAT_ID,
      tokenSource: tokenSource(),
      limit: 200,
      transport,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(transport).toHaveBeenCalledTimes(2);
    expect(result.state).toBe("error");
    expect(result.messages).toEqual([]);
  });

  it("degrades to partial when a later page is throttled out", async () => {
    let calls = 0;
    const transport: GraphTransport = vi.fn(() => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? jsonResponse({
              value: [mockGraphChatMessage()],
              "@odata.nextLink": "https://graph.microsoft.com/v1.0/next/1",
            })
          : throttledResponse(1),
      );
    });

    const pending = pageChatMessagesBackwards({
      chatId: MOCK_CHAT_ID,
      tokenSource: tokenSource(),
      limit: 200,
      transport,
    });
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;

    expect(result.state).toBe("partial");
    expect(result.messages).toHaveLength(1);
  });

  it("keeps paging short pages until the message limit is met", async () => {
    // Graph routinely serves fewer than $top: a page budget derived from the
    // limit would stop at a fraction of the 60 messages that were asked for.
    const served = pagingTransport(50, 5);
    const pending = pageChatMessagesBackwards({
      chatId: MOCK_CHAT_ID,
      tokenSource: tokenSource(),
      limit: 60,
      transport: served.transport,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    expect(served.calls).toBe(12);
    expect(result.messages).toHaveLength(60);
    expect(result.nextLink).not.toBeNull();
  });

  it("stops at the runaway guard when the pages stay tiny", async () => {
    const served = pagingTransport(50, 1);
    const pending = pageChatMessagesBackwards({
      chatId: MOCK_CHAT_ID,
      tokenSource: tokenSource(),
      limit: 5_000,
      transport: served.transport,
    });
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await pending;

    expect(served.calls).toBe(MAX_CHAT_PAGES);
    expect(result.nextLink).not.toBeNull();
  });

  it("never returns more than the requested limit", async () => {
    const served = pagingTransport(10, 50);
    const pending = pageChatMessagesBackwards({
      chatId: MOCK_CHAT_ID,
      tokenSource: tokenSource(),
      limit: 120,
      transport: served.transport,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    expect(result.messages).toHaveLength(120);
  });

  it("reports progress once per page, monotonically", async () => {
    const served = pagingTransport(3, 2);
    const fetched: number[] = [];
    const pending = pageChatMessagesBackwards({
      chatId: MOCK_CHAT_ID,
      tokenSource: tokenSource(),
      limit: 200,
      transport: served.transport,
      onProgress: (progress) => {
        expect(progress.chatId).toBe(MOCK_CHAT_ID);
        expect(progress.limit).toBe(200);
        fetched.push(progress.fetched);
      },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    expect(fetched).toEqual([2, 4, 6]);
  });

  it("resumes from a load-earlier continuation instead of the newest page", async () => {
    const served = pagingTransport(1, 1);
    const pending = pageChatMessagesBackwards({
      chatId: MOCK_CHAT_ID,
      tokenSource: tokenSource(),
      limit: 50,
      startingAfterLink: "https://graph.microsoft.com/v1.0/resume-here",
      transport: served.transport,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    expect(served.transport.mock.calls[0][0]).toBe(
      "https://graph.microsoft.com/v1.0/resume-here",
    );
  });

  it("aborts mid-walk without issuing another request", async () => {
    const controller = new AbortController();
    const served = pagingTransport(5, 2);
    const pending = pageChatMessagesBackwards({
      chatId: MOCK_CHAT_ID,
      tokenSource: tokenSource(),
      limit: 200,
      transport: served.transport,
      signal: controller.signal,
    });

    // Let the first page land, then cancel while the gate is holding the second.
    await vi.advanceTimersByTimeAsync(0);
    expect(served.calls).toBe(1);
    controller.abort(new Error("picker closed"));

    await expect(pending).rejects.toThrow("picker closed");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(served.calls).toBe(1);
  });
});
