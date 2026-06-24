import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGraphOutlookMessageFetcher } from "../../utils/fetchOutlookMessage";
import { OUTLOOK_GRAPH_THREAD_UI_BLOCK_DEADLINE_MS } from "../../utils/graphRequestTimeout";
import { useCurrentThread } from "../useCurrentThread";

import type { GraphTransport } from "../../utils/fetchOutlookMessageGraph";
import type { ParsedThread } from "../../utils/parsedThread";
import type { ReactNode } from "react";

function buildResponder(jsonValue: unknown, ok = true, status = 200) {
  return vi.fn(
    async () =>
      ({
        ok,
        status,
        statusText: ok ? "OK" : "Error",
        json: async () => jsonValue,
      }) as Response,
  );
}

const { fetchConversationMessages } = createGraphOutlookMessageFetcher(
  async () => "token",
);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function createWrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

function buildThread(subject: string): ParsedThread {
  return {
    conversationId: "conv-1",
    subject,
    messages: [
      {
        id: "<m1@x>",
        internetMessageId: "<m1@x>",
        subject,
        from: null,
        to: [],
        cc: [],
        date: "2026-03-01T10:00:00Z",
        bodyText: "body",
        bodyHtml: null,
        attachments: [],
      },
    ],
    incomplete: false,
  };
}

describe("useCurrentThread", () => {
  it("returns null thread + isLoading=false when itemId or conversationId is missing", () => {
    const transport: GraphTransport = vi.fn(async () => {
      throw new Error("transport should not be called");
    });

    const { result } = renderHook(
      () =>
        useCurrentThread(null, "conv-1", fetchConversationMessages, {
          transport,
        }),
      { wrapper: createWrapper() },
    );
    expect(result.current).toEqual({
      thread: null,
      isLoading: false,
      isBlockingLoad: false,
      error: false,
    });
    expect(transport).not.toHaveBeenCalled();

    const { result: result2 } = renderHook(
      () =>
        useCurrentThread("item-1", null, fetchConversationMessages, {
          transport,
        }),
      { wrapper: createWrapper() },
    );
    expect(result2.current).toEqual({
      thread: null,
      isLoading: false,
      isBlockingLoad: false,
      error: false,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("toggles isLoading around the fetch and resolves to the parsed thread", async () => {
    const transport = buildResponder({
      value: [
        {
          id: "m1",
          internetMessageId: "<m1@x>",
          subject: "Loaded message",
          body: { contentType: "text", content: "body" },
          receivedDateTime: "2026-03-01T10:00:00Z",
          isDraft: false,
        },
      ],
    });

    const { result } = renderHook(
      () =>
        useCurrentThread("item-1", "conv-1", fetchConversationMessages, {
          transport,
        }),
      { wrapper: createWrapper() },
    );

    // Effect runs synchronously after mount; first observed value should be
    // either loading=true with no thread yet, or already resolved.
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.thread?.messages[0].subject).toBe("Loaded message");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("clears the previous thread to null when conversationId changes", async () => {
    const transport = vi.fn(async (url: string) => {
      const conversation = /conversationId%20eq%20'([^']+)'/.exec(url)?.[1];
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          value: [
            {
              id: conversation,
              internetMessageId: `<${conversation}@x>`,
              subject: `Subject for ${conversation}`,
              body: { contentType: "text", content: "body" },
              receivedDateTime: "2026-03-01T10:00:00Z",
              isDraft: false,
            },
          ],
        }),
      } as Response;
    });

    const { result, rerender } = renderHook(
      ({ conversationId }) =>
        useCurrentThread("item-1", conversationId, fetchConversationMessages, {
          transport,
        }),
      { initialProps: { conversationId: "conv-A" }, wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.thread?.subject).toContain("conv-A");
    });

    await act(async () => {
      rerender({ conversationId: "conv-B" });
    });

    // Switching mid-flight must clear the previous thread so consumers
    // don't render stale content during the new fetch.
    await waitFor(() => {
      expect(result.current.thread?.subject).toContain("conv-B");
    });
  });

  it("sets error=true (not a silent null) when the Graph request fails outright", async () => {
    const transport = buildResponder({ value: [] }, false, 500);

    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(
      () =>
        useCurrentThread("item-1", "conv-1", fetchConversationMessages, {
          transport,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    consoleWarn.mockRestore();
    expect(result.current.thread).toBeNull();
    expect(result.current.error).toBe(true);
    // A failed fetch must not leave the UI in a blocking state.
    expect(result.current.isBlockingLoad).toBe(false);
  });

  describe("isBlockingLoad", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("is false when fetch is disabled (no itemId/conversationId)", () => {
      const transport: GraphTransport = vi.fn(async () => {
        throw new Error("should not be called");
      });
      const { result } = renderHook(
        () =>
          useCurrentThread(null, "conv-1", fetchConversationMessages, {
            transport,
          }),
        { wrapper: createWrapper() },
      );
      expect(result.current.isBlockingLoad).toBe(false);
    });

    it("is true on initial load and flips to false after the UI-block deadline", async () => {
      // A transport that never resolves — simulates a slow / stalled network.
      const transport: GraphTransport = vi.fn(
        () => new Promise<Response>(() => {}),
      );

      const { result } = renderHook(
        () =>
          useCurrentThread("item-1", "conv-1", fetchConversationMessages, {
            transport,
          }),
        { wrapper: createWrapper() },
      );

      // Fetch is in flight and within the deadline: input must be blocked.
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isBlockingLoad).toBe(true);

      // Advance time past the UI-block deadline but not the full fetch timeout.
      await act(async () => {
        vi.advanceTimersByTime(OUTLOOK_GRAPH_THREAD_UI_BLOCK_DEADLINE_MS);
      });

      // Fetch is still in flight (never resolved), but the deadline has elapsed:
      // the input must be unblocked while the loading chip stays visible.
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isBlockingLoad).toBe(false);
    });

    it("resets to true (re-blocks) when conversationId changes after the deadline has elapsed", async () => {
      // A transport that never resolves.
      const transport: GraphTransport = vi.fn(
        () => new Promise<Response>(() => {}),
      );

      const { result, rerender } = renderHook(
        ({ conversationId }) =>
          useCurrentThread(
            "item-1",
            conversationId,
            fetchConversationMessages,
            {
              transport,
            },
          ),
        {
          initialProps: { conversationId: "conv-A" },
          wrapper: createWrapper(),
        },
      );

      // Let the deadline elapse for conv-A.
      await act(async () => {
        vi.advanceTimersByTime(OUTLOOK_GRAPH_THREAD_UI_BLOCK_DEADLINE_MS);
      });
      expect(result.current.isBlockingLoad).toBe(false);

      // Switch to a new conversation — the block deadline must reset.
      await act(async () => {
        rerender({ conversationId: "conv-B" });
      });

      // The new fetch is in flight and within the fresh deadline.
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isBlockingLoad).toBe(true);
    });
  });

  it("keeps cached thread data non-loading during a background refetch", async () => {
    const queryClient = createTestQueryClient();
    const queryKey = [
      "office-addin",
      "outlook-current-thread",
      "item-1",
      "conv-1",
    ];
    queryClient.setQueryData(queryKey, buildThread("Cached thread"));

    let resolveFetch: ((response: Response) => void) | null = null;
    const transport: GraphTransport = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { result } = renderHook(
      () =>
        useCurrentThread("item-1", "conv-1", fetchConversationMessages, {
          transport,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(result.current.thread?.subject).toBe("Cached thread");
    expect(result.current.isLoading).toBe(false);
    expect(transport).not.toHaveBeenCalled();

    act(() => {
      void queryClient.invalidateQueries({ queryKey });
    });

    await waitFor(() => {
      expect(transport).toHaveBeenCalledTimes(1);
    });
    expect(result.current.thread?.subject).toBe("Cached thread");
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      resolveFetch?.({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          value: [
            {
              id: "m1",
              internetMessageId: "<m1@x>",
              subject: "Refetched thread",
              body: { contentType: "text", content: "body" },
              receivedDateTime: "2026-03-01T10:00:00Z",
              isDraft: false,
            },
          ],
        }),
      } as Response);
    });

    await waitFor(() => {
      expect(result.current.thread?.subject).toBe("Refetched thread");
    });
    expect(result.current.isLoading).toBe(false);
  });
});
