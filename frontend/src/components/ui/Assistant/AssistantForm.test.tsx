import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { AssistantForm } from "./AssistantForm";

import type { TokenUsageEstimationResult } from "@/hooks/chat/useTokenUsageEstimation";
import type React from "react";

vi.mock("@/hooks/chat/useTokenUsageEstimation", () => ({
  useTokenUsageEstimation: () => ({
    estimateTokenUsageFromParts: vi.fn(),
    lastEstimation: null,
    clearLastEstimation: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock("@/hooks/ui", () => ({
  useFilePreviewModal: () => ({
    isPreviewModalOpen: false,
    fileToPreview: null,
    openPreviewModal: vi.fn(),
    closePreviewModal: vi.fn(),
  }),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  usePromptOptimizer: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useFacets: () => ({
    data: {
      facets: [],
      global_facet_settings: null,
    },
  }),
}));

vi.mock("@/components/ui/FileUpload", () => ({
  AssistantFileUploadSelector: () => (
    <div data-testid="assistant-file-upload" />
  ),
  FileAttachmentsPreview: () => <div data-testid="file-attachments-preview" />,
}));

vi.mock("@/components/ui/Modal/FilePreviewModal", () => ({
  FilePreviewModal: () => null,
}));

vi.mock("@/components/ui/Controls/InfoTooltip", () => ({
  InfoTooltip: () => null,
}));

vi.mock("@/components/ui/Feedback/Alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));

function renderForm({
  tokenUsageEstimationOverride,
  contextWarningThreshold = 0.5,
  contextFileContributorThreshold = 0.05,
}: {
  tokenUsageEstimationOverride: TokenUsageEstimationResult;
  contextWarningThreshold?: number;
  contextFileContributorThreshold?: number;
}) {
  return render(
    <StaticFeatureConfigProvider
      config={{
        assistants: {
          enabled: false,
          showRecentItems: false,
          contextWarningThreshold,
          contextFileContributorThreshold,
        },
      }}
    >
      <AssistantForm
        onSubmit={vi.fn()}
        tokenUsageEstimationOverride={tokenUsageEstimationOverride}
      />
    </StaticFeatureConfigProvider>,
  );
}

describe("AssistantForm", () => {
  it("hides context warning details below the configured threshold", () => {
    renderForm({
      contextWarningThreshold: 0.5,
      tokenUsageEstimationOverride: {
        tokenUsage: {
          stats: {
            total_tokens: 400,
            max_tokens: 1000,
            remaining_tokens: 600,
          },
          file_details: [
            {
              filename: "notes.md",
              token_count: 40,
            },
          ],
        },
        isLoading: false,
        error: null,
        isApproachingLimit: false,
        isCriticallyClose: false,
        usagePercentage: 0.4,
        exceedsLimit: false,
      } as TokenUsageEstimationResult,
    });

    expect(screen.queryByText("Used context: 40%")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Largest file context contributors:"),
    ).not.toBeInTheDocument();
  });

  it("shows all contributing files when the threshold is set to zero", () => {
    renderForm({
      contextWarningThreshold: 0,
      contextFileContributorThreshold: 0,
      tokenUsageEstimationOverride: {
        tokenUsage: {
          stats: {
            total_tokens: 400,
            max_tokens: 1000,
            remaining_tokens: 600,
          },
          file_details: [
            {
              filename: "tiny-context.md",
              token_count: 40,
            },
            {
              filename: "bigger-context.md",
              token_count: 120,
            },
          ],
        },
        isLoading: false,
        error: null,
        isApproachingLimit: false,
        isCriticallyClose: false,
        usagePercentage: 0.4,
        exceedsLimit: false,
      } as TokenUsageEstimationResult,
    });

    expect(screen.getByText("Used context: 40%")).toBeInTheDocument();
    expect(
      screen.getByText("Largest file context contributors:"),
    ).toBeInTheDocument();
    expect(screen.getByText("tiny-context.md: 4.0%")).toBeInTheDocument();
    expect(screen.getByText("bigger-context.md: 12.0%")).toBeInTheDocument();
  });
});
