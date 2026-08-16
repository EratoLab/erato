import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MOCK_CHAT_ID,
  jsonResponse,
  mockGraphChatMessage,
} from "../../../test/mocks/teams/graph";
import { makeGraphTokenSource } from "../../../utils/graph/graphClient";
import {
  getChatMessage,
  getTeamsChat,
  listChatMessagesPage,
  listTeamsChatsPage,
  searchChatMessages,
  splitSearchSummaryHighlights,
} from "../teamsChatGraph";
import {
  resetTeamsChatRateGates,
  runAtChatMetadataRate,
} from "../teamsChatRateGate";

import type { GraphTransport } from "../../../utils/graph/graphClient";
import type * as teamsChatRateGateModule from "../teamsChatRateGate";

// Pass-through spy on the metadata pacer: the wiring (`metadataRate: true` on
// exactly the List/Get chat calls) is otherwise invisible to tests, because a
// freshly reset gate never sleeps on its first call.
vi.mock("../teamsChatRateGate", async (importOriginal) => {
  const actual = await importOriginal<typeof teamsChatRateGateModule>();
  return {
    ...actual,
    runAtChatMetadataRate: vi.fn(actual.runAtChatMetadataRate),
  };
});

const tokenSource = () => makeGraphTokenSource(async () => "token");

function transportReturning(
  responder: (url: string, init?: RequestInit) => Response,
): GraphTransport & ReturnType<typeof vi.fn> {
  return vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(responder(url, init)),
  ) as GraphTransport & ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  resetTeamsChatRateGates();
  vi.mocked(runAtChatMetadataRate).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chat metadata rate wiring", () => {
  it("paces List chats and Get chat, but not message pages", async () => {
    const transport = transportReturning(() => jsonResponse({ value: [] }));

    await listTeamsChatsPage(tokenSource(), { transport });
    expect(runAtChatMetadataRate).toHaveBeenCalledTimes(1);

    // Reset between calls so real-timer gate waits don't slow the test.
    resetTeamsChatRateGates();
    await getTeamsChat(MOCK_CHAT_ID, tokenSource(), { transport });
    expect(runAtChatMetadataRate).toHaveBeenCalledTimes(2);

    resetTeamsChatRateGates();
    await listChatMessagesPage(MOCK_CHAT_ID, tokenSource(), { transport });
    expect(runAtChatMetadataRate).toHaveBeenCalledTimes(2);
  });
});

describe("listTeamsChatsPage", () => {
  it("expands members and the last message preview without an $orderby", async () => {
    const transport = transportReturning(() => jsonResponse({ value: [] }));
    await listTeamsChatsPage(tokenSource(), { transport });

    const url = transport.mock.calls[0][0] as string;
    expect(url).toContain("/me/chats?$expand=members,lastMessagePreview");
    expect(url).toContain("$top=50");
    expect(url).not.toContain("$orderby");
  });

  it("follows the supplied nextLink verbatim", async () => {
    const transport = transportReturning(() => jsonResponse({ value: [] }));
    await listTeamsChatsPage(tokenSource(), {
      transport,
      nextLink: "https://graph.microsoft.com/v1.0/me/chats?$skiptoken=abc",
    });
    expect(transport.mock.calls[0][0]).toBe(
      "https://graph.microsoft.com/v1.0/me/chats?$skiptoken=abc",
    );
  });

  it("reports an error state instead of throwing", async () => {
    const transport = transportReturning(() => jsonResponse({}, 500));
    const result = await listTeamsChatsPage(tokenSource(), { transport });
    expect(result).toEqual({ chats: [], nextLink: null, state: "error" });
  });
});

describe("listChatMessagesPage", () => {
  // The $orderby pins the window to creation time: Graph's default is
  // lastModifiedDateTime, which moves on edits and reactions and would pull
  // ancient messages into the newest-N window.
  it("requests the maximum page size ordered by creation time and surfaces the nextLink", async () => {
    const transport = transportReturning(() =>
      jsonResponse({
        value: [mockGraphChatMessage()],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/next",
      }),
    );
    const page = await listChatMessagesPage(MOCK_CHAT_ID, tokenSource(), {
      transport,
    });

    expect(transport.mock.calls[0][0]).toBe(
      "https://graph.microsoft.com/v1.0/chats/19%3Aabc123%40thread.v2/messages?$top=50&$orderby=createdDateTime%20desc",
    );
    expect(page.messages).toHaveLength(1);
    expect(page.nextLink).toBe("https://graph.microsoft.com/v1.0/next");
  });

  it("force-refreshes the token and replays exactly once on a 401", async () => {
    const acquire = vi
      .fn()
      .mockResolvedValueOnce("stale")
      .mockResolvedValueOnce("fresh");
    const transport = transportReturning((_url, init) =>
      (init?.headers as Record<string, string>).Authorization === "Bearer stale"
        ? jsonResponse({}, 401)
        : jsonResponse({ value: [] }),
    );

    const page = await listChatMessagesPage(
      MOCK_CHAT_ID,
      makeGraphTokenSource(acquire),
      { transport },
    );

    expect(page.ok).toBe(true);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(acquire).toHaveBeenNthCalledWith(1, undefined);
    expect(acquire).toHaveBeenNthCalledWith(2, { forceRefresh: true });
  });
});

describe("getChatMessage", () => {
  it("addresses the message inside its chat", async () => {
    const transport = transportReturning(() =>
      jsonResponse(mockGraphChatMessage()),
    );
    const message = await getChatMessage(
      MOCK_CHAT_ID,
      "1741000000000",
      tokenSource(),
      {
        transport,
      },
    );

    expect(transport.mock.calls[0][0]).toBe(
      "https://graph.microsoft.com/v1.0/chats/19%3Aabc123%40thread.v2/messages/1741000000000",
    );
    expect(message?.id).toBe("1741000000000");
  });

  it("returns null on a 404 rather than failing the whole build", async () => {
    const transport = transportReturning(() => jsonResponse({}, 404));
    await expect(
      getChatMessage(MOCK_CHAT_ID, "gone", tokenSource(), { transport }),
    ).resolves.toBeNull();
  });
});

describe("searchChatMessages", () => {
  const searchPayload = (hits: unknown[]) => ({
    value: [{ hitsContainers: [{ hits, moreResultsAvailable: true }] }],
  });

  it("posts the chatMessage entity type with from/size paging", async () => {
    const transport = transportReturning(() => jsonResponse(searchPayload([])));
    await searchChatMessages("thursday", tokenSource(), {
      transport,
      from: 25,
      size: 25,
    });

    const [url, init] = transport.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/search/query");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      requests: [
        {
          entityTypes: ["chatMessage"],
          query: { queryString: "thursday" },
          from: 25,
          size: 25,
        },
      ],
    });
  });

  it("joins on the resource id, never the Exchange hitId", async () => {
    const transport = transportReturning(() =>
      jsonResponse(
        searchPayload([
          {
            hitId: "AAMkAGI2exchange-item-id=",
            summary: "move the <c0>sync</c0> to Thursday",
            resource: {
              id: "1741000000000",
              chatId: MOCK_CHAT_ID,
              createdDateTime: "2026-03-03T09:14:00Z",
              from: { user: { displayName: "Ada Lovelace" } },
            },
          },
        ]),
      ),
    );

    const result = await searchChatMessages("sync", tokenSource(), {
      transport,
    });

    expect(result.hits).toEqual([
      {
        ref: { kind: "chat", chatId: MOCK_CHAT_ID },
        messageId: "1741000000000",
        senderName: "Ada Lovelace",
        createdAt: "2026-03-03T09:14:00Z",
        summary: "move the <c0>sync</c0> to Thursday",
        webLink: null,
      },
    ]);
    expect(result.hits[0].messageId).not.toBe("AAMkAGI2exchange-item-id=");
    expect(result.moreResultsAvailable).toBe(true);
  });

  it("drops hits that carry no addressable message", async () => {
    const transport = transportReturning(() =>
      jsonResponse(searchPayload([{ hitId: "x", resource: { id: "1" } }])),
    );
    const result = await searchChatMessages("sync", tokenSource(), {
      transport,
    });
    expect(result.hits).toEqual([]);
  });

  it("retries once at a smaller page size when the service rejects size", async () => {
    const sizes: number[] = [];
    const transport = transportReturning((_url, init) => {
      const body = JSON.parse(init?.body as string) as {
        requests: Array<{ size: number }>;
      };
      sizes.push(body.requests[0].size);
      return sizes.length === 1
        ? jsonResponse({ error: { message: "size is invalid" } }, 400)
        : jsonResponse(searchPayload([]));
    });

    const result = await searchChatMessages("sync", tokenSource(), {
      transport,
    });

    expect(sizes).toEqual([25, 10]);
    expect(result.state).toBe("ok");
    // The next page must offset by the size actually served, not the one asked
    // for, or the negotiated-down page silently skips fifteen hits.
    expect(result.nextFrom).toBe(10);
  });

  it("offsets the next page by the size that was served", async () => {
    const transport = transportReturning(() => jsonResponse(searchPayload([])));
    const result = await searchChatMessages("sync", tokenSource(), {
      transport,
      from: 25,
      size: 25,
    });
    expect(result.nextFrom).toBe(50);
  });
});

describe("searchChatMessages hit classification", () => {
  // Shapes below are copied from a live tenant response, not from the docs —
  // the docs disagree with the service on both points tested here.
  function hitResponse(resource: Record<string, unknown>) {
    return jsonResponse({
      value: [
        {
          hitsContainers: [
            {
              hits: [{ hitId: "AAMkAD...", summary: "hey folks", resource }],
              moreResultsAvailable: false,
            },
          ],
        },
      ],
    });
  }

  it("classifies a channel hit by channelIdentity, not by chatId", async () => {
    // A channel hit carries the CHANNEL thread id in chatId; trusting it would
    // route hydration at /chats/{id} and 404.
    const transport = transportReturning(() =>
      hitResponse({
        id: "1786384303161",
        chatId: "19:0894b8cd@thread.tacv2",
        channelIdentity: {
          teamId: "451d5606-a479-49d3-a849-c40bf373b753",
          channelId: "19:0894b8cd@thread.tacv2",
        },
        from: { emailAddress: { name: "Max Token" } },
      }),
    );

    const result = await searchChatMessages("folks", tokenSource(), {
      transport,
    });

    expect(result.hits[0]?.ref).toEqual({
      kind: "channel",
      teamId: "451d5606-a479-49d3-a849-c40bf373b753",
      channelId: "19:0894b8cd@thread.tacv2",
    });
  });

  it("reads the sender from the Substrate-shaped from the service returns", async () => {
    const transport = transportReturning(() =>
      hitResponse({
        id: "m1",
        chatId: "19:chat@thread.v2",
        from: { emailAddress: { name: "Max Token" } },
      }),
    );

    const result = await searchChatMessages("folks", tokenSource(), {
      transport,
    });

    expect(result.hits[0]?.senderName).toBe("Max Token");
    expect(result.hits[0]?.ref).toEqual({
      kind: "chat",
      chatId: "19:chat@thread.v2",
    });
  });
});

describe("splitSearchSummaryHighlights", () => {
  it("splits the highlight markers into renderable segments", () => {
    expect(
      splitSearchSummaryHighlights("move the <c0>sync</c0> to Thursday"),
    ).toEqual([
      { text: "move the ", highlighted: false },
      { text: "sync", highlighted: true },
      { text: " to Thursday", highlighted: false },
    ]);
  });

  it("returns a single plain segment when nothing is highlighted", () => {
    expect(splitSearchSummaryHighlights("plain")).toEqual([
      { text: "plain", highlighted: false },
    ]);
  });
});
