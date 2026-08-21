import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";

import { DELEGATION_TOOL_NAME } from "@/lib/delegation/delegationEnvelope";
import { recentChatsQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  delegatedRunsListingParams,
  seedDispatchedDelegatedRun,
} from "@/utils/chat/delegatedRunDispatch";
import { isBackgroundRun } from "@/utils/chat/recentChatSession";

import type {
  MessageSubmitStreamingResponseToolCallUpdate,
  RecentChat,
  RecentChatsResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const ORIGIN_CHAT_ID = "origin-1";

const listingKey = (originChatId: string) =>
  recentChatsQuery({ queryParams: delegatedRunsListingParams(originChatId) })
    .queryKey;

// The generated `Value` type erases tool outputs to `void`, so the fixture
// carries them as `unknown` and casts once, like the DelegationStep tests.
const dispatchUpdate = (
  overrides: Partial<
    Omit<MessageSubmitStreamingResponseToolCallUpdate, "output">
  > & { output?: unknown } = {},
): MessageSubmitStreamingResponseToolCallUpdate =>
  ({
    content_index: 0,
    message_id: "6e1a3f34-6f0f-4f6e-9a63-3c1f6f6e5a01",
    tool_call_id: "call-1",
    tool_name: DELEGATION_TOOL_NAME,
    status: "success",
    output: {
      background: true,
      delegate_chat_id: "run-1",
      assistant_id: "assistant-1",
      assistant_name: "Linear Ticket Analyst",
    },
    ...overrides,
  }) as MessageSubmitStreamingResponseToolCallUpdate;

const existingRun = (id: string): RecentChat => ({
  id,
  title_resolved: `Title of ${id}`,
  can_edit: true,
  file_uploads: [],
  last_message_at: "2026-08-19T12:00:00.000Z",
  is_pinned: false,
  provenance_kind: "delegation",
  provenance_run_mode: "background",
  origin_chat_id: ORIGIN_CHAT_ID,
});

const listingOf = (chats: RecentChat[]): RecentChatsResponse => ({
  chats,
  stats: {
    current_offset: 0,
    has_more: false,
    returned_count: chats.length,
    total_count: chats.length,
  },
});

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient();
});

describe("seedDispatchedDelegatedRun", () => {
  it("seeds a listing entry for a background dispatch when none is cached", () => {
    const seeded = seedDispatchedDelegatedRun(
      queryClient,
      ORIGIN_CHAT_ID,
      dispatchUpdate(),
    );

    expect(seeded).toBe(true);
    const listing = queryClient.getQueryData<RecentChatsResponse>(
      listingKey(ORIGIN_CHAT_ID),
    );
    expect(listing?.chats).toHaveLength(1);
    const row = listing?.chats[0];
    expect(row?.id).toBe("run-1");
    expect(row?.assistant_name).toBe("Linear Ticket Analyst");
    expect(row?.origin_chat_id).toBe(ORIGIN_CHAT_ID);
    // The row must pass the section's own filter, or seeding shows nothing.
    expect(row && isBackgroundRun(row)).toBe(true);
  });

  it("prepends to an existing listing and keeps the cached rows", () => {
    queryClient.setQueryData(
      listingKey(ORIGIN_CHAT_ID),
      listingOf([existingRun("run-0")]),
    );

    seedDispatchedDelegatedRun(queryClient, ORIGIN_CHAT_ID, dispatchUpdate());

    const listing = queryClient.getQueryData<RecentChatsResponse>(
      listingKey(ORIGIN_CHAT_ID),
    );
    expect(listing?.chats.map((chat) => chat.id)).toEqual(["run-1", "run-0"]);
  });

  it("does not duplicate a run the listing already carries", () => {
    queryClient.setQueryData(
      listingKey(ORIGIN_CHAT_ID),
      listingOf([existingRun("run-1")]),
    );

    const seeded = seedDispatchedDelegatedRun(
      queryClient,
      ORIGIN_CHAT_ID,
      dispatchUpdate(),
    );

    expect(seeded).toBe(false);
    const listing = queryClient.getQueryData<RecentChatsResponse>(
      listingKey(ORIGIN_CHAT_ID),
    );
    expect(listing?.chats).toHaveLength(1);
  });

  it("leaves other origins' listings alone", () => {
    queryClient.setQueryData(listingKey("origin-2"), listingOf([]));

    seedDispatchedDelegatedRun(queryClient, ORIGIN_CHAT_ID, dispatchUpdate());

    expect(
      queryClient.getQueryData<RecentChatsResponse>(listingKey("origin-2"))
        ?.chats,
    ).toHaveLength(0);
  });

  it("ignores updates from other tools", () => {
    const seeded = seedDispatchedDelegatedRun(
      queryClient,
      ORIGIN_CHAT_ID,
      dispatchUpdate({ tool_name: "web_search" }),
    );

    expect(seeded).toBe(false);
    expect(
      queryClient.getQueryData(listingKey(ORIGIN_CHAT_ID)),
    ).toBeUndefined();
  });

  it("ignores awaited delegations, which deliver inline instead", () => {
    const seeded = seedDispatchedDelegatedRun(
      queryClient,
      ORIGIN_CHAT_ID,
      dispatchUpdate({
        output: {
          status: "completed",
          delegate_chat_id: "run-1",
          result: "the answer",
        },
      }),
    );

    expect(seeded).toBe(false);
    expect(
      queryClient.getQueryData(listingKey(ORIGIN_CHAT_ID)),
    ).toBeUndefined();
  });

  it("ignores a dispatch frame without a run to point at", () => {
    const seeded = seedDispatchedDelegatedRun(
      queryClient,
      ORIGIN_CHAT_ID,
      dispatchUpdate({ output: { background: true } }),
    );

    expect(seeded).toBe(false);
    expect(
      queryClient.getQueryData(listingKey(ORIGIN_CHAT_ID)),
    ).toBeUndefined();
  });

  it("ignores absent or malformed outputs", () => {
    for (const output of [undefined, null, "text", 7, ["nope"]]) {
      const seeded = seedDispatchedDelegatedRun(
        queryClient,
        ORIGIN_CHAT_ID,
        dispatchUpdate({ output }),
      );
      expect(seeded).toBe(false);
    }
    expect(
      queryClient.getQueryData(listingKey(ORIGIN_CHAT_ID)),
    ).toBeUndefined();
  });
});
