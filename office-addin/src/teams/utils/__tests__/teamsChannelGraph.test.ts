import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  jsonResponse,
  mockGraphChatMessage,
} from "../../../test/mocks/teams/graph";
import { makeGraphTokenSource } from "../../../utils/graph/graphClient";
import {
  channelGateKey,
  getChannelMessage,
  listChannelMessagesPage,
  listJoinedTeams,
  listTeamChannels,
} from "../teamsChatGraph";
import { resetTeamsChatRateGates } from "../teamsChatRateGate";

import type { GraphTransport } from "../../../utils/graph/graphClient";

const TEAM_ID = "19:team-abc@thread.tacv2";
const CHANNEL_ID = "19:channel-def@thread.tacv2";

const tokenSource = () => makeGraphTokenSource(async () => "token");

function transportReturning(
  responder: (url: string) => Response,
): GraphTransport & ReturnType<typeof vi.fn> {
  return vi.fn((url: string) =>
    Promise.resolve(responder(url)),
  ) as GraphTransport & ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  resetTeamsChatRateGates();
});

describe("listJoinedTeams", () => {
  it("reads the teams the user belongs to", async () => {
    const transport = transportReturning(() =>
      jsonResponse({ value: [{ id: TEAM_ID, displayName: "Erato Labs" }] }),
    );
    const result = await listJoinedTeams(tokenSource(), { transport });

    expect(result.state).toBe("ok");
    expect(result.teams).toHaveLength(1);
    expect(transport.mock.calls[0]?.[0]).toContain("/me/joinedTeams");
  });

  it("degrades to an error state rather than throwing", async () => {
    const transport = transportReturning(
      () => new Response("nope", { status: 403 }),
    );
    const result = await listJoinedTeams(tokenSource(), { transport });

    expect(result).toEqual({ teams: [], state: "error" });
  });
});

describe("listTeamChannels", () => {
  it("addresses the team and url-encodes the id", async () => {
    const transport = transportReturning(() =>
      jsonResponse({ value: [{ id: CHANNEL_ID, displayName: "General" }] }),
    );
    const result = await listTeamChannels(TEAM_ID, tokenSource(), {
      transport,
    });

    expect(result.channels).toHaveLength(1);
    const url = String(transport.mock.calls[0]?.[0]);
    expect(url).toContain(`/teams/${encodeURIComponent(TEAM_ID)}/channels`);
    expect(url).not.toContain("19:team-abc@thread.tacv2/channels");
  });
});

describe("listChannelMessagesPage", () => {
  it("reads a channel's messages, not a chat's", async () => {
    const transport = transportReturning(() =>
      jsonResponse({ value: [mockGraphChatMessage({ id: "m1" })] }),
    );
    const result = await listChannelMessagesPage(
      TEAM_ID,
      CHANNEL_ID,
      tokenSource(),
      { transport },
    );

    expect(result.ok).toBe(true);
    expect(result.messages).toHaveLength(1);
    const url = String(transport.mock.calls[0]?.[0]);
    expect(url).toContain("/channels/");
    expect(url).not.toContain("/chats/");
  });

  it("expands replies, since the plain list returns root posts only", async () => {
    const transport = transportReturning(() =>
      jsonResponse({
        value: [
          {
            ...mockGraphChatMessage({ id: "root" }),
            replies: [
              mockGraphChatMessage({
                id: "reply-2",
                createdDateTime: "2026-08-10T12:00:00Z",
              }),
              mockGraphChatMessage({
                id: "reply-1",
                createdDateTime: "2026-08-10T10:00:00Z",
              }),
            ],
          },
        ],
      }),
    );
    const result = await listChannelMessagesPage(
      TEAM_ID,
      CHANNEL_ID,
      tokenSource(),
      { transport },
    );

    expect(String(transport.mock.calls[0]?.[0])).toContain("$expand=replies");
    // Root first, then its replies oldest-first, so the thread reads in order.
    expect(result.messages.map((message) => message.id)).toEqual([
      "root",
      "reply-1",
      "reply-2",
    ]);
  });

  it("follows the paging link verbatim", async () => {
    const nextLink = "https://graph.microsoft.com/v1.0/next-page";
    const transport = transportReturning(() => jsonResponse({ value: [] }));
    await listChannelMessagesPage(TEAM_ID, CHANNEL_ID, tokenSource(), {
      transport,
      nextLink,
    });

    expect(transport.mock.calls[0]?.[0]).toBe(nextLink);
  });
});

describe("getChannelMessage", () => {
  it("hydrates by channel identity rather than chat id", async () => {
    const transport = transportReturning(() =>
      jsonResponse(mockGraphChatMessage({ id: "m9" })),
    );
    const message = await getChannelMessage(
      TEAM_ID,
      CHANNEL_ID,
      "m9",
      tokenSource(),
      { transport },
    );

    expect(message?.id).toBe("m9");
    const url = String(transport.mock.calls[0]?.[0]);
    expect(url).toContain(
      `/channels/${encodeURIComponent(CHANNEL_ID)}/messages/m9`,
    );
  });

  it("returns null instead of throwing when the message is gone", async () => {
    const transport = transportReturning(
      () => new Response("", { status: 404 }),
    );
    const message = await getChannelMessage(
      TEAM_ID,
      CHANNEL_ID,
      "gone",
      tokenSource(),
      { transport },
    );

    expect(message).toBeNull();
  });
});

describe("channelGateKey", () => {
  it("cannot collide with a chat id sharing the channel id", () => {
    expect(channelGateKey(TEAM_ID, CHANNEL_ID)).not.toBe(CHANNEL_ID);
    expect(channelGateKey(TEAM_ID, CHANNEL_ID)).toBe(
      channelGateKey(TEAM_ID, CHANNEL_ID),
    );
    expect(channelGateKey("team-a", "chan")).not.toBe(
      channelGateKey("team-b", "chan"),
    );
  });
});
