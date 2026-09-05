import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { componentRegistry } from "@/config/componentRegistry";
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

vi.mock("@/hooks/ui/usePageAlignment", () => ({
  usePageAlignment: () => ({
    containerClasses: "max-w-2xl mx-auto",
    textAlignment: "text-center",
    flexAlignment: "items-center",
    justifyAlignment: "justify-center",
  }),
}));

describe("StarterPromptsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    componentRegistry.StarterPrompts = null;
    i18n.load("en", { ...(enMessages as unknown as Messages) });
    i18n.activate("en");

    mockUseStarterPromptsFeature.mockReturnValue({ enabled: true });
    mockUseStarterPrompts.mockReturnValue({
      data: {
        starter_prompts: [],
      } satisfies StarterPromptsResponse,
    });
  });

  const controls = {
    setDraftMessage: vi.fn(),
    focusInput: vi.fn(),
    setSelectedFacetIds: vi.fn(),
    setSelectedChatProviderId: vi.fn(),
    clearQueuedMessage: vi.fn(),
    toggleFacetId: vi.fn(),
    addUploadedFiles: vi.fn(),
  };

  function renderComponent() {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider i18n={i18n}>
          <ChatInputControlsProvider value={controls}>
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
    expect(screen.getByTestId("starter-prompt-research_topic")).toHaveAttribute(
      "title",
      "Translated subtitle",
    );
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
    expect(screen.getByTestId("starter-prompt-fallback_topic")).toHaveAttribute(
      "title",
      "Fallback subtitle",
    );
  });

  it("renders a compact row that keeps the test ids and control radius", () => {
    mockUseStarterPrompts.mockReturnValue({
      data: {
        starter_prompts: [
          {
            id: "research_market",
            title: "Research a topic",
            subtitle: "Find sources and summarise them",
            prompt: "Research",
            icon: "search",
            selected_facets: [],
          },
          {
            id: "draft_email",
            title: "Draft an email",
            subtitle: "Write a first version",
            prompt: "Draft",
            selected_facets: [],
          },
        ],
      } satisfies StarterPromptsResponse,
    });

    renderComponent();

    const section = screen.getByTestId("starter-prompts-section");
    expect(section).toHaveClass("flex", "flex-wrap", "justify-center");
    const button = screen.getByTestId("starter-prompt-research_market");
    expect(button).toHaveClass(
      "rounded-[var(--theme-radius-control)]",
      "min-h-9",
    );
    expect(button).toHaveTextContent("Research a topic");
    expect(
      screen.queryByText("Find sources and summarise them"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("starter-prompt-draft_email")).toHaveAttribute(
      "title",
      "Write a first version",
    );
    expect(screen.getAllByTestId("starter-prompt-icon")).toHaveLength(2);
  });

  it("drives the composer from a selected prompt", () => {
    mockUseStarterPrompts.mockReturnValue({
      data: {
        starter_prompts: [
          {
            id: "research_market",
            title: "Research a topic",
            subtitle: "Find sources and summarise them",
            prompt: "Research the market for",
            chat_provider: "gpt-5",
            selected_facets: ["web_search"],
          },
        ],
      } satisfies StarterPromptsResponse,
    });

    renderComponent();
    fireEvent.click(screen.getByTestId("starter-prompt-research_market"));

    expect(controls.setDraftMessage).toHaveBeenCalledWith(
      "Research the market for",
      { focus: false },
    );
    expect(controls.setSelectedFacetIds).toHaveBeenCalledWith(["web_search"]);
    expect(controls.setSelectedChatProviderId).toHaveBeenCalledWith("gpt-5");
    expect(controls.focusInput).toHaveBeenCalledTimes(1);
  });

  it("hands the same props to a registered renderer override", () => {
    const Override = vi.fn(
      ({
        starterPrompts,
        onStarterPromptSelect,
      }: {
        starterPrompts: { id: string; prompt: string }[];
        onStarterPromptSelect: (prompt: { id: string; prompt: string }) => void;
      }) => (
        <button
          type="button"
          data-testid="override-prompt"
          onClick={() => onStarterPromptSelect(starterPrompts[0])}
        >
          {starterPrompts.length}
        </button>
      ),
    );
    componentRegistry.StarterPrompts =
      Override as unknown as typeof componentRegistry.StarterPrompts;
    mockUseStarterPrompts.mockReturnValue({
      data: {
        starter_prompts: [
          {
            id: "research_market",
            title: "Research a topic",
            subtitle: "Find sources and summarise them",
            prompt: "Research",
            selected_facets: [],
          },
        ],
      } satisfies StarterPromptsResponse,
    });

    renderComponent();
    fireEvent.click(screen.getByTestId("override-prompt"));

    expect(screen.queryByTestId("starter-prompts-section")).toBeNull();
    expect(Override).toHaveBeenCalledTimes(1);
    expect(controls.setDraftMessage).toHaveBeenCalledWith("Research", {
      focus: false,
    });
    expect(controls.focusInput).toHaveBeenCalledTimes(1);
  });
});
