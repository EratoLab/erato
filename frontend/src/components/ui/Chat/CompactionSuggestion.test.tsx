import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { CompactionSuggestion } from "./CompactionSuggestion";

import type { TokenUsageEstimationResult } from "@/hooks/chat/useTokenUsageEstimation";
import type { Messages } from "@lingui/core";

vi.mock("@/hooks/ui/useThemedIcon", () => ({ useThemedIcon: () => "info" }));
vi.mock("@/app/env", () => ({
  env: () => ({ chatHistoryCompactionThresholdPercentage: 80 }),
}));
beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});
function estimation(percentage: number): TokenUsageEstimationResult {
  return {
    tokenUsage: {
      file_details: [],
      stats: {
        chat_provider_id: "chat",
        file_tokens: 0,
        history_tokens: percentage * 1000,
        max_tokens: 1000,
        remaining_tokens: 1000 - percentage * 1000,
        total_tokens: percentage * 1000,
        user_message_tokens: 0,
      },
    },
    usagePercentage: percentage,
    isLoading: false,
    error: null,
    isApproachingLimit: false,
    isCriticallyClose: false,
    exceedsLimit: false,
  };
}
describe("CompactionSuggestion", () => {
  it.each([0, 0.7999])(
    "does not suggest below the inclusive threshold %s",
    (percentage) => {
      render(
        <I18nProvider i18n={i18n}>
          <CompactionSuggestion
            estimation={estimation(percentage)}
            onCompact={vi.fn()}
          />
        </I18nProvider>,
      );
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );
  it.each([0.8, 0.95, 1.2])(
    "requires a click at or above the threshold %s",
    (percentage) => {
      const compact = vi.fn();
      render(
        <I18nProvider i18n={i18n}>
          <CompactionSuggestion
            estimation={estimation(percentage)}
            onCompact={compact}
          />
        </I18nProvider>,
      );
      expect(compact).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "Compact chat history" }),
      );
      expect(compact).toHaveBeenCalledOnce();
      expect(screen.getByText(/Some details may be lost/)).toBeVisible();
    },
  );
  it("disables the action during compaction", () => {
    render(
      <I18nProvider i18n={i18n}>
        <CompactionSuggestion
          estimation={estimation(1)}
          onCompact={vi.fn()}
          pending
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
