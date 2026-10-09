import { i18n } from "@lingui/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { useTokenUsageWithFiles } from "@/hooks/chat/useTokenUsageWithFiles";

import { ChatInputTokenUsage } from "./ChatInputTokenUsage";

vi.mock("@/hooks/chat/useTokenUsageWithFiles", () => ({
  useTokenUsageWithFiles: vi.fn(),
}));

describe("ChatInputTokenUsage", () => {
  it.each([false, true])(
    "hides attachment inclusion feedback and preserves token limit handling (exceedsLimit: %s)",
    (exceedsLimit) => {
      i18n.load("en", {});
      i18n.activate("en");
      vi.mocked(useTokenUsageWithFiles).mockReturnValue({
        isEstimating: false,
        exceedsLimit,
        clearEstimation: vi.fn(),
        checkTokenUsage: vi.fn(),
        tokenUsageEstimation: {
          isLoading: false,
          error: null,
          isApproachingLimit: false,
          isCriticallyClose: false,
          exceedsLimit,
          usagePercentage: exceedsLimit ? 1.1 : 0.1,
          tokenUsage: {
            stats: {
              total_tokens: exceedsLimit ? 1100 : 100,
              file_tokens: exceedsLimit ? 1100 : 100,
              history_tokens: 0,
              user_message_tokens: 0,
              max_tokens: 1000,
              remaining_tokens: exceedsLimit ? -100 : 900,
              chat_provider_id: "test",
            },
            file_details: [
              {
                id: "a",
                filename: "large.csv",
                token_count: 70,
                included_token_count: 70,
                full_token_count: 50000,
                inclusion_mode: "preview",
                coverage: "complete",
                reason: "per_file_limit",
              },
              {
                id: "b",
                filename: "small.pdf",
                token_count: 20,
                included_token_count: 20,
                inclusion_mode: "full",
                coverage: "complete",
                reason: "complete",
              },
              {
                id: "c",
                filename: "archive.zip",
                token_count: 10,
                included_token_count: 10,
                inclusion_mode: "reference_only",
                coverage: "unavailable",
                reason: "unsupported",
              },
            ],
          },
        },
      });
      const onLimitExceeded = vi.fn();
      render(
        <ThemeProvider enableCustomTheme={false}>
          <ChatInputTokenUsage
            message=""
            attachedFiles={[]}
            onLimitExceeded={onLimitExceeded}
          />
        </ThemeProvider>,
      );
      expect(screen.queryByText(/large.csv/)).not.toBeInTheDocument();
      expect(screen.queryByText(/small.pdf/)).not.toBeInTheDocument();
      expect(screen.queryByText(/archive.zip/)).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          /Full content included|Preview included|Reference only/,
        ),
      ).not.toBeInTheDocument();
      if (exceedsLimit) {
        expect(screen.getByText("Token Limit Exceeded")).toBeInTheDocument();
      } else {
        expect(
          screen.queryByText("Token Limit Exceeded"),
        ).not.toBeInTheDocument();
      }
      expect(onLimitExceeded).toHaveBeenCalledWith(exceedsLimit);
    },
  );
});
