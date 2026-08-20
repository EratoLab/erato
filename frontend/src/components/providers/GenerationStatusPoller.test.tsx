import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { buildInfiniteChatsQueryKey } from "@/hooks/chat/useChatHistory";
import { recentChatsQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { patchTerminalChats } from "./GenerationStatusPoller";

import type {
  GeneratingChat,
  RecentChat,
  RecentChatsResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { InfiniteData } from "@tanstack/react-query";

const recentChat = (
  overrides: Partial<RecentChat> & { id: string },
): RecentChat => ({
  title_resolved: overrides.id,
  can_edit: false,
  file_uploads: [],
  is_pinned: false,
  last_message_at: "2026-08-19T12:00:00.000Z",
  ...overrides,
});

const response = (chats: RecentChat[]): RecentChatsResponse => ({
  chats,
  stats: {
    current_offset: 0,
    has_more: false,
    returned_count: chats.length,
    total_count: chats.length,
  },
});

const completedEntry: GeneratingChat = {
  chat_id: "run-1",
  started_at: "2026-08-19T12:00:00.000Z",
  ended_at: "2026-08-19T12:05:00.000Z",
  state: "completed",
  title: "Answered",
};

const plainKey = recentChatsQuery({
  queryParams: { origin_chat_id: "origin-1", include_delegated: true },
}).queryKey;

describe("patchTerminalChats", () => {
  it("patches plain single-page recent-chats caches", () => {
    const queryClient = new QueryClient();
    const untouched = recentChat({
      id: "run-2",
      active_generation_started_at: "2026-08-19T12:02:00.000Z",
    });
    queryClient.setQueryData(
      plainKey,
      response([
        recentChat({
          id: "run-1",
          active_generation_started_at: "2026-08-19T12:00:00.000Z",
          pending_tool_approval_at: "2026-08-19T12:01:00.000Z",
        }),
        untouched,
      ]),
    );

    patchTerminalChats(queryClient, [completedEntry]);

    const patched = queryClient.getQueryData<RecentChatsResponse>(plainKey);
    expect(patched?.chats[0]).toMatchObject({
      id: "run-1",
      title_resolved: "Answered",
      active_generation_started_at: undefined,
      pending_tool_approval_at: undefined,
    });
    // Rows without a terminal entry keep their identity.
    expect(patched?.chats[1]).toBe(untouched);
  });

  it("keeps patching paginated caches and leaves untouched pages stable", () => {
    const queryClient = new QueryClient();
    const infiniteKey = buildInfiniteChatsQueryKey();
    const stablePage = response([recentChat({ id: "chat-2" })]);
    queryClient.setQueryData(infiniteKey, {
      pages: [
        response([
          recentChat({
            id: "run-1",
            active_generation_started_at: "2026-08-19T12:00:00.000Z",
          }),
        ]),
        stablePage,
      ],
      pageParams: [0, 30],
    } satisfies InfiniteData<RecentChatsResponse>);

    patchTerminalChats(queryClient, [completedEntry]);

    const patched =
      queryClient.getQueryData<InfiniteData<RecentChatsResponse>>(infiniteKey);
    expect(patched?.pages[0].chats[0]).toMatchObject({
      id: "run-1",
      title_resolved: "Answered",
      active_generation_started_at: undefined,
    });
    expect(patched?.pages[1]).toBe(stablePage);
  });

  it("does not touch caches when the snapshot has no terminal entries", () => {
    const queryClient = new QueryClient();
    const data = response([
      recentChat({
        id: "run-1",
        active_generation_started_at: "2026-08-19T12:00:00.000Z",
      }),
    ]);
    queryClient.setQueryData(plainKey, data);

    patchTerminalChats(queryClient, [
      {
        chat_id: "run-1",
        started_at: "2026-08-19T12:00:00.000Z",
        state: "running",
      },
    ]);

    expect(queryClient.getQueryData(plainKey)).toBe(data);
  });
});
