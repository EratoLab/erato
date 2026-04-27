import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useTokenUsageEstimate: vi.fn(),
}));

import {
  digestVirtualFiles,
  getTokenEstimationQueryKey,
  useTokenUsageEstimation,
} from "@/hooks/chat/useTokenUsageEstimation";
import { useTokenUsageEstimate } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { TokenUsageResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

function makeFile(name: string, content: string, type = "text/plain"): File {
  return new File([content], name, { type, lastModified: 1700000000000 });
}

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
};

const mockResponse: TokenUsageResponse = {
  stats: {
    total_tokens: 100,
    user_message_tokens: 10,
    history_tokens: 0,
    file_tokens: 90,
    max_tokens: 1000,
    remaining_tokens: 900,
    chat_provider_id: "test",
  },
  file_details: [
    { id: "synth-1", filename: "preview.eml", token_count: 90 },
  ],
};

describe("digestVirtualFiles", () => {
  it("returns empty for empty/undefined input", () => {
    expect(digestVirtualFiles(undefined)).toBe("");
    expect(digestVirtualFiles([])).toBe("");
  });

  it("is stable across two arrays of files with the same metadata", () => {
    const a = [makeFile("preview.eml", "body", "message/rfc822")];
    const b = [makeFile("preview.eml", "body", "message/rfc822")];
    expect(digestVirtualFiles(a)).toBe(digestVirtualFiles(b));
  });

  it("differs when filename changes", () => {
    const a = [makeFile("a.eml", "body")];
    const b = [makeFile("b.eml", "body")];
    expect(digestVirtualFiles(a)).not.toBe(digestVirtualFiles(b));
  });

  it("differs when size changes", () => {
    const a = [makeFile("preview.eml", "short")];
    const b = [makeFile("preview.eml", "much longer body content here")];
    expect(digestVirtualFiles(a)).not.toBe(digestVirtualFiles(b));
  });

  it("is order-insensitive (sorted internally)", () => {
    const a = [makeFile("a.eml", "x"), makeFile("b.eml", "y")];
    const b = [makeFile("b.eml", "y"), makeFile("a.eml", "x")];
    expect(digestVirtualFiles(a)).toBe(digestVirtualFiles(b));
  });
});

describe("getTokenEstimationQueryKey + virtualFilesDigest", () => {
  it("changes when the virtual-files digest changes", () => {
    const a = getTokenEstimationQueryKey("hello", [], null, undefined, null, undefined, "");
    const b = getTokenEstimationQueryKey(
      "hello",
      [],
      null,
      undefined,
      null,
      undefined,
      "preview.eml|message/rfc822|10|0",
    );
    expect(a).not.toEqual(b);
  });

  it("is stable for the same digest", () => {
    const a = getTokenEstimationQueryKey("hi", [], null, undefined, null, undefined, "d1");
    const b = getTokenEstimationQueryKey("hi", [], null, undefined, null, undefined, "d1");
    expect(a).toEqual(b);
  });
});

describe("useTokenUsageEstimation with virtual files", () => {
  let mutateAsync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mutateAsync = vi.fn().mockResolvedValue(mockResponse);
    vi.mocked(useTokenUsageEstimate).mockReturnValue({
      mutateAsync,
      mutate: vi.fn(),
      reset: vi.fn(),
      data: undefined,
      error: null,
      isError: false,
      isIdle: true,
      isPending: false,
      isPaused: false,
      isSuccess: false,
      status: "idle",
      variables: undefined,
      context: undefined,
      failureCount: 0,
      failureReason: null,
      submittedAt: 0,
    } as unknown as ReturnType<typeof useTokenUsageEstimate>);
  });

  it("base64-encodes File payloads into request.virtual_files", async () => {
    const { result } = renderHook(() => useTokenUsageEstimation(), {
      wrapper,
    });

    const file = makeFile("preview.eml", "hello world", "message/rfc822");

    await act(async () => {
      await result.current.estimateTokenUsage(
        "Summarize this.",
        null,
        undefined,
        null,
        undefined,
        undefined,
        [file],
      );
    });

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });

    const body = mutateAsync.mock.calls[0][0].body;
    expect(body.virtual_files).toHaveLength(1);
    expect(body.virtual_files[0].filename).toBe("preview.eml");
    expect(body.virtual_files[0].content_type).toBe("message/rfc822");
    // Standard base64 of "hello world".
    expect(body.virtual_files[0].base64).toBe("aGVsbG8gd29ybGQ=");
  });

  it("omits virtual_files from the request when none are passed", async () => {
    const { result } = renderHook(() => useTokenUsageEstimation(), {
      wrapper,
    });

    await act(async () => {
      await result.current.estimateTokenUsage("Hi");
    });

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });

    const body = mutateAsync.mock.calls[0][0].body;
    expect(body.virtual_files).toBeUndefined();
  });

  it("differentiates the cache by virtual-files content (no cross-cache hit)", async () => {
    const { result } = renderHook(() => useTokenUsageEstimation(), {
      wrapper,
    });

    const a = makeFile("a.eml", "body-a");
    const b = makeFile("b.eml", "body-b");

    await act(async () => {
      await result.current.estimateTokenUsage(
        "msg",
        null,
        undefined,
        null,
        undefined,
        undefined,
        [a],
      );
      await result.current.estimateTokenUsage(
        "msg",
        null,
        undefined,
        null,
        undefined,
        undefined,
        [b],
      );
    });

    // Different virtual files must each hit the network — the cache key
    // includes the digest, so neither short-circuits the other.
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });
});
