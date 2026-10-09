import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCompactionStore } from "./store/compactionStore";
import { useGenerationStatusStore } from "./store/generationStatusStore";
import { useMessagingStore } from "./store/messagingStore";
import { useChatCompaction } from "./useChatCompaction";

import type { CompactChatVariables } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  enabled: true,
  canEdit: true,
  compact: vi.fn(),
  messages: vi.fn(),
}));
vi.mock("@/app/env", () => ({
  env: () => ({ chatHistoryCompactionEnabled: mocks.enabled }),
}));
vi.mock("./useChatCanEdit", () => ({ useChatCanEdit: () => mocks.canEdit }));
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useCompactChat: (options: object) =>
    useMutation({
      mutationFn: (variables: CompactChatVariables) => mocks.compact(variables),
      ...options,
    }),
  fetchChatMessages: (...args: unknown[]) => mocks.messages(...args),
  chatMessagesQuery: () => ({ queryKey: ["messages"] }),
  chatDetailQuery: () => ({ queryKey: ["detail"] }),
  recentChatsQuery: () => ({ queryKey: ["recent"] }),
}));
const defaults = {
  chatId: "chat-a",
  previousMessageId: "tip-a",
  chatProviderId: "conversation",
  selectedFacetIds: ["search"],
};
function setup(props = defaults) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const hook = renderHook((input) => useChatCompaction(input), {
    initialProps: props,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { ...hook, client, invalidate };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.canEdit = true;
  useCompactionStore.setState({ pending: {} });
  useGenerationStatusStore.getState().reset();
  mocks.compact.mockResolvedValue({ message_id: "checkpoint" });
  mocks.messages.mockResolvedValue({ messages: [] });
});
describe("useChatCompaction", () => {
  it("submits explicitly selected context and prevents double clicks while refreshing", async () => {
    let resolve!: (value: unknown) => void;
    mocks.compact.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result, invalidate } = setup();
    act(() => {
      result.current.compact();
      result.current.compact();
    });
    await waitFor(() => expect(mocks.compact).toHaveBeenCalledOnce());
    expect(result.current.isPending).toBe(true);
    expect(mocks.compact).toHaveBeenCalledWith(
      expect.objectContaining({
        pathParams: { chatId: "chat-a" },
        body: expect.objectContaining({
          expected_tip_message_id: "tip-a",
          target_chat_provider_id: "conversation",
          selected_facet_ids: ["search"],
        }),
      }),
    );
    act(() => resolve({ message_id: "checkpoint" }));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(mocks.messages).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tokenEstimation"] });
  });
  it("reuses the operation after an uncertain error and releases pending state", async () => {
    mocks.compact.mockRejectedValueOnce(new Error("network"));
    const { result } = setup();
    act(() => result.current.compact());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.isPending).toBe(false);
    const first = mocks.compact.mock.calls[0][0].body.operation_id;
    act(() => result.current.compact());
    await waitFor(() => expect(mocks.compact).toHaveBeenCalledTimes(2));
    expect(mocks.compact.mock.calls[1][0].body.operation_id).toBe(first);
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
  it.each(["disabled", "read-only", "running", "action_required"])(
    "hides the action for %s",
    (state) => {
      if (state === "disabled") mocks.enabled = false;
      if (state === "read-only") mocks.canEdit = false;
      if (state === "running" || state === "action_required")
        useGenerationStatusStore.setState({
          statusByChatId: {
            "chat-a": { kind: state, startedAt: "now", localSeenAt: 0 },
          },
        });
      const { result } = setup();
      expect(result.current.available).toBe(false);
      act(() => result.current.compact());
      expect(mocks.compact).not.toHaveBeenCalled();
    },
  );
  it("completes cache refresh and unlocks the chat after navigation unmounts the composer", async () => {
    let resolve!: (value: unknown) => void;
    mocks.compact.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result, unmount } = setup();
    act(() => result.current.compact());
    await waitFor(() => expect(mocks.compact).toHaveBeenCalledOnce());
    unmount();
    resolve({ message_id: "checkpoint" });
    await waitFor(() =>
      expect(useCompactionStore.getState().pending["chat-a"]).toBe(false),
    );
    expect(mocks.messages).toHaveBeenCalledOnce();
    expect(useMessagingStore.getState().apiMessagesByKey["chat-a"]).toEqual({});
  });
});
