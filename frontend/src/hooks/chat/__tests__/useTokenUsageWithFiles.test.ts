import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useTokenUsageEstimate: vi.fn(),
}));

import { useTokenUsageWithFiles } from "@/hooks/chat/useTokenUsageWithFiles";
import { useTokenUsageEstimate } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type {
  FileUploadItem,
  TokenUsageResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const response: TokenUsageResponse = {
  stats: {
    total_tokens: 100,
    user_message_tokens: 10,
    history_tokens: 0,
    file_tokens: 90,
    max_tokens: 1000,
    remaining_tokens: 900,
    chat_provider_id: "test",
  },
  file_details: [],
};

const text = (name: string, content: string) =>
  new File([content], name, { type: "text/plain", lastModified: 1 });

const sentBase64 = (mutateAsync: ReturnType<typeof vi.fn>) =>
  mutateAsync.mock.calls.map((call) =>
    (
      (call[0] as { body: { virtual_files?: { base64: string }[] } }).body
        .virtual_files ?? []
    ).map((file) => file.base64),
  );

const DELAY = 120;
const noFiles: FileUploadItem[] = [];

describe("useTokenUsageWithFiles with context estimates", () => {
  let mutateAsync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mutateAsync = vi.fn().mockResolvedValue(response);
    vi.mocked(useTokenUsageEstimate).mockReturnValue({
      mutateAsync,
    } as unknown as ReturnType<typeof useTokenUsageEstimate>);
  });

  const renderUsage = (initial: File[] | undefined) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    return renderHook(
      ({ virtualFiles }: { virtualFiles: File[] | undefined }) =>
        useTokenUsageWithFiles({
          message: "",
          attachedFiles: noFiles,
          virtualFiles,
          chatId: "chat",
          debounceDelay: DELAY,
        }),
      { wrapper, initialProps: { virtualFiles: initial } },
    );
  };

  it("estimates the last of several quick changes once", async () => {
    const { rerender } = renderUsage([text("a.txt", "first")]);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    rerender({ virtualFiles: [text("b.txt", "second")] });
    rerender({ virtualFiles: [text("c.txt", "third")] });

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, DELAY * 2));
    // "first" and "third", base64-encoded.
    expect(sentBase64(mutateAsync)).toEqual([["Zmlyc3Q="], ["dGhpcmQ="]]);
  });

  it("clears the estimate at once when the context goes", async () => {
    const { result, rerender } = renderUsage([text("a.txt", "first")]);
    await waitFor(() =>
      expect(result.current.tokenUsageEstimation).not.toBeNull(),
    );

    rerender({ virtualFiles: [] });

    expect(result.current.tokenUsageEstimation).toBeNull();
    expect(result.current.exceedsLimit).toBe(false);
  });
});
