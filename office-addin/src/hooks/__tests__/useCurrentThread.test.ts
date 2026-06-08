import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useCurrentThread } from "../useCurrentThread";

import type { GraphTransport } from "../../utils/fetchOutlookMessageGraph";

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

const acquireToken = async () => "token";

describe("useCurrentThread", () => {
  it("returns null thread + isLoading=false when itemId or conversationId is missing", () => {
    const transport: GraphTransport = vi.fn(async () => {
      throw new Error("transport should not be called");
    });

    const { result } = renderHook(() =>
      useCurrentThread(null, "conv-1", acquireToken, { transport }),
    );
    expect(result.current).toEqual({
      thread: null,
      isLoading: false,
      error: false,
    });
    expect(transport).not.toHaveBeenCalled();

    const { result: result2 } = renderHook(() =>
      useCurrentThread("item-1", null, acquireToken, { transport }),
    );
    expect(result2.current).toEqual({
      thread: null,
      isLoading: false,
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

    const { result } = renderHook(() =>
      useCurrentThread("item-1", "conv-1", acquireToken, { transport }),
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
        useCurrentThread("item-1", conversationId, acquireToken, { transport }),
      { initialProps: { conversationId: "conv-A" } },
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
    const { result } = renderHook(() =>
      useCurrentThread("item-1", "conv-1", acquireToken, { transport }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    consoleWarn.mockRestore();
    expect(result.current.thread).toBeNull();
    expect(result.current.error).toBe(true);
  });
});
