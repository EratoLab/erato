import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { ChatInputControlsProvider } from "./ChatInputControlsContext";
import { StarterPromptsSection } from "./StarterPromptsSection";

import type { StarterPromptsResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

const mockUseStarterPrompts = vi.fn();
const mockUseStarterPromptsFeature = vi.fn();

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useStarterPrompts: (...args: unknown[]) => mockUseStarterPrompts(...args),
}));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useStarterPromptsFeature: () => mockUseStarterPromptsFeature(),
}));

vi.mock("../icons", () => ({
  ResolvedIcon: () => <span data-testid="starter-prompt-icon" />,
}));

describe("StarterPromptsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18n.load("en", { ...(enMessages as unknown as Messages) });
    i18n.activate("en");

    mockUseStarterPromptsFeature.mockReturnValue({ enabled: true });
    mockUseStarterPrompts.mockReturnValue({
      data: {
        starter_prompts: [],
      } satisfies StarterPromptsResponse,
    });
  });

  function renderComponent() {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider i18n={i18n}>
          <ChatInputControlsProvider
            value={{
              setDraftMessage: vi.fn(),
              focusInput: vi.fn(),
              setSelectedFacetIds: vi.fn(),
              setSelectedChatProviderId: vi.fn(),
              toggleFacetId: vi.fn(),
              addUploadedFiles: vi.fn(),
            }}
          >
            <StarterPromptsSection />
          </ChatInputControlsProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
  }

  it("renders translated starter prompt labels when locale strings exist", () => {
    i18n.load("en", {
      ...(enMessages as unknown as Messages),
      "starter_prompts.research_topic.title": "Translated title",
      "starter_prompts.research_topic.subtitle": "Translated subtitle",
    });
    i18n.activate("en");

    mockUseStarterPrompts.mockReturnValue({
      data: {
        starter_prompts: [
          {
            id: "research_topic",
            title: "Fallback title",
            subtitle: "Fallback subtitle",
            prompt: "Prompt body",
            selected_facets: [],
          },
        ],
      } satisfies StarterPromptsResponse,
    });

    renderComponent();

    expect(screen.getByText("Translated title")).toBeInTheDocument();
    expect(screen.getByText("Translated subtitle")).toBeInTheDocument();
  });

  it("falls back to backend labels when locale strings do not exist", () => {
    mockUseStarterPrompts.mockReturnValue({
      data: {
        starter_prompts: [
          {
            id: "fallback_topic",
            title: "Fallback title",
            subtitle: "Fallback subtitle",
            prompt: "Prompt body",
            selected_facets: [],
          },
        ],
      } satisfies StarterPromptsResponse,
    });

    renderComponent();

    expect(screen.getByText("Fallback title")).toBeInTheDocument();
    expect(screen.getByText("Fallback subtitle")).toBeInTheDocument();
  });
});
