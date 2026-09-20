import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { buildInfiniteChatsQueryKey } from "@/hooks/chat/useChatHistory";
import {
  chatMessagesQuery,
  recentChatsQuery,
  useGeneratingChats,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import {
  GenerationStatusPoller,
  patchTerminalChats,
  pollInterval,
} from "./GenerationStatusPoller";

// Spread the real module: the component imports `recentChatsQuery` and
// `chatMessagesQuery` from it too, and a bare mock would make both undefined.
vi.mock(
  "@/lib/generated/v1betaApi/v1betaApiComponents",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/lib/generated/v1betaApi/v1betaApiComponents")
    >()),
    useGeneratingChats: vi.fn(),
  }),
);

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
  mcp_write_tools_enabled: true,
  disabled_mcp_server_ids: [],
  disabled_mcp_tools: [],
  last_message_at: "2026-08-19T12:00:00.000Z",
  delegated_runs_in_flight: false,
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

describe("pollInterval", () => {
  beforeEach(() => {
    useGenerationStatusStore.getState().reset();
  });

  it("polls at the slow cadence while a delivery is outstanding and nothing is running", () => {
    // `refetchInterval` is a SECOND gate beside `enabled`. Teaching only the
    // poll-driver selector about deliveries fires exactly one request and
    // then stops, because this function would still return false.
    expect(pollInterval()).toBe(false);

    useGenerationStatusStore.getState().setAwaitingDelivery("origin", true);
    expect(pollInterval()).toBe(10_000);

    // A live generation still wins the cadence.
    useGenerationStatusStore
      .getState()
      .seedRunning("other", new Date().toISOString());
    expect(pollInterval()).toBe(3_000);

    useGenerationStatusStore.getState().setAwaitingDelivery("origin", false);
    useGenerationStatusStore.getState().clearStatus("other");
    expect(pollInterval()).toBe(false);
  });
});

describe("GenerationStatusPoller effects", () => {
  const generatingEntry = (
    overrides: Partial<GeneratingChat> & { chat_id: string },
  ): GeneratingChat => ({
    state: "running",
    started_at: "2026-08-19T12:00:00.000Z",
    ...overrides,
  });

  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;
  let updatedAt: number;

  const renderPoller = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <GenerationStatusPoller />
      </QueryClientProvider>,
    );

  /**
   * Mirrors React Query's structural sharing: the SAME `data` reference with
   * a bumped `dataUpdatedAt` is what a repeated identical response looks
   * like. Returning a fresh object instead would make the "same snapshot
   * again" cases pass without the effect ever re-running.
   */
  const emit = (data: { chats: GeneratingChat[] }) => {
    updatedAt += 1;
    (useGeneratingChats as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      { data, dataUpdatedAt: updatedAt },
    );
  };

  const invalidationsFor = (queryKey: readonly unknown[]) =>
    invalidateSpy.mock.calls.filter(
      (call: unknown[]) =>
        JSON.stringify((call[0] as { queryKey: unknown }).queryKey) ===
        JSON.stringify(queryKey),
    ).length;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T12:00:00.000Z"));
    useGenerationStatusStore.getState().reset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    invalidateSpy = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    updatedAt = 0;
    vi.mocked(useGeneratingChats).mockReset();
  });

  it("refreshes the chat listings when a run ends while a delivery is outstanding", () => {
    const listingKey = recentChatsQuery({}).queryKey;
    const running = { chats: [generatingEntry({ chat_id: "child" })] };

    // 1. Nothing is owed: an ordinary turn running elsewhere must not
    //    refresh every cached listing variant.
    emit(running);
    const first = renderPoller();
    expect(invalidationsFor(listingKey)).toBe(0);
    first.unmount();

    // 2. A delivery is outstanding: bootstrap the backstop once.
    useGenerationStatusStore.getState().setAwaitingDelivery("origin", true);
    emit(running);
    const second = renderPoller();
    expect(invalidationsFor(listingKey)).toBe(1);

    // 3. The same snapshot inside the throttle window changes nothing.
    vi.setSystemTime(new Date("2026-08-19T12:00:10.000Z"));
    emit(running);
    second.rerender(
      <QueryClientProvider client={queryClient}>
        <GenerationStatusPoller />
      </QueryClientProvider>,
    );
    expect(invalidationsFor(listingKey)).toBe(1);

    // 4. The child left the live set: the edge fires THROUGH the throttle,
    //    so the result is observed now rather than up to 60s later.
    emit({
      chats: [
        generatingEntry({
          chat_id: "child",
          state: "completed",
          ended_at: "2026-08-19T12:00:11.000Z",
        }),
      ],
    });
    second.rerender(
      <QueryClientProvider client={queryClient}>
        <GenerationStatusPoller />
      </QueryClientProvider>,
    );
    expect(invalidationsFor(listingKey)).toBe(2);

    // 5. Nothing moves for more than the backstop window: the refresh fires
    //    again on its own. This is the only path that discovers a delivery
    //    for a client that never saw the child's live -> terminal edge (a tab
    //    mounted after the child ended sees `previouslyLive` empty), so the
    //    window has to be pinned by crossing it — steps 2-4 all sit inside
    //    it and would hold green with the constant raised tenfold.
    vi.setSystemTime(new Date("2026-08-19T12:01:15.000Z"));
    emit({
      chats: [
        generatingEntry({
          chat_id: "child",
          state: "completed",
          ended_at: "2026-08-19T12:00:11.000Z",
        }),
      ],
    });
    second.rerender(
      <QueryClientProvider client={queryClient}>
        <GenerationStatusPoller />
      </QueryClientProvider>,
    );
    expect(invalidationsFor(listingKey)).toBe(3);

    // 6. ...and then goes quiet again until the next window elapses, rather
    //    than refreshing every listing variant on every poll tick.
    vi.setSystemTime(new Date("2026-08-19T12:01:20.000Z"));
    emit({
      chats: [
        generatingEntry({
          chat_id: "child",
          state: "completed",
          ended_at: "2026-08-19T12:00:11.000Z",
        }),
      ],
    });
    second.rerender(
      <QueryClientProvider client={queryClient}>
        <GenerationStatusPoller />
      </QueryClientProvider>,
    );
    expect(invalidationsFor(listingKey)).toBe(3);
  });

  it("refetches the open chat on the run-ended edge so a landed delivery is visible", () => {
    // A delivery whose reaction failed writes a `task_result` row and starts
    // no further generation, so `/me/generating` never mentions it again. The
    // origin leaving the live set at the end of the delivery is the only
    // signal left, and the react predicate can only see the row if the open
    // chat's messages are refetched on it.
    const messagesKey = chatMessagesQuery({
      pathParams: { chatId: "origin" },
    }).queryKey;
    useGenerationStatusStore.getState().setAwaitingDelivery("origin", true);
    useGenerationStatusStore.getState().setCurrentChatId("origin");

    // 1. The delivery is running under the origin's own lease.
    emit({ chats: [generatingEntry({ chat_id: "origin" })] });
    const view = renderPoller();
    const rerender = () =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <GenerationStatusPoller />
        </QueryClientProvider>,
      );
    // The mount bootstraps the backstop, which also pulls the open chat.
    expect(invalidationsFor(messagesKey)).toBe(1);

    // 2. Inside the throttle window with nothing moving: no extra refetch.
    vi.setSystemTime(new Date("2026-08-19T12:00:10.000Z"));
    emit({ chats: [generatingEntry({ chat_id: "origin" })] });
    rerender();
    expect(invalidationsFor(messagesKey)).toBe(1);

    // 3. The origin left the live set: the delivered row is on disk now.
    emit({
      chats: [
        generatingEntry({
          chat_id: "origin",
          state: "completed",
          ended_at: "2026-08-19T12:00:11.000Z",
        }),
      ],
    });
    rerender();
    expect(invalidationsFor(messagesKey)).toBe(2);
  });

  it("refetches the open chat when its own delivery flag finally falls", () => {
    // The run-ended gate above is armed by `delegated_runs_in_flight` and
    // `deliver_task_result` clears that flag in the SAME transaction that
    // appends the task result row — so the gate is armed only while there is
    // nothing to fetch, and disarms the moment there is. The flag falling is
    // therefore the only signal that means "the row is on disk now", and it
    // arrives from whichever listing fetch happens to observe it, long after
    // this poll may have been disabled.
    const messagesKey = chatMessagesQuery({
      pathParams: { chatId: "origin" },
    }).queryKey;
    const status = useGenerationStatusStore.getState();
    status.setAwaitingDelivery("origin", true);
    status.setCurrentChatId("origin");

    emit({ chats: [] });
    renderPoller();
    // The mount's backstop pull, before anything has been delivered.
    expect(invalidationsFor(messagesKey)).toBe(1);

    act(() => {
      useGenerationStatusStore.getState().setAwaitingDelivery("origin", false);
    });

    expect(invalidationsFor(messagesKey)).toBe(2);
  });

  it("ignores a delivery settling for a chat the user is not looking at", () => {
    const messagesKey = chatMessagesQuery({
      pathParams: { chatId: "other" },
    }).queryKey;
    const status = useGenerationStatusStore.getState();
    status.setAwaitingDelivery("other", true);
    status.setCurrentChatId("origin");

    emit({ chats: [] });
    renderPoller();
    const before = invalidationsFor(
      chatMessagesQuery({ pathParams: { chatId: "origin" } }).queryKey,
    );

    act(() => {
      useGenerationStatusStore.getState().setAwaitingDelivery("other", false);
    });

    expect(invalidationsFor(messagesKey)).toBe(0);
    expect(
      invalidationsFor(
        chatMessagesQuery({ pathParams: { chatId: "origin" } }).queryKey,
      ),
    ).toBe(before);
  });

  it("does not refetch an open chat on the run-ended edge when none is open", () => {
    const messagesKey = chatMessagesQuery({
      pathParams: { chatId: "origin" },
    }).queryKey;
    useGenerationStatusStore.getState().setAwaitingDelivery("origin", true);

    emit({ chats: [generatingEntry({ chat_id: "origin" })] });
    renderPoller();

    expect(invalidationsFor(recentChatsQuery({}).queryKey)).toBe(1);
    expect(invalidationsFor(messagesKey)).toBe(0);
  });

  it("refetches the open chat once when a task-result turn lands in it", () => {
    const messagesKey = chatMessagesQuery({
      pathParams: { chatId: "origin" },
    }).queryKey;
    useGenerationStatusStore.getState().setCurrentChatId("origin");

    const delivered = {
      chats: [
        generatingEntry({
          chat_id: "origin",
          state: "completed",
          initiator: "task_result",
          started_at: "2026-08-19T12:00:05.000Z",
          ended_at: "2026-08-19T12:00:06.000Z",
        }),
      ],
    };

    // 1. The server-initiated reaction turn landed: pull it in.
    emit(delivered);
    const view = renderPoller();
    expect(invalidationsFor(messagesKey)).toBe(1);

    const rerender = () =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <GenerationStatusPoller />
        </QueryClientProvider>,
      );

    // 2. The same generation stays in the snapshot for the whole retention
    //    window; refetching on every tick of it would be a refetch loop.
    emit(delivered);
    rerender();
    expect(invalidationsFor(messagesKey)).toBe(1);

    // 3. An ordinary user turn in the open chat is already on screen.
    emit({
      chats: [
        generatingEntry({
          chat_id: "origin",
          state: "completed",
          initiator: "user",
          started_at: "2026-08-19T12:00:20.000Z",
        }),
      ],
    });
    rerender();
    expect(invalidationsFor(messagesKey)).toBe(1);

    // 4. A task-result turn in a chat the user is not looking at.
    emit({
      chats: [
        generatingEntry({
          chat_id: "other",
          state: "completed",
          initiator: "task_result",
          started_at: "2026-08-19T12:00:30.000Z",
        }),
      ],
    });
    rerender();
    expect(invalidationsFor(messagesKey)).toBe(1);

    // 5. Still running: the turn is not there to fetch yet.
    emit({
      chats: [
        generatingEntry({
          chat_id: "origin",
          initiator: "task_result",
          started_at: "2026-08-19T12:00:40.000Z",
        }),
      ],
    });
    rerender();
    expect(invalidationsFor(messagesKey)).toBe(1);

    // 6. A SECOND async task delivers into the same chat. `/me/generating`
    //    returns one row per chat, so this is the same `chat_id` with a new
    //    `started_at` — the dedupe has to be per generation, not once ever.
    //    Without this case the guard could be "only ever react once", or key
    //    on `chat_id` alone, and every assertion above would still pass while
    //    the second answer never appeared without a reload.
    emit({
      chats: [
        generatingEntry({
          chat_id: "origin",
          state: "completed",
          initiator: "task_result",
          started_at: "2026-08-19T12:00:50.000Z",
          ended_at: "2026-08-19T12:00:51.000Z",
        }),
      ],
    });
    rerender();
    expect(invalidationsFor(messagesKey)).toBe(2);
  });
});
