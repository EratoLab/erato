import { i18n } from "@lingui/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useTokenUsageWithFiles } from "@/hooks/chat/useTokenUsageWithFiles";

import { ChatInputTokenUsage } from "./ChatInputTokenUsage";

vi.mock("@/hooks/chat/useTokenUsageWithFiles", () => ({
  useTokenUsageWithFiles: vi.fn(),
}));
vi.mock("../Feedback/ChatWarnings/TokenUsageWarning", () => ({
  TokenUsageWarning: () => null,
}));

describe("attachment inclusion feedback", () => {
  it("shows omitted content below the overall warning threshold and permits sending", () => {
    i18n.load("en", {});
    i18n.activate("en");
    vi.mocked(useTokenUsageWithFiles).mockReturnValue({
      isEstimating: false,
      exceedsLimit: false,
      clearEstimation: vi.fn(),
      checkTokenUsage: vi.fn(),
      tokenUsageEstimation: {
        isLoading: false,
        error: null,
        isApproachingLimit: false,
        isCriticallyClose: false,
        exceedsLimit: false,
        usagePercentage: 0.1,
        tokenUsage: {
          stats: {
            total_tokens: 100,
            file_tokens: 100,
            history_tokens: 0,
            user_message_tokens: 0,
            max_tokens: 1000,
            remaining_tokens: 900,
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
      <ChatInputTokenUsage
        message=""
        attachedFiles={[]}
        onLimitExceeded={onLimitExceeded}
      />,
    );
    expect(screen.getByText(/large.csv: Preview included/)).toBeInTheDocument();
    expect(
      screen.getByText(/small.pdf: Full content included/),
    ).toBeInTheDocument();
    expect(screen.getByText(/archive.zip: Reference only/)).toBeInTheDocument();
    expect(onLimitExceeded).toHaveBeenCalledWith(false);
  });
});
